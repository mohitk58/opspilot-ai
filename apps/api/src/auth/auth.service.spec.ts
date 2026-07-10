import type { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AppException } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('bcrypt-hash'),
  compare: jest.fn(),
}));

const NOW = new Date('2026-07-07T12:00:00Z');

const user: User = {
  id: 'user-1',
  organizationId: 'org-1',
  email: 'jane@example.com',
  passwordHash: 'bcrypt-hash',
  fullName: 'Jane Doe',
  role: 'ENGINEER',
  avatarUrl: null,
  isActive: true,
  lastLoginAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

function buildPrismaMock() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    organization: { upsert: jest.fn() },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditLog: { create: jest.fn() },
    outboxEvent: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  // Support both the array form and the interactive-callback form.
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
  );
  return prisma;
}

function buildTokensMock() {
  return {
    signAccessToken: jest.fn().mockResolvedValue('access.jwt'),
    signRefreshToken: jest.fn().mockResolvedValue({ token: 'refresh.jwt.new', jti: 'jti-new' }),
    verifyRefreshToken: jest.fn(),
    hash: jest.fn((t: string) => `sha256:${t}`),
    isAllowlisted: jest.fn().mockResolvedValue(null),
    allowlist: jest.fn().mockResolvedValue('OK'),
    removeFromAllowlist: jest.fn().mockResolvedValue(1),
  };
}

const ctx = { userAgent: 'jest', ip: '127.0.0.1' };

describe('AuthService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let tokens: ReturnType<typeof buildTokensMock>;
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildPrismaMock();
    tokens = buildTokensMock();
    service = new AuthService(
      prisma as unknown as PrismaService,
      tokens as unknown as TokenService,
    );
  });

  describe('signup (A1)', () => {
    beforeEach(() => {
      prisma.organization.upsert.mockResolvedValue({ id: 'org-1' });
      prisma.user.create.mockResolvedValue(user);
      prisma.refreshToken.create.mockResolvedValue({});
    });

    it('creates the user with audit + outbox rows in one transaction and returns a session', async () => {
      prisma.user.count.mockResolvedValue(1); // not the first user
      const session = await service.signup(
        { email: 'Jane@Example.com', password: 'longenough', fullName: 'Jane Doe' },
        ctx,
      );

      expect(bcrypt.hash).toHaveBeenCalledWith('longenough', 12);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'jane@example.com', role: 'ENGINEER' }),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'auth.signup', entityType: 'User' }),
        }),
      );
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ routingKey: 'user.registered' }),
        }),
      );
      expect(session.accessToken).toBe('access.jwt');
      expect(session.refreshToken).toBe('refresh.jwt.new');
      expect(session.user).not.toHaveProperty('passwordHash');
    });

    it('makes the first user in the org an ADMIN', async () => {
      prisma.user.count.mockResolvedValue(0);
      await service.signup(
        { email: 'jane@example.com', password: 'longenough', fullName: 'Jane Doe' },
        ctx,
      );
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: 'ADMIN' }) }),
      );
    });

    it('maps duplicate email (P2002) to 409 EMAIL_TAKEN', async () => {
      prisma.user.count.mockResolvedValue(1);
      prisma.user.create.mockRejectedValue(
        Object.assign(new Error('unique constraint'), { code: 'P2002' }),
      );
      const err = await service
        .signup({ email: 'jane@example.com', password: 'longenough', fullName: 'Jane' }, ctx)
        .catch((e: AppException) => e);
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).code).toBe('EMAIL_TAKEN');
      expect((err as AppException).getStatus()).toBe(409);
    });
  });

  describe('login (A2)', () => {
    it('rejects unknown email and wrong password with the same 401 code', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login({ email: 'x@y.z', password: 'nope' }, ctx)).rejects.toMatchObject(
        { code: 'INVALID_CREDENTIALS' },
      );

      prisma.user.findUnique.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        service.login({ email: user.email, password: 'wrong' }, ctx),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('rejects deactivated users', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...user, isActive: false });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(
        service.login({ email: user.email, password: 'right' }, ctx),
      ).rejects.toMatchObject({ code: 'USER_INACTIVE' });
    });

    it('updates lastLoginAt, audits, allowlists the refresh token and returns a session', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({});

      const session = await service.login({ email: user.email, password: 'right' }, ctx);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { lastLoginAt: expect.any(Date) } }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'auth.login' }) }),
      );
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ id: 'jti-new', tokenHash: 'sha256:refresh.jwt.new' }),
        }),
      );
      expect(tokens.allowlist).toHaveBeenCalledWith('jti-new', user.id);
      expect(session.user.email).toBe(user.email);
    });
  });

  describe('refresh (A2 rotation + replay detection)', () => {
    const activeRow = {
      id: 'jti-old',
      userId: user.id,
      tokenHash: 'sha256:refresh.jwt.old',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      replacedBy: null,
    };

    it('rejects a missing or unverifiable token', async () => {
      tokens.verifyRefreshToken.mockResolvedValue(null);
      await expect(service.refresh(undefined, ctx)).rejects.toMatchObject({
        code: 'INVALID_REFRESH_TOKEN',
      });
    });

    it('rejects a token whose hash does not match the stored row', async () => {
      tokens.verifyRefreshToken.mockResolvedValue({ sub: user.id, jti: 'jti-old' });
      prisma.refreshToken.findUnique.mockResolvedValue({ ...activeRow, tokenHash: 'different' });
      await expect(service.refresh('refresh.jwt.old', ctx)).rejects.toMatchObject({
        code: 'INVALID_REFRESH_TOKEN',
      });
    });

    it('detects replay of a rotated token and revokes every active session', async () => {
      tokens.verifyRefreshToken.mockResolvedValue({ sub: user.id, jti: 'jti-old' });
      prisma.refreshToken.findUnique.mockResolvedValue({ ...activeRow, replacedBy: 'jti-new' });
      prisma.refreshToken.findMany.mockResolvedValue([{ id: 'jti-a' }, { id: 'jti-b' }]);

      await expect(service.refresh('refresh.jwt.old', ctx)).rejects.toMatchObject({
        code: 'REFRESH_TOKEN_REUSED',
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'auth.refresh_replay_detected' }),
        }),
      );
      expect(tokens.removeFromAllowlist).toHaveBeenCalledWith('jti-a', 'jti-b');
    });

    it('rejects an expired token', async () => {
      tokens.verifyRefreshToken.mockResolvedValue({ sub: user.id, jti: 'jti-old' });
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...activeRow,
        expiresAt: new Date(Date.now() - 1_000),
      });
      await expect(service.refresh('refresh.jwt.old', ctx)).rejects.toMatchObject({
        code: 'REFRESH_TOKEN_EXPIRED',
      });
    });

    it('rotates: revokes the old row with replacedBy, creates the new row, swaps the allowlist', async () => {
      tokens.verifyRefreshToken.mockResolvedValue({ sub: user.id, jti: 'jti-old' });
      prisma.refreshToken.findUnique.mockResolvedValue(activeRow);
      prisma.user.findUnique.mockResolvedValue({ ...user, role: 'ADMIN' }); // role changed since login

      const session = await service.refresh('refresh.jwt.old', ctx);

      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'jti-old' },
          data: { revokedAt: expect.any(Date), replacedBy: 'jti-new' },
        }),
      );
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ id: 'jti-new' }) }),
      );
      expect(tokens.removeFromAllowlist).toHaveBeenCalledWith('jti-old');
      expect(tokens.allowlist).toHaveBeenCalledWith('jti-new', user.id);
      // A4: the fresh role from the DB goes into the new access token
      expect(tokens.signAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'ADMIN' }),
      );
      expect(session.refreshToken).toBe('refresh.jwt.new');
    });
  });

  describe('logout (A3)', () => {
    it('revokes the token server-side and audits', async () => {
      tokens.verifyRefreshToken.mockResolvedValue({ sub: user.id, jti: 'jti-old' });
      await service.logout('refresh.jwt.old', ctx);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'jti-old', revokedAt: null } }),
      );
      expect(tokens.removeFromAllowlist).toHaveBeenCalledWith('jti-old');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'auth.logout' }) }),
      );
    });

    it('is a silent no-op for an invalid token', async () => {
      tokens.verifyRefreshToken.mockResolvedValue(null);
      await expect(service.logout('garbage', ctx)).resolves.toBeUndefined();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('updateRole (A4)', () => {
    const actor = { sub: 'admin-1', email: 'admin@x.y', role: 'ADMIN' as const, orgId: 'org-1' };

    it('404s for a missing user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.updateRole(actor, 'ghost', { role: 'VIEWER' }, ctx),
      ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    });

    it('writes the role change with before/after audit and outbox event in one transaction', async () => {
      prisma.user.findUnique.mockResolvedValue(user); // ENGINEER
      prisma.user.update.mockResolvedValue({ ...user, role: 'VIEWER' });

      const result = await service.updateRole(actor, user.id, { role: 'VIEWER' }, ctx);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'user.role_changed',
            before: { role: 'ENGINEER' },
            after: { role: 'VIEWER' },
          }),
        }),
      );
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ routingKey: 'user.role_changed' }),
        }),
      );
      expect(result.role).toBe('VIEWER');
    });

    it('refuses to demote the last active admin with 409 LAST_ADMIN', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...user, role: 'ADMIN' });
      prisma.user.count.mockResolvedValue(0); // no other active admins
      await expect(
        service.updateRole(actor, user.id, { role: 'VIEWER' }, ctx),
      ).rejects.toMatchObject({ code: 'LAST_ADMIN' });
      expect(prisma.user.update).not.toHaveBeenCalled();

      prisma.user.count.mockResolvedValue(1); // another admin exists → allowed
      prisma.user.update.mockResolvedValue({ ...user, role: 'VIEWER' });
      await expect(
        service.updateRole(actor, user.id, { role: 'VIEWER' }, ctx),
      ).resolves.toMatchObject({ role: 'VIEWER' });
    });

    it('skips the write when the role is unchanged', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      await service.updateRole(actor, user.id, { role: 'ENGINEER' }, ctx);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
    });
  });
});
