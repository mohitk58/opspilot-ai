import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AccessTokenPayload } from '../auth/token.service';
import type { MetricSeriesDto, MetricsQuery } from '@opspilot/types';
import { OrgsService } from '../orgs/orgs.service';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_WINDOW_MS = 3_600_000; // last hour
const MAX_POINTS = 5_000; // hard cap; the simulator writes 4 points/min/project

/**
 * SystemMetric read API (M3). Owns metric reads per the docs/02 module
 * table; the Prometheus registry joins this module in the Ops phase.
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrgsService,
  ) {}

  async system(actor: AccessTokenPayload, query: MetricsQuery): Promise<MetricSeriesDto[]> {
    if (query.projectId) await this.orgs.getProject(actor, query.projectId); // cross-org → 404
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - DEFAULT_WINDOW_MS);

    const where: Prisma.SystemMetricWhereInput = {
      project: { organizationId: actor.orgId },
      ...(query.projectId && { projectId: query.projectId }),
      ...(query.service && { service: query.service }),
      ...(query.metric && { metric: query.metric }),
      recordedAt: { gte: from, lte: to },
    };

    // @@index([projectId, service, metric, recordedAt]) carries this read
    const rows = await this.prisma.systemMetric.findMany({
      where,
      orderBy: { recordedAt: 'asc' },
      take: MAX_POINTS,
      select: { service: true, metric: true, value: true, recordedAt: true },
    });

    // Org-wide reads span projects that share a tick timestamp — average
    // same (service, metric, t) samples so one line means one series, not
    // N interleaved random walks.
    const acc = new Map<string, Map<string, { sum: number; n: number }>>();
    for (const row of rows) {
      const key = `${row.service}:${row.metric}`;
      const t = row.recordedAt.toISOString();
      const points = acc.get(key) ?? new Map();
      const cell = points.get(t) ?? { sum: 0, n: 0 };
      cell.sum += row.value;
      cell.n += 1;
      points.set(t, cell);
      acc.set(key, points);
    }
    return [...acc.entries()].map(([key, points]) => {
      const [service, metric] = key.split(':');
      return {
        service,
        metric,
        points: [...points.entries()].map(([t, { sum, n }]) => ({
          t,
          value: Math.round((sum / n) * 100) / 100,
        })),
      };
    });
  }
}
