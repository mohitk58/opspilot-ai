import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@opspilot/types';
import { AppException } from '../../common/app.exception';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AccessTokenPayload } from '../token.service';

/**
 * Global RBAC guard (story A5): routes annotated with @Roles(...) return 403
 * for any other role. Runs after JwtAuthGuard, so req.user is populated.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user: AccessTokenPayload | undefined = ctx.switchToHttp().getRequest().user;
    if (!user || !required.includes(user.role)) {
      throw new AppException(403, 'FORBIDDEN_ROLE', 'Your role does not permit this action');
    }
    return true;
  }
}
