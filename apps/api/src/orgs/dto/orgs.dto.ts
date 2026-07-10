import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger documentation classes only — runtime validation is the Zod schemas
 * in @opspilot/types via ZodValidationPipe (architecture rule 2).
 */

export class CreateProjectBody {
  @ApiProperty({ example: 'Payments' })
  name!: string;

  @ApiProperty({ example: 'PAY', description: '2-10 uppercase letters/digits; prefixes incident numbers (PAY-42)' })
  key!: string;

  @ApiPropertyOptional({ example: 'Payment processing and billing services' })
  description?: string;
}

export class AddProjectMemberBody {
  @ApiProperty({ format: 'uuid' })
  userId!: string;
}
