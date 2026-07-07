import { SetMetadata } from '@nestjs/common';
import type { Role } from '@opspilot/types';

export const ROLES_KEY = 'roles';

/** Restricts a route to the given roles; enforced by the global RolesGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
