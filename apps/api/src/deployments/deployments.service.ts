import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ChangeDeploymentStatusDto,
  DeploymentDto,
  ListDeploymentsQuery,
  Paginated,
  RecordDeploymentDto,
} from '@opspilot/types';
import type { RequestContext } from '../auth/auth.service';
import type { AccessTokenPayload } from '../auth/token.service';
import { AppException } from '../common/app.exception';
import { OrgsService } from '../orgs/orgs.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { DeployActor } from './guards/api-key-or-jwt.guard';

const IDEMPOTENCY_TTL_SEC = 24 * 3600; // docs/02 §3
const IDEMPOTENCY_PENDING = 'pending';
const idemKey = (key: string) => `idem:deploy:${key}`;

const DEPLOYMENT_INCLUDE = { project: { select: { key: true } } } as const;
type DeploymentRow = Prisma.DeploymentGetPayload<{ include: typeof DEPLOYMENT_INCLUDE }>;

/** Terminal statuses stamp finishedAt; FAILED/ROLLED_BACK also emit deployment.failed. */
const TERMINAL = new Set(['SUCCESS', 'FAILED', 'ROLLED_BACK']);

@Injectable()
export class DeploymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrgsService,
    private readonly redis: RedisService,
  ) {}

  /** D1/D2 — record a deployment; idempotent when Idempotency-Key is sent. */
  async record(
    actor: DeployActor,
    dto: RecordDeploymentDto,
    ctx: RequestContext,
    idempotencyKey?: string,
  ): Promise<{ deployment: DeploymentDto; replayed: boolean }> {
    await this.authorizeProject(actor, dto.projectId);

    // Claim the idempotency key before writing; a replay (or a concurrent
    // duplicate) waits for the winner's id instead of double-inserting.
    if (idempotencyKey) {
      const claimed = await this.redis.setIfAbsent(
        idemKey(idempotencyKey),
        IDEMPOTENCY_PENDING,
        IDEMPOTENCY_TTL_SEC,
      );
      // claimed === null → Redis degraded: proceed without idempotency (rule 7)
      if (claimed === false) {
        const existing = await this.awaitIdempotentResult(idempotencyKey);
        return { deployment: existing, replayed: true };
      }
    }

    const terminal = TERMINAL.has(dto.status);
    const deployment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.deployment.create({
        data: {
          projectId: dto.projectId,
          version: dto.version,
          environment: dto.environment,
          status: dto.status,
          triggeredBy:
            actor.kind === 'user' ? actor.user.email : `api-key:${actor.keyName}`,
          commitSha: dto.commitSha,
          durationSec: dto.durationSec,
          finishedAt: terminal ? new Date() : null,
          metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        include: DEPLOYMENT_INCLUDE,
      });
      await this.writeAuditAndEvents(tx, actor, created, 'deployment.recorded', ctx, {
        alsoFailed: dto.status === 'FAILED' || dto.status === 'ROLLED_BACK',
      });
      return created;
    });

    if (idempotencyKey) {
      await this.redis.setWithTtl(idemKey(idempotencyKey), deployment.id, IDEMPOTENCY_TTL_SEC);
    }
    await this.redis.del(`dash:summary:${dto.projectId}`);
    return { deployment: this.toDto(deployment), replayed: false };
  }

  /** D1 — CI records start (IN_PROGRESS) then completion/rollback. */
  async changeStatus(
    actor: DeployActor,
    id: string,
    dto: ChangeDeploymentStatusDto,
    ctx: RequestContext,
  ): Promise<DeploymentDto> {
    const existing = await this.prisma.deployment.findUnique({
      where: { id },
      include: DEPLOYMENT_INCLUDE,
    });
    if (!existing) throw new AppException(404, 'DEPLOYMENT_NOT_FOUND', 'No such deployment');
    await this.authorizeProject(actor, existing.projectId);

    const terminal = TERMINAL.has(dto.status);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.deployment.update({
        where: { id },
        data: {
          status: dto.status,
          durationSec: dto.durationSec ?? existing.durationSec,
          finishedAt: terminal ? (existing.finishedAt ?? new Date()) : existing.finishedAt,
        },
        include: DEPLOYMENT_INCLUDE,
      });
      await this.writeAuditAndEvents(tx, actor, row, 'deployment.status_changed', ctx, {
        alsoFailed: dto.status === 'FAILED' || dto.status === 'ROLLED_BACK',
        before: { status: existing.status },
      });
      return row;
    });

    await this.redis.del(`dash:summary:${existing.projectId}`);
    return this.toDto(updated);
  }

  /** D3 — history; maps to @@index([projectId, environment, startedAt desc]). */
  async list(
    actor: AccessTokenPayload,
    query: ListDeploymentsQuery,
  ): Promise<Paginated<DeploymentDto>> {
    const where: Prisma.DeploymentWhereInput = {
      project: { organizationId: actor.orgId },
      ...(query.projectId && { projectId: query.projectId }),
      ...(query.environment && { environment: query.environment }),
      ...(query.status && { status: query.status }),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.deployment.count({ where }),
      this.prisma.deployment.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: DEPLOYMENT_INCLUDE,
      }),
    ]);
    return {
      data: rows.map((r) => this.toDto(r)),
      meta: { total, page: query.page, pageSize: query.pageSize },
    };
  }

  /** D4 — org-scoped lookup for the incidents module (never its own Prisma). */
  async getForProject(actor: AccessTokenPayload, deploymentId: string, projectId: string) {
    const deployment = await this.prisma.deployment.findFirst({
      where: { id: deploymentId, projectId, project: { organizationId: actor.orgId } },
      include: DEPLOYMENT_INCLUDE,
    });
    if (!deployment) {
      throw new AppException(404, 'DEPLOYMENT_NOT_FOUND', 'No such deployment in this project');
    }
    return this.toDto(deployment);
  }

  private async authorizeProject(actor: DeployActor | AccessTokenPayload, projectId: string) {
    if ('kind' in actor && actor.kind === 'apiKey') {
      if (actor.projectId !== projectId) {
        throw new AppException(403, 'API_KEY_PROJECT_MISMATCH', 'This key belongs to a different project');
      }
      return;
    }
    const user = 'kind' in actor ? actor.user : actor;
    await this.orgs.getProject(user, projectId); // 404s cross-org
  }

  /** Replay path: the winner may still be inside its transaction — wait briefly. */
  private async awaitIdempotentResult(idempotencyKey: string): Promise<DeploymentDto> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const value = await this.redis.get(idemKey(idempotencyKey));
      if (value && value !== IDEMPOTENCY_PENDING) {
        const row = await this.prisma.deployment.findUnique({
          where: { id: value },
          include: DEPLOYMENT_INCLUDE,
        });
        if (row) return this.toDto(row);
        break; // stored id no longer resolves — fall through to conflict
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new AppException(
      409,
      'IDEMPOTENT_REQUEST_IN_FLIGHT',
      'A request with this Idempotency-Key is still being processed — retry shortly',
    );
  }

  private async writeAuditAndEvents(
    tx: Prisma.TransactionClient,
    actor: DeployActor,
    deployment: DeploymentRow,
    action: 'deployment.recorded' | 'deployment.status_changed',
    ctx: RequestContext,
    opts: { alsoFailed: boolean; before?: Record<string, unknown> },
  ) {
    const payload = {
      deploymentId: deployment.id,
      projectId: deployment.projectId,
      version: deployment.version,
      environment: deployment.environment,
      status: deployment.status,
      triggeredBy: deployment.triggeredBy,
    };
    await tx.auditLog.create({
      data: {
        actorId: actor.kind === 'user' ? actor.user.sub : null, // API-key writes have no user
        action,
        entityType: 'Deployment',
        entityId: deployment.id,
        before: opts.before as Prisma.InputJsonValue | undefined,
        after: { version: deployment.version, environment: deployment.environment, status: deployment.status },
        ip: ctx.ip,
      },
    });
    // Module table defines exactly two deployment events (docs/02 §2.2):
    // recorded once per deployment, failed on FAILED/ROLLED_BACK.
    if (action === 'deployment.recorded') {
      await tx.outboxEvent.create({ data: { routingKey: 'deployment.recorded', payload } });
    }
    if (opts.alsoFailed) {
      await tx.outboxEvent.create({ data: { routingKey: 'deployment.failed', payload } });
    }
  }

  private toDto(row: DeploymentRow): DeploymentDto {
    return {
      id: row.id,
      projectId: row.projectId,
      projectKey: row.project.key,
      version: row.version,
      environment: row.environment,
      status: row.status,
      triggeredBy: row.triggeredBy,
      commitSha: row.commitSha,
      durationSec: row.durationSec,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }
}
