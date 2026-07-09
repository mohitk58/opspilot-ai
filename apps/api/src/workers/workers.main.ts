import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkersModule } from './workers.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkersModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.enableShutdownHooks(); // clean AMQP close + interval teardown
  new Logger('Workers').log('OpsPilot workers running (relay, notifications, metrics simulator)');
}

void bootstrap();
