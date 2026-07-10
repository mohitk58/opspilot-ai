import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

const redisMock = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  on: jest.fn(),
  quit: jest.fn().mockResolvedValue('OK'),
  disconnect: jest.fn(),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(() => redisMock),
}));

describe('RedisService degradation contract (architecture rule 7)', () => {
  let service: RedisService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RedisService({ get: () => 'redis://test' } as unknown as ConfigService);
  });

  it('passes through a healthy GET', async () => {
    redisMock.get.mockResolvedValue('value');
    await expect(service.get('k')).resolves.toBe('value');
  });

  it('returns the fallback when Redis errors instead of throwing', async () => {
    redisMock.get.mockRejectedValue(new Error('connection refused'));
    await expect(service.get('k')).resolves.toBeNull();
  });

  it('times out after 100 ms and degrades instead of hanging the request', async () => {
    redisMock.get.mockImplementation(() => new Promise(() => undefined)); // never resolves
    const start = Date.now();
    await expect(service.get('k')).resolves.toBeNull();
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('degrades SET and DEL the same way', async () => {
    redisMock.set.mockRejectedValue(new Error('down'));
    redisMock.del.mockRejectedValue(new Error('down'));
    await expect(service.setWithTtl('k', 'v', 60)).resolves.toBeNull();
    await expect(service.del('k')).resolves.toBeNull();
  });
});
