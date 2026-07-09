import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricsSimulatorService } from './metrics-simulator.service';
import { NotificationsConsumer } from './notifications.consumer';
import { OutboxRelayService } from './outbox-relay.service';
import { RabbitService } from './rabbit.service';

/**
 * Root module of the worker process (no HTTP): outbox relay, notification
 * consumer, metrics simulator. Same codebase as the API, separate lifecycle —
 * a worker crash never touches request serving (docs/02 §2.3).
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  providers: [RabbitService, OutboxRelayService, NotificationsConsumer, MetricsSimulatorService],
})
export class WorkersModule {}
