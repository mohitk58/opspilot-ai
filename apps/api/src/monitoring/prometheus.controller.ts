import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { outboxPending, registry } from './metrics';

/**
 * Prometheus scrape target at bare /metrics (excluded from the /api/v1
 * prefix in main.ts). Unauthenticated by design but INTERNAL ONLY — the
 * prod reverse proxy must not route it publicly (docs/02 §3).
 */
@ApiExcludeController()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class PrometheusController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async metrics(): Promise<string> {
    // Collect-on-scrape: one cheap count per scrape interval
    outboxPending.set(await this.prisma.outboxEvent.count({ where: { publishedAt: null } }));
    return registry.metrics();
  }
}
