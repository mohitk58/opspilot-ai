import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MetricsQuery } from '@opspilot/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../auth/token.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@ApiBearerAuth()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('system')
  @ApiOperation({ summary: 'System metric time series (M3) — defaults to the last hour' })
  system(
    @Query(new ZodValidationPipe(MetricsQuery)) query: MetricsQuery,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    return this.metrics.system(actor, query);
  }
}
