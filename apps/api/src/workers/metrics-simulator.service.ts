import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const TICK_MS = 15_000;
const SERVICES = ['api', 'worker'] as const;

interface SeriesState {
  latencyP95: number;
  errorRate: number;
}

/**
 * M3 data source until real telemetry exists: a bounded random walk per
 * project+service writes latency_p95_ms and error_rate rows every 15 s.
 * Values drift plausibly (occasional spikes) instead of white noise so the
 * dashboard charts look like a system, not static.
 */
@Injectable()
export class MetricsSimulatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsSimulatorService.name);
  private timer?: NodeJS.Timeout;
  private readonly state = new Map<string, SeriesState>();

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.logger.log(`Simulating metrics every ${TICK_MS / 1000} s`);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** One tick; returns rows written (exposed for tests). */
  async tick(): Promise<number> {
    const projects = await this.prisma.project.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    const rows = projects.flatMap((project) =>
      SERVICES.flatMap((service) => {
        const s = this.next(`${project.id}:${service}`);
        return [
          { projectId: project.id, service, metric: 'latency_p95_ms', value: s.latencyP95 },
          { projectId: project.id, service, metric: 'error_rate', value: s.errorRate },
        ];
      }),
    );
    if (rows.length === 0) return 0;

    await this.prisma.systemMetric.createMany({ data: rows });
    return rows.length;
  }

  private next(key: string): SeriesState {
    const prev = this.state.get(key) ?? { latencyP95: 180 + Math.random() * 120, errorRate: 0.5 };
    const spike = Math.random() < 0.03; // rare incident-shaped bump
    const next: SeriesState = {
      latencyP95: clamp(prev.latencyP95 + (Math.random() - 0.5) * 30 + (spike ? 400 : 0), 40, 3000),
      errorRate: clamp(prev.errorRate + (Math.random() - 0.5) * 0.3 + (spike ? 4 : 0), 0, 25),
    };
    this.state.set(key, next);
    return { latencyP95: Math.round(next.latencyP95), errorRate: Math.round(next.errorRate * 100) / 100 };
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
