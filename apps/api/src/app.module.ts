import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DeploymentsModule } from './deployments/deployments.module';
import { IncidentsModule } from './incidents/incidents.module';
import { MetricsModule } from './metrics/metrics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrgsModule } from './orgs/orgs.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { HealthController } from './health/health.controller';
import { MetricsInterceptor } from './monitoring/metrics.interceptor';
import { PrometheusController } from './monitoring/prometheus.controller';
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
    NotificationsModule,
    MetricsModule,
  ],
  controllers: [HealthController, PrometheusController],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
})
export class AppModule {}
