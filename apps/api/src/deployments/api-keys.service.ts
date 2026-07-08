import { createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { ApiKeyCreatedDto, ApiKeyDto, CreateApiKeyDto } from '@opspilot/types';
import type { RequestContext } from '../auth/auth.service';
import type { AccessTokenPayload } from '../auth/token.service';
import { AppException } from '../common/app.exception';
import { OrgsService } from '../orgs/orgs.service';
import { PrismaService } from '../prisma/prisma.service';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Hashed API keys for CI ingestion (D2). Keys are stored only as SHA-256
 * hashes (docs/03 §3: DB leak ≠ credential leak); the `prefix` column exists
 * purely so the UI can show "opk_a1b2…". The plaintext is returned exactly
 * once, at creation.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrgsService,
  ) {}

  async create(
    actor: AccessTokenPayload,
    projectId: string,
    dto: CreateApiKeyDto,
    ctx: RequestContext,
  ): Promise<ApiKeyCreatedDto> {
    const project = await this.orgs.getProject(actor, projectId);
    const plaintextKey = `opk_${randomBytes(24).toString('hex')}`;

    const key = await this.prisma.$transaction(async (tx) => {
      const created = await tx.apiKey.create({
        data: {
          projectId: project.id,
          name: dto.name,
          keyHash: sha256(plaintextKey),
          prefix: plaintextKey.slice(0, 8),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          action: 'api_key.created',
          entityType: 'ApiKey',
          entityId: created.id,
          after: { name: created.name, prefix: created.prefix, projectId: project.id },
          ip: ctx.ip,
        },
      });
      return created;
    });

    return { ...this.toDto(key), plaintextKey };
  }

  async list(actor: AccessTokenPayload, projectId: string): Promise<ApiKeyDto[]> {
    const project = await this.orgs.getProject(actor, projectId);
    const keys = await this.prisma.apiKey.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((k) => this.toDto(k));
  }

  async revoke(actor: AccessTokenPayload, keyId: string, ctx: RequestContext): Promise<void> {
    const key = await this.prisma.apiKey.findFirst({
      where: { id: keyId, revokedAt: null, project: { organizationId: actor.orgId } },
    });
    if (!key) throw new AppException(404, 'API_KEY_NOT_FOUND', 'No such active API key');

    await this.prisma.$transaction(async (tx) => {
      await tx.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          action: 'api_key.revoked',
          entityType: 'ApiKey',
          entityId: key.id,
          before: { name: key.name, prefix: key.prefix },
          ip: ctx.ip,
        },
      });
    });
  }

  /** Ingestion-path lookup: plaintext → active key, or null. Stamps lastUsedAt. */
  async verify(plaintext: string) {
    const key = await this.prisma.apiKey.findFirst({
      where: { keyHash: sha256(plaintext), revokedAt: null },
      select: { id: true, projectId: true, name: true },
    });
    if (!key) return null;
    // Fire-and-forget: usage stamping must not slow or fail ingestion.
    void this.prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return key;
  }

  private toDto(key: {
    id: string;
    projectId: string;
    name: string;
    prefix: string;
    lastUsedAt: Date | null;
    createdAt: Date;
    revokedAt: Date | null;
  }): ApiKeyDto {
    return {
      id: key.id,
      projectId: key.projectId,
      name: key.name,
      prefix: key.prefix,
      lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
      createdAt: key.createdAt.toISOString(),
      revokedAt: key.revokedAt?.toISOString() ?? null,
    };
  }
}
