import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardQuery } from '@opspilot/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../auth/token.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Aggregate counts, 30-day rates and trends (M1/M2) — cached ≤60 s',
  })
  summary(
    @Query(new ZodValidationPipe(DashboardQuery)) query: DashboardQuery,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    return this.dashboard.summary(actor, query);
  }

  @Get('activity')
  @ApiOperation({ summary: 'Recent timeline events across projects (M4) — cached ≤30 s' })
  activity(
    @Query(new ZodValidationPipe(DashboardQuery)) query: DashboardQuery,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    return this.dashboard.activity(actor, query);
  }
}
