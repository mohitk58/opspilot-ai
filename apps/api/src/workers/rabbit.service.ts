import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

export const EVENTS_EXCHANGE = 'opspilot.events'; // topic, keys mirror event names
export const NOTIFICATIONS_QUEUE = 'q.notifications';
export const NOTIFICATIONS_RETRY_QUEUE = 'q.notifications.retry';
export const NOTIFICATIONS_DLQ = 'q.notifications.dlq';
export const AUDIT_QUEUE = 'q.audit';
export const AUDIT_DLQ = 'q.audit.dlq';

const RETRY_DELAY_MS = 5_000;
export const MAX_DELIVERY_ATTEMPTS = 3; // docs/02 §2.3

const NOTIFICATION_BINDINGS = [
  'incident.assigned',
  'incident.status_changed',
  'deployment.failed',
];

/**
 * amqplib wrapper owning the docs/02 §2.3 topology. Retry is the classic
 * TTL-backoff bounce: consumer nack → q.notifications.retry (5 s TTL, no
 * consumer) → dead-letters back to q.notifications. After
 * MAX_DELIVERY_ATTEMPTS the consumer parks the message in the DLQ itself.
 * q.audit is asserted so the documented topology exists, but has no consumer:
 * audit rows are written transactionally with each mutation (rule 4) —
 * consuming here would duplicate them with weaker guarantees.
 */
const RECONNECT_DELAY_MS = 5_000;

@Injectable()
export class RabbitService implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitService.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.ConfirmChannel;
  private shuttingDown = false;
  /** Registered consumers, re-attached after every (re)connect. */
  private readonly consumers: Array<{
    queue: string;
    handler: (msg: amqp.ConsumeMessage) => Promise<void>;
  }> = [];

  constructor(private readonly config: ConfigService) {}

  async connect(): Promise<amqp.ConfirmChannel> {
    if (this.channel) return this.channel;
    const url = this.config.get('RABBITMQ_URL') ?? 'amqp://opspilot:opspilot@localhost:5672';
    this.connection = await amqp.connect(url);
    this.connection.on('error', (err) => this.logger.error(`AMQP connection error: ${err.message}`));
    this.connection.on('close', () => {
      this.connection = undefined;
      this.channel = undefined;
      if (this.shuttingDown) return;
      // A broker restart must not orphan the consumers (docs/02 §7): keep
      // retrying until the topology is re-asserted and consumers re-attached.
      this.logger.warn(`AMQP connection closed — reconnecting in ${RECONNECT_DELAY_MS} ms`);
      this.scheduleReconnect();
    });

    const ch = await this.connection.createConfirmChannel();
    await ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });

    await ch.assertQueue(NOTIFICATIONS_QUEUE, {
      durable: true,
      // nack(requeue=false) → default exchange → retry queue
      deadLetterExchange: '',
      deadLetterRoutingKey: NOTIFICATIONS_RETRY_QUEUE,
    });
    await ch.assertQueue(NOTIFICATIONS_RETRY_QUEUE, {
      durable: true,
      messageTtl: RETRY_DELAY_MS,
      deadLetterExchange: '',
      deadLetterRoutingKey: NOTIFICATIONS_QUEUE, // bounce back after the delay
    });
    await ch.assertQueue(NOTIFICATIONS_DLQ, { durable: true });
    for (const key of NOTIFICATION_BINDINGS) {
      await ch.bindQueue(NOTIFICATIONS_QUEUE, EVENTS_EXCHANGE, key);
    }

    await ch.assertQueue(AUDIT_QUEUE, {
      durable: true,
      deadLetterExchange: '',
      deadLetterRoutingKey: AUDIT_DLQ,
    });
    await ch.assertQueue(AUDIT_DLQ, { durable: true });

    this.channel = ch;
    this.logger.log('AMQP topology asserted');

    // Re-attach consumers registered before a reconnect
    await ch.prefetch(10);
    for (const consumer of this.consumers) {
      await ch.consume(consumer.queue, (msg) => {
        if (!msg) return;
        void consumer.handler(msg).catch((err) =>
          this.logger.error(`Unhandled consumer error: ${(err as Error).message}`),
        );
      });
      this.logger.log(`Consumer (re)attached to ${consumer.queue}`);
    }
    return ch;
  }

  /** Retries until the broker is back; each failure schedules the next try. */
  private scheduleReconnect(): void {
    setTimeout(() => {
      void this.connect().catch((err) => {
        this.logger.error(`Reconnect failed, retrying: ${(err as Error).message}`);
        this.scheduleReconnect();
      });
    }, RECONNECT_DELAY_MS).unref();
  }

  /** Publish with broker confirmation (used by the outbox relay). */
  async publish(routingKey: string, message: object): Promise<void> {
    const ch = await this.connect();
    ch.publish(EVENTS_EXCHANGE, routingKey, Buffer.from(JSON.stringify(message)), {
      persistent: true,
      contentType: 'application/json',
    });
    await ch.waitForConfirms();
  }

  /** Park a poison message in a DLQ (bypasses the retry bounce). */
  async sendToDlq(queue: string, msg: amqp.ConsumeMessage): Promise<void> {
    const ch = await this.connect();
    ch.sendToQueue(queue, msg.content, {
      persistent: true,
      contentType: 'application/json',
      headers: { ...msg.properties.headers, 'x-original-routing-key': msg.fields.routingKey },
    });
    await ch.waitForConfirms();
  }

  /** Delivery attempts so far, derived from the x-death rejection count. */
  attemptsOf(msg: amqp.ConsumeMessage): number {
    const deaths = msg.properties.headers?.['x-death'] as
      | Array<{ count?: number; queue?: string }>
      | undefined;
    const rejections = deaths?.find((d) => d.queue === NOTIFICATIONS_QUEUE)?.count ?? 0;
    return Number(rejections) + 1; // current delivery
  }

  async consume(
    queue: string,
    handler: (msg: amqp.ConsumeMessage) => Promise<void>,
  ): Promise<void> {
    this.consumers.push({ queue, handler }); // survives reconnects
    const attachedVia = this.channel; // already connected → attach directly
    const ch = await this.connect();
    if (attachedVia) {
      await ch.consume(queue, (msg) => {
        if (!msg) return;
        void handler(msg).catch((err) =>
          this.logger.error(`Unhandled consumer error: ${(err as Error).message}`),
        );
      });
    }
    // otherwise connect() above just attached it from this.consumers
  }

  ack(msg: amqp.ConsumeMessage): void {
    this.channel?.ack(msg);
  }

  /** nack without requeue → DLX → retry queue → TTL → back here. */
  nackToRetry(msg: amqp.ConsumeMessage): void {
    this.channel?.nack(msg, false, false);
  }

  async onModuleDestroy() {
    this.shuttingDown = true; // suppress the reconnect loop
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}
