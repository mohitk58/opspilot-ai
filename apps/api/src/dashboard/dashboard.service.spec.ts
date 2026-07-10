import type { AccessTokenPayload } from '../auth/token.service';
import { OrgsService } from '../orgs/orgs.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { DashboardService } from './dashboard.service';

const NOW = new Date('2026-07-08T12:00:00Z');

const actor: AccessTokenPayload = {
  sub: 'user-1',
  orgId: 'org-1',
  email: 'vera@example.com',
  role: 'VIEWER',
};

function buildPrismaMock() {
  return {
    incident: { groupBy: jest.fn().mockResolvedValue([]) },
    deployment: { groupBy: jest.fn().mockResolvedValue([]) },
    incidentTimelineEvent: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
}

function buildRedisMock() {
  return {
    get: jest.fn().mockResolvedValue(null),
    setWithTtl: jest.fn().mockResolvedValue('OK'),
  };
}

function buildOrgsMock() {
  return { getProject: jest.fn().mockResolvedValue({ id: 'proj-1' }) };
}

describe('DashboardService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let redis: ReturnType<typeof buildRedisMock>;
  let orgs: ReturnType<typeof buildOrgsMock>;
  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildPrismaMock();
    redis = buildRedisMock();
    orgs = buildOrgsMock();
    service = new DashboardService(
      prisma as unknown as PrismaService,
      orgs as unknown as OrgsService,
      redis as unknown as RedisService,
    );
  });

  describe('summary (M1/M2)', () => {
    it('cache hit short-circuits the database entirely', async () => {
      const cached = { incidentsByStatus: { OPEN: 7 }, computedAt: NOW.toISOString() };
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.summary(actor, {});

      expect(result).toEqual(cached);
      expect(redis.get).toHaveBeenCalledWith('dash:summary:org:org-1');
      expect(prisma.incident.groupBy).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(redis.setWithTtl).not.toHaveBeenCalled();
    });

    it('cache miss computes, stores with 60 s TTL, and returns zero-filled maps', async () => {
      prisma.incident.groupBy
        .mockResolvedValueOnce([{ status: 'OPEN', _count: 3 }]) // by status
        .mockResolvedValueOnce([{ severity: 'SEV1', _count: 2 }]); // open by severity
      prisma.deployment.groupBy.mockResolvedValue([
        { status: 'SUCCESS', _count: 8 },
        { status: 'FAILED', _count: 1 },
        { status: 'ROLLED_BACK', _count: 1 },
      ]);

      const result = await service.summary(actor, {});

      expect(result.incidentsByStatus).toEqual({
        OPEN: 3,
        INVESTIGATING: 0,
        IDENTIFIED: 0,
        MONITORING: 0,
        RESOLVED: 0,
      });
      expect(result.openBySeverity.SEV1).toBe(2);
      expect(result.openBySeverity.SEV4).toBe(0);
      expect(result.deployments30d).toEqual({
        total: 10,
        succeeded: 8,
        failed: 2,
        successRate: 80,
      });
      expect(redis.setWithTtl).toHaveBeenCalledWith(
        'dash:summary:org:org-1',
        expect.any(String),
        60,
      );
    });

    it('uses the write-invalidated per-project key — byte-identical to what writers delete', async () => {
      await service.summary(actor, { projectId: 'proj-1' });
      // incidents/deployments services call redis.del(`dash:summary:${projectId}`)
      expect(redis.get).toHaveBeenCalledWith('dash:summary:proj-1');
      expect(redis.setWithTtl).toHaveBeenCalledWith('dash:summary:proj-1', expect.any(String), 60);
    });

    it('404s a cross-org projectId before touching the cache (no poisoning)', async () => {
      orgs.getProject.mockRejectedValue(Object.assign(new Error('nope'), { code: 'PROJECT_NOT_FOUND' }));

      await expect(service.summary(actor, { projectId: 'proj-9' })).rejects.toMatchObject({
        code: 'PROJECT_NOT_FOUND',
      });
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.setWithTtl).not.toHaveBeenCalled();
    });

    it('serves from the DB when Redis is degraded (get returns null, set no-ops)', async () => {
      redis.get.mockResolvedValue(null); // RedisService returns null on failure
      const result = await service.summary(actor, {});
      expect(result.incidentsByStatus.OPEN).toBe(0);
      expect(prisma.incident.groupBy).toHaveBeenCalled();
    });

    it('treats corrupt cache entries as a miss', async () => {
      redis.get.mockResolvedValue('{not json');
      await service.summary(actor, {});
      expect(prisma.incident.groupBy).toHaveBeenCalled();
    });

    it('reports a null success rate when there were no deployments', async () => {
      const result = await service.summary(actor, {});
      expect(result.deployments30d.successRate).toBeNull();
    });

    it('maps daily trend rows to ISO dates', async () => {
      prisma.$queryRaw.mockResolvedValue([{ day: new Date('2026-07-01T00:00:00Z'), count: 4 }]);
      const result = await service.summary(actor, {});
      expect(result.trends.incidentsOpened).toEqual([{ day: '2026-07-01', count: 4 }]);
    });
  });

  describe('activity (M4)', () => {
    const event = {
      id: 'evt-1',
      type: 'STATUS_CHANGED',
      payload: { from: 'OPEN', to: 'INVESTIGATING' },
      createdAt: NOW,
      actor: { id: 'user-1', fullName: 'Vera Viewer' },
      incident: { id: 'inc-1', number: 42, title: 'Latency spike', project: { key: 'PAY' } },
    };

    it('cache miss reads events org-wide, maps display numbers, stores 30 s', async () => {
      prisma.incidentTimelineEvent.findMany.mockResolvedValue([event]);

      const result = await service.activity(actor, {});

      expect(result[0]).toMatchObject({
        id: 'evt-1',
        incident: { displayNumber: 'PAY-42', title: 'Latency spike' },
      });
      expect(prisma.incidentTimelineEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' }, take: 20 }),
      );
      expect(redis.setWithTtl).toHaveBeenCalledWith(
        'dash:activity:org:org-1',
        expect.any(String),
        30,
      );
    });

    it('cache hit skips the database', async () => {
      redis.get.mockResolvedValue(JSON.stringify([{ id: 'evt-9' }]));
      const result = await service.activity(actor, {});
      expect(result).toEqual([{ id: 'evt-9' }]);
      expect(prisma.incidentTimelineEvent.findMany).not.toHaveBeenCalled();
    });
  });
});
