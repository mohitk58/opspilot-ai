import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RabbitService } from './rabbit.service';

const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 50;

/**
 * The other half of the outbox pattern (docs/03 §3): business writes insert
 * OutboxEvent rows transactionally; this relay publishes them to RabbitMQ
 * and stamps publishedAt. At-least-once — a crash between publish and stamp
 * republishes, which is why consumers dedupe on the event id.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.drainOnce(), POLL_INTERVAL_MS);
    this.logger.log(`Relay polling every ${POLL_INTERVAL_MS} ms`);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** One poll cycle; returns how many events were published. */
  async drainOnce(): Promise<number> {
    if (this.draining) return 0; // ticks must not overlap
    this.draining = true;
    try {
      const pending = await this.prisma.outboxEvent.findMany({
        where: { publishedAt: null },
        orderBy: { createdAt: 'asc' }, // preserve event order
        take: BATCH_SIZE,
      });

      let published = 0;
      for (const event of pending) {
        try {
          await this.rabbit.publish(event.routingKey, {
            eventId: event.id,
            routingKey: event.routingKey,
            occurredAt: event.createdAt.toISOString(),
            payload: event.payload,
          });
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { publishedAt: new Date() },
          });
          published += 1;
        } catch (err) {
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { attempts: { increment: 1 } },
          });
          this.logger.warn(
            `Publish failed for ${event.routingKey} (${event.id}): ${(err as Error).message}`,
          );
          break; // broker likely down — stop the batch, next tick retries
        }
      }
      return published;
    } finally {
      this.draining = false;
    }
  }
}
