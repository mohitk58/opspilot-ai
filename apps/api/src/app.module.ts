import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    // Feature modules land here as they are built:
    // AuthModule, IncidentsModule, DeploymentsModule, DashboardModule, ...
  ],
  controllers: [HealthController],
})
export class AppModule {}
