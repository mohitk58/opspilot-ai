import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../../common/app.exception';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

function contextFor(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const jwt = new JwtService();
  const config = { getOrThrow: jest.fn().mockReturnValue('test-secret') };
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    guard = new JwtAuthGuard(
      jwt,
      config as unknown as ConfigService,
      reflector as unknown as Reflector,
    );
  });

  it('lets @Public() routes through without a token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(contextFor({ headers: {} }))).resolves.toBe(true);
  });

  it('rejects a missing Authorization header with 401 MISSING_TOKEN', async () => {
    const err = await guard.canActivate(contextFor({ headers: {} })).catch((e) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('MISSING_TOKEN');
  });

  it('rejects a malformed/expired token with 401 INVALID_TOKEN', async () => {
    const expired = await jwt.signAsync({ sub: 'u1' }, { secret: 'test-secret', expiresIn: '0s' });
    const err = await guard
      .canActivate(contextFor({ headers: { authorization: `Bearer ${expired}` } }))
      .catch((e) => e);
    expect((err as AppException).code).toBe('INVALID_TOKEN');
  });

  it('accepts a valid token and attaches the payload as req.user', async () => {
    const token = await jwt.signAsync(
      { sub: 'u1', role: 'ENGINEER' },
      { secret: 'test-secret', expiresIn: '15m' },
    );
    const req: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` } };
    await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);
    expect(req.user).toMatchObject({ sub: 'u1', role: 'ENGINEER' });
  });
});

describe('RolesGuard (A5)', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows routes without @Roles metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(contextFor({ user: { role: 'VIEWER' } }))).toBe(true);
  });

  it('returns 403 FORBIDDEN_ROLE for a VIEWER on a write-protected route', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN', 'ENGINEER']);
    expect(() => guard.canActivate(contextFor({ user: { role: 'VIEWER' } }))).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN_ROLE' }),
    );
  });

  it('allows a matching role', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    expect(guard.canActivate(contextFor({ user: { role: 'ADMIN' } }))).toBe(true);
  });
});
