import type { IncomingMessage } from 'http';
import { extractUserId, isNoisyRequest, resolveLogLevel, resolveRequestId } from './logger';

function req(overrides: Record<string, unknown> = {}): IncomingMessage {
  return { headers: {}, ...overrides } as unknown as IncomingMessage;
}

describe('resolveRequestId (FR-5 propagation)', () => {
  it('reuses an incoming x-request-id header', () => {
    const id = resolveRequestId(req({ headers: { 'x-request-id': 'client-set-id' } } as never));
    expect(id).toBe('client-set-id');
  });

  it('generates a UUID when no header is present', () => {
    const id = resolveRequestId(req());
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('takes the first value when the header is duplicated', () => {
    const id = resolveRequestId(req({ headers: { 'x-request-id': ['first', 'second'] } } as never));
    expect(id).toBe('first');
  });
});

describe('extractUserId', () => {
  it('returns sub when req.user is set (post-guard)', () => {
    expect(extractUserId(req({ user: { sub: 'user-1' } } as never))).toBe('user-1');
  });

  it('returns undefined for unauthenticated requests', () => {
    expect(extractUserId(req())).toBeUndefined();
  });
});

describe('isNoisyRequest', () => {
  it('suppresses /metrics and /api/v1/health (scrape/health polling)', () => {
    expect(isNoisyRequest(req({ url: '/metrics' } as never))).toBe(true);
    expect(isNoisyRequest(req({ url: '/api/v1/health' } as never))).toBe(true);
  });

  it('does not suppress other routes', () => {
    expect(isNoisyRequest(req({ url: '/api/v1/incidents' } as never))).toBe(false);
  });
});

describe('resolveLogLevel', () => {
  it('LOG_LEVEL always wins', () => {
    expect(resolveLogLevel({ LOG_LEVEL: 'warn', NODE_ENV: 'production' })).toBe('warn');
  });

  it('defaults to info in production', () => {
    expect(resolveLogLevel({ NODE_ENV: 'production' })).toBe('info');
  });

  it('defaults to debug outside production', () => {
    expect(resolveLogLevel({ NODE_ENV: 'development' })).toBe('debug');
    expect(resolveLogLevel({})).toBe('debug');
  });
});
