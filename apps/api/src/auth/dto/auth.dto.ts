import { ApiProperty } from '@nestjs/swagger';

/**
 * Swagger documentation classes only — runtime validation is the Zod schemas
 * in @opspilot/types via ZodValidationPipe (architecture rule 2).
 */

export class SignupBody {
  @ApiProperty({ example: 'jane@example.com' })
  email!: string;

  @ApiProperty({ minLength: 8, example: 'hunter2hunter2' })
  password!: string;

  @ApiProperty({ example: 'Jane Doe' })
  fullName!: string;
}

export class LoginBody {
  @ApiProperty({ example: 'jane@example.com' })
  email!: string;

  @ApiProperty({ example: 'hunter2hunter2' })
  password!: string;
}

export class UpdateUserRoleBody {
  @ApiProperty({ enum: ['ADMIN', 'ENGINEER', 'VIEWER'] })
  role!: string;
}
