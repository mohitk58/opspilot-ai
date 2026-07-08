import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [OrgsModule], // project validation only — aggregates are its own read models
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
