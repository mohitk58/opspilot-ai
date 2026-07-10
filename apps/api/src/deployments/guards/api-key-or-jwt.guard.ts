import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AccessTokenPayload } from '../../auth/token.service';
import { AppException } from '../../common/app.exception';
import { ApiKeysService } from '../api-keys.service';

export type DeployActor =
  | { kind: 'user'; user: AccessTokenPayload }
  | { kind: 'apiKey'; keyId: string; projectId: string; keyName: string };

export type IngestRequest = Request & { deployActor?: DeployActor };

/**
 * Dual auth for deployment ingestion (D1 + D2): a valid X-API-Key wins;
 * otherwise a Bearer JWT with a write-capable role. Routes using this guard
 * are @Public so the global JwtAuthGuard defers to it.
 */
@Injectable()
export class ApiKeyOrJwtGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<IngestRequest>();

    const apiKey = req.headers['x-api-key'];
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      const key = await this.apiKeys.verify(apiKey);
      if (!key) throw new AppException(401, 'INVALID_API_KEY', 'API key is invalid or revoked');
      req.deployActor = { kind: 'apiKey', keyId: key.id, projectId: key.projectId, keyName: key.name };
      return true;
    }

    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new AppException(401, 'MISSING_CREDENTIALS', 'Provide X-API-Key or a bearer token');
    }
    let user: AccessTokenPayload;
    try {
      user = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new AppException(401, 'INVALID_TOKEN', 'Access token is invalid or expired');
    }
    if (user.role === 'VIEWER') {
      throw new AppException(403, 'FORBIDDEN_ROLE', 'Viewers cannot record deployments');
    }
    req.deployActor = { kind: 'user', user };
    return true;
  }
}
