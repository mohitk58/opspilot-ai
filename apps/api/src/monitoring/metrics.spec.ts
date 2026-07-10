import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { cacheOps, httpErrors, httpRequestDuration, registry } from './metrics';
import { MetricsInterceptor } from './metrics.interceptor';

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    get: jest.fn(),
    quit: jest.fn(),
  }));
});

function httpContext(status: number, routePath = '/api/v1/incidents/:id') {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', route: { path: routePath } }),
      getResponse: () => ({ statusCode: status }),
    }),
  } as unknown as ExecutionContext;
}

describe('MetricsInterceptor', () => {
  beforeEach(() => registry.resetMetrics());

  it('observes the duration histogram with route-pattern labels', async () => {
    const interceptor = new MetricsInterceptor();
    await new Promise((resolve) =>
      interceptor
        .intercept(httpContext(200), { handle: () => of('ok') } as CallHandler)
        .subscribe({ complete: () => resolve(undefined) }),
    );

    const metric = await httpRequestDuration.get();
    const count = metric.values.find(
      (v) =>
        v.metricName === 'http_request_duration_seconds_count' &&
        v.labels.route === '/api/v1/incidents/:id' &&
        v.labels.status === '200',
    );
    expect(count?.value).toBe(1);
  });

  it('counts 5xx responses as errors, including thrown handlers', async () => {
    const interceptor = new MetricsInterceptor();
    await new Promise((resolve) =>
      interceptor
        .intercept(httpContext(500), {
          handle: () => throwError(() => new Error('boom')),
        } as CallHandler)
        .subscribe({ error: () => resolve(undefined) }),
    );

    const metric = await httpErrors.get();
    expect(metric.values[0]?.value).toBe(1);
  });
});

describe('RedisService cache counters', () => {
  beforeEach(() => registry.resetMetrics());

  function build(getImpl: jest.Mock) {
    const service = new RedisService({ get: () => undefined } as unknown as ConfigService);
    // Replace the mocked ioredis client's get with the scenario under test
    (service as unknown as { client: { get: jest.Mock } }).client.get = getImpl;
    return service;
  }

  async function valueOf(result: 'hit' | 'miss' | 'degraded') {
    const metric = await cacheOps.get();
    return metric.values.find((v) => v.labels.result === result && v.labels.prefix === 'dash')
      ?.value;
  }

  it('counts hits, misses and degraded reads by key prefix', async () => {
    expect(await build(jest.fn().mockResolvedValue('{"a":1}')).get('dash:summary:x')).toBe('{"a":1}');
    expect(await valueOf('hit')).toBe(1);

    expect(await build(jest.fn().mockResolvedValue(null)).get('dash:summary:x')).toBeNull();
    expect(await valueOf('miss')).toBe(1);

    expect(await build(jest.fn().mockRejectedValue(new Error('down'))).get('dash:summary:x')).toBeNull();
    expect(await valueOf('degraded')).toBe(1);
  });
});
