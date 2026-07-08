import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DeploymentsModule } from './deployments/deployments.module';
import { IncidentsModule } from './incidents/incidents.module';
import { OrgsModule } from './orgs/orgs.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    AuthModule,
    OrgsModule,
    IncidentsModule,
    DeploymentsModule,
    DashboardModule,
    // Feature modules land here as they are built:
    // NotificationsModule, MetricsModule, ...
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
