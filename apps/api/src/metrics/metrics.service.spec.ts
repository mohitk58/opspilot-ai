import type { AccessTokenPayload } from '../auth/token.service';
import { OrgsService } from '../orgs/orgs.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics.service';

const NOW = new Date('2026-07-09T08:00:00Z');

const actor: AccessTokenPayload = {
  sub: 'user-1',
  orgId: 'org-1',
  email: 'vera@example.com',
  role: 'VIEWER',
};

function buildPrismaMock() {
  return {
    systemMetric: {
      findMany: jest.fn().mockResolvedValue([
        { service: 'api', metric: 'latency_p95_ms', value: 210, recordedAt: NOW },
        { service: 'api', metric: 'latency_p95_ms', value: 230, recordedAt: new Date(NOW.getTime() + 15_000) },
        { service: 'worker', metric: 'error_rate', value: 0.4, recordedAt: NOW },
      ]),
    },
  };
}

describe('MetricsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let orgs: { getProject: jest.Mock };
  let service: MetricsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildPrismaMock();
    orgs = { getProject: jest.fn().mockResolvedValue({ id: 'proj-1' }) };
    service = new MetricsService(
      prisma as unknown as PrismaService,
      orgs as unknown as OrgsService,
    );
  });

  it('groups rows into per-service/metric series, org-scoped, defaulting to the last hour', async () => {
    const series = await service.system(actor, {});

    const where = prisma.systemMetric.findMany.mock.calls[0][0].where;
    expect(where.project).toEqual({ organizationId: 'org-1' });
    expect(where.recordedAt.gte).toBeInstanceOf(Date);
    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({ service: 'api', metric: 'latency_p95_ms' });
    expect(series[0].points).toHaveLength(2);
    expect(series[0].points[0]).toEqual({ t: NOW.toISOString(), value: 210 });
  });

  it('validates cross-org projectId through OrgsService (404 path)', async () => {
    orgs.getProject.mockRejectedValue(Object.assign(new Error('nope'), { code: 'PROJECT_NOT_FOUND' }));
    await expect(service.system(actor, { projectId: 'proj-9' })).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
    });
    expect(prisma.systemMetric.findMany).not.toHaveBeenCalled();
  });

  it('passes service/metric filters through', async () => {
    await service.system(actor, { service: 'api', metric: 'error_rate' });
    expect(prisma.systemMetric.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ service: 'api', metric: 'error_rate' }),
      }),
    );
  });
});
