import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import type { NotificationType } from '@opspilot/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAX_DELIVERY_ATTEMPTS,
  NOTIFICATIONS_DLQ,
  NOTIFICATIONS_QUEUE,
  RabbitService,
} from './rabbit.service';

interface EventEnvelope {
  eventId: string;
  routingKey: string;
  payload: Record<string, unknown>;
}

interface Recipient {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
}

/**
 * N1: assignment/status/deploy-failure events become in-app notifications.
 * At-least-once delivery is made idempotent by the unique
 * sourceEventId (`${eventId}:${userId}`) — replays skipDuplicates to a no-op.
 */
@Injectable()
export class NotificationsConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotificationsConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitService,
  ) {}

  async onModuleInit() {
    await this.rabbit.consume(NOTIFICATIONS_QUEUE, (msg) => this.onMessage(msg));
    this.logger.log(`Consuming ${NOTIFICATIONS_QUEUE}`);
  }

  async onMessage(msg: ConsumeMessage): Promise<void> {
    try {
      await this.handle(JSON.parse(msg.content.toString()) as EventEnvelope);
      this.rabbit.ack(msg);
    } catch (err) {
      const attempt = this.rabbit.attemptsOf(msg);
      this.logger.warn(`Delivery ${attempt}/${MAX_DELIVERY_ATTEMPTS} failed: ${(err as Error).message}`);
      if (attempt >= MAX_DELIVERY_ATTEMPTS) {
        await this.rabbit.sendToDlq(NOTIFICATIONS_DLQ, msg); // poison — park it
        this.rabbit.ack(msg);
      } else {
        this.rabbit.nackToRetry(msg); // TTL-backoff bounce
      }
    }
  }

  /** Exposed for unit tests; throwing here triggers the retry path. */
  async handle(envelope: EventEnvelope): Promise<void> {
    const recipients = await this.recipientsFor(envelope);
    if (recipients.length === 0) return;

    await this.prisma.notification.createMany({
      data: recipients.map((r) => ({
        userId: r.userId,
        type: r.type,
        title: r.title,
        body: r.body,
        link: r.link,
        sourceEventId: `${envelope.eventId}:${r.userId}`,
      })),
      skipDuplicates: true, // replayed delivery → no-op (unique sourceEventId)
    });
  }

  private async recipientsFor(envelope: EventEnvelope): Promise<Recipient[]> {
    const { routingKey, payload } = envelope;

    switch (routingKey) {
      case 'incident.assigned': {
        const assigneeId = payload.assigneeId as string | null;
        const actorId = payload.actorId as string | undefined;
        if (!assigneeId || assigneeId === actorId) return [];
        const incident = await this.incident(payload.incidentId as string);
        if (!incident) return [];
        return [
          {
            userId: assigneeId,
            type: 'INCIDENT_ASSIGNED',
            title: `You were assigned ${incident.display}`,
            body: incident.title,
            link: `/incidents/${incident.id}`,
          },
        ];
      }

      case 'incident.status_changed': {
        const incident = await this.incident(payload.incidentId as string);
        if (!incident) return [];
        const actorId = payload.actorId as string | undefined;
        const interested = new Set(
          [incident.createdById, incident.assigneeId].filter(
            (id): id is string => !!id && id !== actorId,
          ),
        );
        return [...interested].map((userId) => ({
          userId,
          type: 'INCIDENT_STATUS' as const,
          title: `${incident.display} moved to ${String(payload.to)}`,
          body: incident.title,
          link: `/incidents/${incident.id}`,
        }));
      }

      case 'deployment.failed': {
        const members = await this.prisma.projectMember.findMany({
          where: { projectId: payload.projectId as string },
          select: { userId: true },
        });
        const version = String(payload.version ?? 'unknown');
        const env = String(payload.environment ?? '');
        return members.map(({ userId }) => ({
          userId,
          type: 'DEPLOYMENT_FAILED' as const,
          title: `Deployment ${version} ${String(payload.status ?? 'FAILED').toLowerCase().replace('_', ' ')} in ${env}`,
          body: `Triggered by ${String(payload.triggeredBy ?? 'unknown')}`,
          link: '/deployments',
        }));
      }

      default:
        // Not ours (topology may add bindings before code) — ack and move on
        return [];
    }
  }

  private async incident(id: string) {
    const incident = await this.prisma.incident.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        number: true,
        createdById: true,
        assigneeId: true,
        project: { select: { key: true } },
      },
    });
    return incident ? { ...incident, display: `${incident.project.key}-${incident.number}` } : null;
  }
}
