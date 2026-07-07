import { Body, Controller, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UpdateUserRoleDto } from '@opspilot/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
import { UpdateUserRoleBody } from './dto/auth.dto';
import { AccessTokenPayload } from './token.service';

/**
 * Role management (story A4). Lives in the auth module because it is pure
 * access control; splits into a users module when user CRUD grows beyond it.
 */
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Patch(':id/role')
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assign a role (A4, ADMIN only) — applies on next token refresh' })
  @ApiBody({ type: UpdateUserRoleBody })
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateUserRoleDto)) dto: UpdateUserRoleDto,
    @CurrentUser() actor: AccessTokenPayload,
    @Req() req: Request,
  ) {
    return this.auth.updateRole(actor, id, dto, { ip: req.ip });
  }
}
