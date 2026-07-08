import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const COMMAND_TIMEOUT_MS = 100;

/**
 * Cache-aside Redis access (architecture rule 7): every command is capped at
 * 100 ms and failures degrade to `null`/no-op so callers fall back to the DB —
 * Redis being down must never take a request down.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.get('REDIS_URL') ?? 'redis://localhost:6379', {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.client.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  /** Runs a command with the degradation contract: timeout/failure → fallback. */
  private async safe<T>(op: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await Promise.race([
        op(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('redis timeout')), COMMAND_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      this.logger.warn(`Redis degraded: ${(err as Error).message}`);
      return fallback;
    }
  }

  get(key: string): Promise<string | null> {
    return this.safe(() => this.client.get(key), null);
  }

  setWithTtl(key: string, value: string, ttlSec: number): Promise<unknown> {
    return this.safe(() => this.client.set(key, value, 'EX', ttlSec), null);
  }

  /** SET NX EX — true if this call claimed the key, null when Redis is degraded. */
  setIfAbsent(key: string, value: string, ttlSec: number): Promise<boolean | null> {
    return this.safe(
      async () => (await this.client.set(key, value, 'EX', ttlSec, 'NX')) === 'OK',
      null,
    );
  }

  del(...keys: string[]): Promise<unknown> {
    if (keys.length === 0) return Promise.resolve(null);
    return this.safe(() => this.client.del(...keys), null);
  }
}
