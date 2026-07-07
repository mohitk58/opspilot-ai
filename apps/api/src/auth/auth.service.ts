import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type {
  AuthUserDto,
  LoginDto,
  Role,
  SignupDto,
  UpdateUserRoleDto,
} from '@opspilot/types';
import { AppException } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { AccessTokenPayload, TokenService } from './token.service';

const BCRYPT_COST = 12; // NFR: bcrypt cost ≥ 10

/** MVP is single-tenant: every signup lands in this organization (multi-tenancy is Phase 2). */
const DEFAULT_ORG = { slug: 'default', name: 'Default Organization' };

export interface RequestContext {
  userAgent?: string;
  ip?: string;
}

export interface Session {
  user: AuthUserDto;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /** A1 — first user in the org becomes ADMIN so A4 (role assignment) is exercisable. */
  async signup(dto: SignupDto, ctx: RequestContext): Promise<Session> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);

    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const org = await tx.organization.upsert({
          where: { slug: DEFAULT_ORG.slug },
          create: DEFAULT_ORG,
          update: {},
        });
        const isFirstUser = (await tx.user.count({ where: { organizationId: org.id } })) === 0;
        const created = await tx.user.create({
          data: {
            email: dto.email.toLowerCase(),
            passwordHash,
            fullName: dto.fullName,
            organizationId: org.id,
            role: isFirstUser ? 'ADMIN' : 'ENGINEER',
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: created.id,
            action: 'auth.signup',
            entityType: 'User',
            entityId: created.id,
            after: { email: created.email, role: created.role },
            ip: ctx.ip,
          },
        });
        await tx.outboxEvent.create({
          data: {
            routingKey: 'user.registered',
            payload: { userId: created.id, email: created.email, role: created.role },
          },
        });
        return created;
      });
    } catch (err) {
      if ((err as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
        throw new AppException(409, 'EMAIL_TAKEN', 'An account with this email already exists');
      }
      throw err;
    }

    return this.issueSession(user, ctx);
  }

  /** A2 — credentials in, access JWT + rotating refresh token out. */
  async login(dto: LoginDto, ctx: RequestContext): Promise<Session> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    // bcrypt.compare against a constant hash on miss would prevent user
    // enumeration via timing; skipped in MVP, noted in the security review.
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new AppException(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    if (!user.isActive || user.deletedAt) {
      throw new AppException(401, 'USER_INACTIVE', 'This account is deactivated');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: 'auth.login',
          entityType: 'User',
          entityId: user.id,
          ip: ctx.ip,
        },
      }),
    ]);

    return this.issueSession(user, ctx);
  }

  /**
   * A2 — rotation with replay detection (ADR-006): presenting a token that was
   * already rotated or revoked burns every active session for that user.
   * Role changes take effect here (A4): the new access token reads the role
   * fresh from the DB.
   */
  async refresh(rawToken: string | undefined, ctx: RequestContext): Promise<Session> {
    const payload = rawToken ? await this.tokens.verifyRefreshToken(rawToken) : null;
    if (!payload) {
      throw new AppException(401, 'INVALID_REFRESH_TOKEN', 'Refresh token missing or invalid');
    }

    const row = await this.prisma.refreshToken.findUnique({ where: { id: payload.jti } });
    if (!row || row.tokenHash !== this.tokens.hash(rawToken as string)) {
      throw new AppException(401, 'INVALID_REFRESH_TOKEN', 'Refresh token not recognized');
    }

    if (row.revokedAt || row.replacedBy) {
      await this.revokeAllSessions(row.userId, 'auth.refresh_replay_detected', ctx);
      this.logger.warn(`Refresh replay detected for user ${row.userId}`);
      throw new AppException(401, 'REFRESH_TOKEN_REUSED', 'Refresh token reuse detected; all sessions revoked');
    }
    if (row.expiresAt < new Date()) {
      await this.tokens.removeFromAllowlist(row.id);
      throw new AppException(401, 'REFRESH_TOKEN_EXPIRED', 'Refresh token expired; log in again');
    }

    // Fast-path consistency check; null also means Redis degraded, where the
    // DB row above is authoritative (architecture rule 7).
    const allowlisted = await this.tokens.isAllowlisted(row.id);
    if (allowlisted !== null && allowlisted !== row.userId) {
      throw new AppException(401, 'INVALID_REFRESH_TOKEN', 'Refresh token not recognized');
    }

    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || !user.isActive || user.deletedAt) {
      throw new AppException(401, 'USER_INACTIVE', 'This account is deactivated');
    }

    const next = await this.tokens.signRefreshToken(user.id);
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date(), replacedBy: next.jti },
      }),
      this.prisma.refreshToken.create({
        data: {
          id: next.jti,
          userId: user.id,
          tokenHash: this.tokens.hash(next.token),
          expiresAt: new Date(Date.now() + this.tokens.refreshTtlSec * 1000),
          userAgent: ctx.userAgent,
          ip: ctx.ip,
        },
      }),
    ]);
    await this.tokens.removeFromAllowlist(row.id);
    await this.tokens.allowlist(next.jti, user.id);

    const accessToken = await this.tokens.signAccessToken(this.toPayload(user));
    return { user: this.toAuthUser(user), accessToken, refreshToken: next.token };
  }

  /** A3 — server-side revocation. Idempotent: an invalid/absent cookie is a no-op. */
  async logout(rawToken: string | undefined, ctx: RequestContext): Promise<void> {
    const payload = rawToken ? await this.tokens.verifyRefreshToken(rawToken) : null;
    if (!payload) return;

    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: payload.jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.tokens.removeFromAllowlist(payload.jti);
    if (count > 0) {
      await this.prisma.auditLog.create({
        data: {
          actorId: payload.sub,
          action: 'auth.logout',
          entityType: 'User',
          entityId: payload.sub,
          ip: ctx.ip,
        },
      });
    }
  }

  async getMe(userId: string): Promise<AuthUserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || user.deletedAt) {
      throw new AppException(401, 'USER_INACTIVE', 'This account is deactivated');
    }
    return this.toAuthUser(user);
  }

  /** A4 — ADMIN-only; takes effect on the target's next token refresh. */
  async updateRole(
    actor: AccessTokenPayload,
    userId: string,
    dto: UpdateUserRoleDto,
    ctx: RequestContext,
  ): Promise<AuthUserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new AppException(404, 'USER_NOT_FOUND', 'No such user');
    }
    if (user.role === dto.role) return this.toAuthUser(user);

    // Demoting the last active admin would lock the org out of role management.
    if (user.role === 'ADMIN') {
      const otherAdmins = await this.prisma.user.count({
        where: { role: 'ADMIN', isActive: true, deletedAt: null, id: { not: userId } },
      });
      if (otherAdmins === 0) {
        throw new AppException(409, 'LAST_ADMIN', 'Cannot demote the only remaining admin');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id: userId }, data: { role: dto.role } });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          action: 'user.role_changed',
          entityType: 'User',
          entityId: userId,
          before: { role: user.role },
          after: { role: dto.role },
          ip: ctx.ip,
        },
      });
      await tx.outboxEvent.create({
        data: {
          routingKey: 'user.role_changed',
          payload: { userId, from: user.role, to: dto.role, actorId: actor.sub },
        },
      });
      return u;
    });
    return this.toAuthUser(updated);
  }

  /** Replay response: burn every active session and audit the event. */
  private async revokeAllSessions(userId: string, action: string, ctx: RequestContext) {
    const active = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null },
      select: { id: true },
    });
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: userId,
          action,
          entityType: 'User',
          entityId: userId,
          ip: ctx.ip,
        },
      }),
    ]);
    await this.tokens.removeFromAllowlist(...active.map((t) => t.id));
  }

  private async issueSession(user: User, ctx: RequestContext): Promise<Session> {
    const next = await this.tokens.signRefreshToken(user.id);
    await this.prisma.refreshToken.create({
      data: {
        id: next.jti,
        userId: user.id,
        tokenHash: this.tokens.hash(next.token),
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlSec * 1000),
        userAgent: ctx.userAgent,
        ip: ctx.ip,
      },
    });
    await this.tokens.allowlist(next.jti, user.id);
    const accessToken = await this.tokens.signAccessToken(this.toPayload(user));
    return { user: this.toAuthUser(user), accessToken, refreshToken: next.token };
  }

  private toPayload(user: User): AccessTokenPayload {
    return {
      sub: user.id,
      email: user.email,
      role: user.role as Role,
      orgId: user.organizationId,
    };
  }

  private toAuthUser(user: User): AuthUserDto {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role as Role,
      organizationId: user.organizationId,
      avatarUrl: user.avatarUrl,
      lastLoginAt: user.lastLoginAt,
    };
  }
}
