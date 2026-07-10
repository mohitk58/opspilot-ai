import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkersModule } from './workers.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkersModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks(); // clean AMQP close + interval teardown
  app
    .get(Logger)
    .log('OpsPilot workers running (relay, notifications, metrics simulator)', 'Workers');
}

void bootstrap();
