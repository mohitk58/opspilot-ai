import { createHash } from 'crypto';
import type { AccessTokenPayload } from '../auth/token.service';
import { OrgsService } from '../orgs/orgs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from './api-keys.service';

const NOW = new Date('2026-07-08T12:00:00Z');

const actor: AccessTokenPayload = {
  sub: 'user-1',
  orgId: 'org-1',
  email: 'ada@example.com',
  role: 'ADMIN',
};
const ctx = { ip: '127.0.0.1' };
const project = { id: 'proj-1', organizationId: 'org-1', key: 'PAY' };

function buildPrismaMock() {
  const prisma = {
    apiKey: {
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
  );
  return prisma;
}

describe('ApiKeysService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: ApiKeysService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildPrismaMock();
    const orgs = { getProject: jest.fn().mockResolvedValue(project) };
    service = new ApiKeysService(
      prisma as unknown as PrismaService,
      orgs as unknown as OrgsService,
    );
  });

  it('returns the plaintext exactly once and stores only its SHA-256 hash', async () => {
    prisma.apiKey.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...data, id: 'key-1', lastUsedAt: null, createdAt: NOW, revokedAt: null }),
    );

    const created = await service.create(actor, 'proj-1', { name: 'github-actions' }, ctx);

    expect(created.plaintextKey).toMatch(/^opk_[0-9a-f]{48}$/);
    const stored = prisma.apiKey.create.mock.calls[0][0].data;
    expect(stored.keyHash).toBe(
      createHash('sha256').update(created.plaintextKey).digest('hex'),
    );
    expect(stored.keyHash).not.toContain(created.plaintextKey);
    expect(created.prefix).toBe(created.plaintextKey.slice(0, 8));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'api_key.created' }) }),
    );
  });

  it('verify() resolves an active key by hash and stamps lastUsedAt', async () => {
    prisma.apiKey.findFirst.mockResolvedValue({ id: 'key-1', projectId: 'proj-1', name: 'ci' });

    const key = await service.verify('opk_abc');

    expect(prisma.apiKey.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          keyHash: createHash('sha256').update('opk_abc').digest('hex'),
          revokedAt: null,
        }),
      }),
    );
    expect(key).toMatchObject({ projectId: 'proj-1' });
  });

  it('verify() returns null for unknown or revoked keys', async () => {
    prisma.apiKey.findFirst.mockResolvedValue(null);
    expect(await service.verify('opk_nope')).toBeNull();
  });

  it('revoke() 404s for keys outside the org or already revoked', async () => {
    prisma.apiKey.findFirst.mockResolvedValue(null);
    await expect(service.revoke(actor, 'key-9', ctx)).rejects.toMatchObject({
      code: 'API_KEY_NOT_FOUND',
    });
  });

  it('revoke() sets revokedAt and audits', async () => {
    prisma.apiKey.findFirst.mockResolvedValue({ id: 'key-1', name: 'ci', prefix: 'opk_a1b2' });

    await service.revoke(actor, 'key-1', ctx);

    expect(prisma.apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'api_key.revoked' }) }),
    );
  });
});
