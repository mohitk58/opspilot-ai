import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger documentation classes only — runtime validation is the Zod schemas
 * in @opspilot/types via ZodValidationPipe (architecture rule 2).
 */

const SEVERITIES = ['SEV1', 'SEV2', 'SEV3', 'SEV4'];
const STATUSES = ['OPEN', 'INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED'];

export class CreateIncidentBody {
  @ApiProperty({ format: 'uuid' })
  projectId!: string;

  @ApiProperty({ example: 'Checkout latency spike in eu-west-1' })
  title!: string;

  @ApiProperty({ example: 'p99 jumped from 300ms to 4s after the 14:02 deploy.' })
  description!: string;

  @ApiProperty({ enum: SEVERITIES })
  severity!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  assigneeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  deploymentId?: string;
}

export class UpdateIncidentBody {
  @ApiPropertyOptional()
  title?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional({ enum: SEVERITIES })
  severity?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'null unassigns' })
  assigneeId?: string | null;
}

export class ChangeIncidentStatusBody {
  @ApiProperty({ enum: STATUSES })
  status!: string;

  @ApiPropertyOptional({ example: 'Rolled back the 14:02 deploy, watching dashboards.' })
  comment?: string;
}

export class AddCommentBody {
  @ApiProperty({ example: 'Correlates with the payments-api deploy at 14:02.' })
  body!: string;
}
