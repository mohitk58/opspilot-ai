import type { AccessTokenPayload } from '../auth/token.service';
import { OrgsService } from '../orgs/orgs.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { DeploymentsService } from './deployments.service';
import type { DeployActor } from './guards/api-key-or-jwt.guard';

const NOW = new Date('2026-07-08T12:00:00Z');

const user: AccessTokenPayload = {
  sub: 'user-1',
  orgId: 'org-1',
  email: 'evan@example.com',
  role: 'ENGINEER',
};
const userActor: DeployActor = { kind: 'user', user };
const keyActor: DeployActor = { kind: 'apiKey', keyId: 'key-1', projectId: 'proj-1', keyName: 'ci' };
const ctx = { ip: '127.0.0.1' };

const project = { id: 'proj-1', organizationId: 'org-1', key: 'PAY' };

const deploymentRow = {
  id: 'deploy-1',
  projectId: 'proj-1',
  version: 'v2.14.0',
  environment: 'PRODUCTION',
  status: 'IN_PROGRESS',
  triggeredBy: 'api-key:ci',
  commitSha: null,
  durationSec: null,
  startedAt: NOW,
  finishedAt: null,
  metadata: null,
  project: { key: 'PAY' },
};

const recordDto = {
  projectId: 'proj-1',
  version: 'v2.14.0',
  environment: 'PRODUCTION' as const,
  status: 'IN_PROGRESS' as const,
};

function buildPrismaMock() {
  const prisma = {
    deployment: {
      create: jest.fn().mockResolvedValue(deploymentRow),
      update: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    outboxEvent: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
  );
  return prisma;
}

function buildRedisMock() {
  return {
    get: jest.fn().mockResolvedValue(null),
    setWithTtl: jest.fn().mockResolvedValue('OK'),
    setIfAbsent: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(1),
  };
}

function buildOrgsMock() {
  return { getProject: jest.fn().mockResolvedValue(project) };
}

describe('DeploymentsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let orgs: ReturnType<typeof buildOrgsMock>;
  let redis: ReturnType<typeof buildRedisMock>;
  let service: DeploymentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildPrismaMock();
    orgs = buildOrgsMock();
    redis = buildRedisMock();
    service = new DeploymentsService(
      prisma as unknown as PrismaService,
      orgs as unknown as OrgsService,
      redis as unknown as RedisService,
    );
  });

  describe('record (D1/D2)', () => {
    it('records via JWT actor: org-scoped project check, audit + outbox in one tx', async () => {
      const { deployment, replayed } = await service.record(userActor, recordDto, ctx);

      expect(orgs.getProject).toHaveBeenCalledWith(user, 'proj-1');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'deployment.recorded', actorId: 'user-1' }),
        }),
      );
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ routingKey: 'deployment.recorded' }),
        }),
      );
      expect(deployment.projectKey).toBe('PAY');
      expect(replayed).toBe(false);
      expect(redis.del).toHaveBeenCalledWith('dash:summary:proj-1');
    });

    it('records via API key with a null audit actor and api-key triggeredBy', async () => {
      await service.record(keyActor, recordDto, ctx);

      expect(orgs.getProject).not.toHaveBeenCalled(); // key pins the project
      expect(prisma.deployment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ triggeredBy: 'api-key:ci' }),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ actorId: null }) }),
      );
    });

    it('403s when the API key belongs to a different project', async () => {
      await expect(
        service.record(keyActor, { ...recordDto, projectId: 'proj-2' }, ctx),
      ).rejects.toMatchObject({ code: 'API_KEY_PROJECT_MISMATCH' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('emits deployment.failed additionally when recorded as FAILED', async () => {
      prisma.deployment.create.mockResolvedValue({ ...deploymentRow, status: 'FAILED' });
      await service.record(keyActor, { ...recordDto, status: 'FAILED' }, ctx);

      const keys = prisma.outboxEvent.create.mock.calls.map((c) => c[0].data.routingKey);
      expect(keys).toEqual(['deployment.recorded', 'deployment.failed']);
    });

    it('replays an idempotent request instead of double-inserting', async () => {
      redis.setIfAbsent.mockResolvedValue(false); // someone already claimed the key
      redis.get.mockResolvedValue('deploy-1');
      prisma.deployment.findUnique.mockResolvedValue(deploymentRow);

      const { deployment, replayed } = await service.record(keyActor, recordDto, ctx, 'idem-1');

      expect(replayed).toBe(true);
      expect(deployment.id).toBe('deploy-1');
      expect(prisma.deployment.create).not.toHaveBeenCalled();
    });

    it('stores the deployment id under the idempotency key after creating', async () => {
      await service.record(keyActor, recordDto, ctx, 'idem-1');

      expect(redis.setIfAbsent).toHaveBeenCalledWith('idem:deploy:idem-1', 'pending', 86400);
      expect(redis.setWithTtl).toHaveBeenCalledWith('idem:deploy:idem-1', 'deploy-1', 86400);
    });

    it('proceeds without idempotency when Redis is degraded (rule 7)', async () => {
      redis.setIfAbsent.mockResolvedValue(null);
      const { replayed } = await service.record(keyActor, recordDto, ctx, 'idem-1');
      expect(replayed).toBe(false);
      expect(prisma.deployment.create).toHaveBeenCalled();
    });
  });

  describe('changeStatus (D1)', () => {
    beforeEach(() => {
      prisma.deployment.findUnique.mockResolvedValue(deploymentRow);
      prisma.deployment.update.mockResolvedValue({
        ...deploymentRow,
        status: 'FAILED',
        finishedAt: NOW,
      });
    });

    it('stamps finishedAt on terminal statuses and emits deployment.failed', async () => {
      const result = await service.changeStatus(keyActor, 'deploy-1', { status: 'FAILED' }, ctx);

      expect(result.status).toBe('FAILED');
      expect(prisma.deployment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', finishedAt: expect.any(Date) }),
        }),
      );
      const keys = prisma.outboxEvent.create.mock.calls.map((c) => c[0].data.routingKey);
      expect(keys).toEqual(['deployment.failed']); // no duplicate .recorded
    });

    it('404s on unknown deployments', async () => {
      prisma.deployment.findUnique.mockResolvedValue(null);
      await expect(
        service.changeStatus(userActor, 'deploy-9', { status: 'SUCCESS' }, ctx),
      ).rejects.toMatchObject({ code: 'DEPLOYMENT_NOT_FOUND' });
    });
  });

  describe('list (D3)', () => {
    it('org-scopes and maps env/status filters', async () => {
      prisma.deployment.count.mockResolvedValue(1);
      prisma.deployment.findMany.mockResolvedValue([deploymentRow]);

      const result = await service.list(user, {
        environment: 'PRODUCTION',
        status: 'IN_PROGRESS',
        page: 1,
        pageSize: 25,
      });

      expect(prisma.deployment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            project: { organizationId: 'org-1' },
            environment: 'PRODUCTION',
            status: 'IN_PROGRESS',
          }),
          orderBy: { startedAt: 'desc' },
        }),
      );
      expect(result.meta.total).toBe(1);
    });
  });

  describe('getForProject (D4)', () => {
    it('404s when the deployment is not in the given project', async () => {
      prisma.deployment.findFirst.mockResolvedValue(null);
      await expect(service.getForProject(user, 'deploy-1', 'proj-2')).rejects.toMatchObject({
        code: 'DEPLOYMENT_NOT_FOUND',
      });
    });
  });
});
