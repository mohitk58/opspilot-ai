import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  imports: [OrgsModule], // project validation only
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
