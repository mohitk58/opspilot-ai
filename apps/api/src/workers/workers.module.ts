import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggingModule } from '../monitoring/logging.module';
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
  // Same LoggingModule as the API (docs/02 §5): pinoHttp's request-specific
  // options (genReqId, redact, autoLogging) simply never fire without an
  // HTTP server — the underlying pino instance still backs every Logger call.
  imports: [ConfigModule.forRoot({ isGlobal: true }), LoggingModule, PrismaModule],
  providers: [RabbitService, OutboxRelayService, NotificationsConsumer, MetricsSimulatorService],
})
export class WorkersModule {}
