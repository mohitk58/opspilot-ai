import { createHash, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@opspilot/types';
import { RedisService } from '../redis/redis.service';

export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  role: Role;
  orgId: string;
}

export interface RefreshTokenPayload {
  sub: string; // user id
  jti: string; // RefreshToken row id — enables rotation-chain lookups
}

const TTL_UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Parses '7d' / '15m' / '3600' into seconds; the JWT, DB row, cookie and Redis key all derive from this. */
export function parseTtlSec(ttl: string): number {
  const match = /^(\d+)([smhd]?)$/.exec(ttl.trim());
  if (!match) throw new Error(`Unparseable TTL "${ttl}" — use e.g. "7d", "15m" or seconds`);
  return Number(match[1]) * (TTL_UNITS[match[2]] ?? 1);
}

const redisKey = (jti: string) => `refresh:${jti}`;

/**
 * JWT issuance/verification and the refresh-token allowlist (docs/02 §2.6).
 * Refresh tokens are high-entropy JWTs stored only as SHA-256 hashes at rest;
 * the Redis allowlist (`refresh:{jti}`, 7 d TTL) is the fast path and the DB
 * row is the fallback when Redis is degraded.
 */
@Injectable()
export class TokenService {
  /** Single source of truth for refresh lifetime (JWT exp, DB expiresAt, cookie maxAge, Redis TTL). */
  readonly refreshTtlSec: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.refreshTtlSec = parseTtlSec(this.config.get('JWT_REFRESH_TTL') ?? '7d');
  }

  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_TTL') ?? '15m',
    });
  }

  /** Generates the jti client-side so the JWT and the DB row share an id. */
  async signRefreshToken(userId: string): Promise<{ token: string; jti: string }> {
    const jti = randomUUID();
    const token = await this.jwt.signAsync({ sub: userId, jti } satisfies RefreshTokenPayload, {
      secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      expiresIn: this.refreshTtlSec,
    });
    return { token, jti };
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload | null> {
    try {
      return await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
    } catch {
      return null;
    }
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Allowlist hit returns the userId; null means miss OR Redis degraded — fall back to DB. */
  isAllowlisted(jti: string): Promise<string | null> {
    return this.redis.get(redisKey(jti));
  }

  allowlist(jti: string, userId: string): Promise<unknown> {
    return this.redis.setWithTtl(redisKey(jti), userId, this.refreshTtlSec);
  }

  removeFromAllowlist(...jtis: string[]): Promise<unknown> {
    return this.redis.del(...jtis.map(redisKey));
  }
}
