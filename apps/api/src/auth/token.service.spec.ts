import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../redis/redis.service';
import { parseTtlSec, TokenService } from './token.service';

const config = {
  getOrThrow: jest.fn((key: string) => `${key}-secret`),
  get: jest.fn(() => undefined), // fall back to default TTLs
};

const redis = {
  get: jest.fn(),
  setWithTtl: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
};

describe('TokenService', () => {
  let service: TokenService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TokenService(
      new JwtService(),
      config as unknown as ConfigService,
      redis as unknown as RedisService,
    );
  });

  it('signs an access token verifiable with the access secret', async () => {
    const payload = { sub: 'u1', email: 'a@b.co', role: 'ENGINEER' as const, orgId: 'o1' };
    const token = await service.signAccessToken(payload);
    const decoded = await new JwtService().verifyAsync(token, {
      secret: 'JWT_ACCESS_SECRET-secret',
    });
    expect(decoded).toMatchObject(payload);
  });

  it('signs a refresh token whose jti round-trips through verify', async () => {
    const { token, jti } = await service.signRefreshToken('u1');
    const payload = await service.verifyRefreshToken(token);
    expect(payload).toMatchObject({ sub: 'u1', jti });
  });

  it('returns null for a refresh token signed with the wrong secret', async () => {
    const forged = await new JwtService().signAsync(
      { sub: 'u1', jti: 'x' },
      { secret: 'wrong', expiresIn: '7d' },
    );
    await expect(service.verifyRefreshToken(forged)).resolves.toBeNull();
  });

  it('hashes deterministically with SHA-256', () => {
    expect(service.hash('abc')).toBe(service.hash('abc'));
    expect(service.hash('abc')).toMatch(/^[a-f0-9]{64}$/);
    expect(service.hash('abc')).not.toBe(service.hash('abd'));
  });

  it('parses TTL strings into seconds and rejects garbage', () => {
    expect(parseTtlSec('7d')).toBe(604_800);
    expect(parseTtlSec('15m')).toBe(900);
    expect(parseTtlSec('3600')).toBe(3600);
    expect(() => parseTtlSec('soon')).toThrow(/Unparseable TTL/);
  });

  it('derives one refresh TTL for both the default config and the allowlist', async () => {
    expect(service.refreshTtlSec).toBe(604_800); // JWT_REFRESH_TTL unset → 7d default
    await service.allowlist('jti-1', 'u1');
    expect(redis.setWithTtl).toHaveBeenCalledWith('refresh:jti-1', 'u1', service.refreshTtlSec);

    redis.get.mockResolvedValue('u1');
    await expect(service.isAllowlisted('jti-1')).resolves.toBe('u1');
    expect(redis.get).toHaveBeenCalledWith('refresh:jti-1');

    await service.removeFromAllowlist('jti-1', 'jti-2');
    expect(redis.del).toHaveBeenCalledWith('refresh:jti-1', 'refresh:jti-2');
  });
});
