import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ActivityItemDto,
  DashboardQuery,
  DashboardSummaryDto,
  IncidentSeverity,
  IncidentStatus,
  TrendPointDto,
} from '@opspilot/types';
import type { AccessTokenPayload } from '../auth/token.service';
import { OrgsService } from '../orgs/orgs.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const SUMMARY_TTL_SEC = 60; // M1: counts may be ≤60 s stale (docs/02 §2.4)
const ACTIVITY_TTL_SEC = 30;
const TREND_DAYS = 30;
const ACTIVITY_LIMIT = 20;

const STATUSES: IncidentStatus[] = ['OPEN', 'INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED'];
const SEVERITIES: IncidentSeverity[] = ['SEV1', 'SEV2', 'SEV3', 'SEV4'];

interface DayRow {
  day: Date;
  count: number;
}

/**
 * Read-model module (docs/02 §2.2): cross-entity aggregates behind
 * cache-aside Redis. Per-project summary keys are deleted by incident and
 * deployment writes; the org-wide key and activity rely on their TTLs.
 * Redis being down degrades to direct DB reads (rule 7).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrgsService,
    private readonly redis: RedisService,
  ) {}

  async summary(actor: AccessTokenPayload, query: DashboardQuery): Promise<DashboardSummaryDto> {
    // Validate before caching: a cross-org projectId must 404, never cache
    // zeros under a key the owning org will read (cache poisoning).
    if (query.projectId) await this.orgs.getProject(actor, query.projectId);
    const key = query.projectId
      ? `dash:summary:${query.projectId}`
      : `dash:summary:org:${actor.orgId}`;

    const cached = await this.readCache<DashboardSummaryDto>(key);
    if (cached) return cached;

    const summary = await this.computeSummary(actor.orgId, query.projectId);
    await this.redis.setWithTtl(key, JSON.stringify(summary), SUMMARY_TTL_SEC);
    return summary;
  }

  async activity(actor: AccessTokenPayload, query: DashboardQuery): Promise<ActivityItemDto[]> {
    if (query.projectId) await this.orgs.getProject(actor, query.projectId);
    const key = query.projectId
      ? `dash:activity:${query.projectId}`
      : `dash:activity:org:${actor.orgId}`;

    const cached = await this.readCache<ActivityItemDto[]>(key);
    if (cached) return cached;

    const events = await this.prisma.incidentTimelineEvent.findMany({
      where: {
        incident: {
          deletedAt: null,
          project: { organizationId: actor.orgId },
          ...(query.projectId && { projectId: query.projectId }),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: ACTIVITY_LIMIT,
      include: {
        actor: { select: { id: true, fullName: true } },
        incident: {
          select: { id: true, number: true, title: true, project: { select: { key: true } } },
        },
      },
    });
    const items: ActivityItemDto[] = events.map((e) => ({
      id: e.id,
      type: e.type,
      payload: e.payload,
      createdAt: e.createdAt.toISOString(),
      actor: e.actor,
      incident: {
        id: e.incident.id,
        displayNumber: `${e.incident.project.key}-${e.incident.number}`,
        title: e.incident.title,
      },
    }));

    await this.redis.setWithTtl(key, JSON.stringify(items), ACTIVITY_TTL_SEC);
    return items;
  }

  private async computeSummary(orgId: string, projectId?: string): Promise<DashboardSummaryDto> {
    const incidentWhere: Prisma.IncidentWhereInput = {
      deletedAt: null,
      project: { organizationId: orgId },
      ...(projectId && { projectId }),
    };
    const since = new Date(Date.now() - TREND_DAYS * 86_400_000);

    const [byStatus, bySeverity, deploysByStatus, opened, resolved, deploysDaily] =
      await Promise.all([
        this.prisma.incident.groupBy({ by: ['status'], where: incidentWhere, _count: true }),
        this.prisma.incident.groupBy({
          by: ['severity'],
          where: { ...incidentWhere, status: { not: 'RESOLVED' } }, // M1: open only
          _count: true,
        }),
        this.prisma.deployment.groupBy({
          by: ['status'],
          where: {
            project: { organizationId: orgId },
            ...(projectId && { projectId }),
            startedAt: { gte: since }, // M2: last 30 days
          },
          _count: true,
        }),
        this.trendQuery('i."createdAt"', orgId, since, projectId),
        this.trendQuery('i."resolvedAt"', orgId, since, projectId),
        this.deployTrendQuery(orgId, since, projectId),
      ]);

    const incidentsByStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
      IncidentStatus,
      number
    >;
    for (const row of byStatus) incidentsByStatus[row.status] = row._count;

    const openBySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<
      IncidentSeverity,
      number
    >;
    for (const row of bySeverity) openBySeverity[row.severity] = row._count;

    const total = deploysByStatus.reduce((sum, row) => sum + row._count, 0);
    const succeeded = deploysByStatus.find((r) => r.status === 'SUCCESS')?._count ?? 0;
    const failed = deploysByStatus
      .filter((r) => r.status === 'FAILED' || r.status === 'ROLLED_BACK')
      .reduce((sum, row) => sum + row._count, 0);

    return {
      incidentsByStatus,
      openBySeverity,
      deployments30d: {
        total,
        succeeded,
        failed,
        successRate: total > 0 ? Math.round((succeeded / total) * 1000) / 10 : null,
      },
      trends: {
        incidentsOpened: opened,
        incidentsResolved: resolved,
        deploysSucceeded: deploysDaily.filter((d) => d.succeeded).map(({ day, count }) => ({ day, count })),
        deploysFailed: deploysDaily.filter((d) => !d.succeeded).map(({ day, count }) => ({ day, count })),
      },
      computedAt: new Date().toISOString(),
    };
  }

  /** Daily counts for one incident timestamp column, org-scoped via Project. */
  private async trendQuery(
    column: string,
    orgId: string,
    since: Date,
    projectId?: string,
  ): Promise<TrendPointDto[]> {
    const col = Prisma.raw(column); // fixed set of callers, never user input
    const rows = await this.prisma.$queryRaw<DayRow[]>`
      SELECT date_trunc('day', ${col})::date AS "day", COUNT(*)::int AS "count"
      FROM "Incident" i
      JOIN "Project" p ON p."id" = i."projectId"
      WHERE p."organizationId" = ${orgId}::uuid
        AND i."deletedAt" IS NULL
        AND ${col} >= ${since}
        ${projectId ? Prisma.sql`AND i."projectId" = ${projectId}::uuid` : Prisma.empty}
      GROUP BY 1
      ORDER BY 1`;
    return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), count: r.count }));
  }

  /** Daily deployment outcomes: SUCCESS vs FAILED/ROLLED_BACK. */
  private async deployTrendQuery(
    orgId: string,
    since: Date,
    projectId?: string,
  ): Promise<Array<TrendPointDto & { succeeded: boolean }>> {
    const rows = await this.prisma.$queryRaw<Array<DayRow & { succeeded: boolean }>>`
      SELECT date_trunc('day', d."startedAt")::date AS "day",
             d."status" = 'SUCCESS' AS "succeeded",
             COUNT(*)::int AS "count"
      FROM "Deployment" d
      JOIN "Project" p ON p."id" = d."projectId"
      WHERE p."organizationId" = ${orgId}::uuid
        AND d."startedAt" >= ${since}
        AND d."status" IN ('SUCCESS', 'FAILED', 'ROLLED_BACK')
        ${projectId ? Prisma.sql`AND d."projectId" = ${projectId}::uuid` : Prisma.empty}
      GROUP BY 1, 2
      ORDER BY 1`;
    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      count: r.count,
      succeeded: r.succeeded,
    }));
  }

  /** Cache read that treats corrupt/missing/degraded identically: recompute. */
  private async readCache<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}
