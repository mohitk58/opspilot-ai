import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger documentation classes only — runtime validation is the Zod schemas
 * in @opspilot/types via ZodValidationPipe (architecture rule 2).
 */

const ENVIRONMENTS = ['DEV', 'STAGING', 'PRODUCTION'];
const STATUSES = ['PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'ROLLED_BACK'];

export class RecordDeploymentBody {
  @ApiProperty({ format: 'uuid' })
  projectId!: string;

  @ApiProperty({ example: 'v2.14.0' })
  version!: string;

  @ApiProperty({ enum: ENVIRONMENTS })
  environment!: string;

  @ApiProperty({ enum: STATUSES })
  status!: string;

  @ApiPropertyOptional({ example: '4f2ea1b' })
  commitSha?: string;

  @ApiPropertyOptional({ example: 312 })
  durationSec?: number;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  metadata?: Record<string, unknown>;
}

export class ChangeDeploymentStatusBody {
  @ApiProperty({ enum: STATUSES.filter((s) => s !== 'PENDING') })
  status!: string;

  @ApiPropertyOptional({ example: 312 })
  durationSec?: number;
}

export class CreateApiKeyBody {
  @ApiProperty({ example: 'github-actions' })
  name!: string;
}
