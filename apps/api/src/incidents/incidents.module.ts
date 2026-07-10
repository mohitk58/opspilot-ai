import { Module } from '@nestjs/common';
import { DeploymentsModule } from '../deployments/deployments.module';
import { OrgsModule } from '../orgs/orgs.module';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

@Module({
  // Cross-module lookups stay behind exported services (rule 1):
  // projects/users via OrgsService, deployment links (D4) via DeploymentsService.
  imports: [OrgsModule, DeploymentsModule],
  controllers: [IncidentsController],
  providers: [IncidentsService],
})
export class IncidentsModule {}
