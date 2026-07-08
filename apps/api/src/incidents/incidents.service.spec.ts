import { AppException } from '../common/app.exception';
import { DeploymentsService } from '../deployments/deployments.service';
import { OrgsService } from '../orgs/orgs.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { IncidentsService } from './incidents.service';

const NOW = new Date('2026-07-08T12:00:00Z');

const actor = {
  sub: 'user-1',
  orgId: 'org-1',
  email: 'jane@example.com',
  role: 'ENGINEER' as const,
};
const ctx = { ip: '127.0.0.1' };

const project = { id: 'proj-1', organizationId: 'org-1', key: 'PAY', name: 'Payments' };
const assignee = { id: 'user-2', fullName: 'Sam Ops', email: 'sam@example.com' };

const incidentRow = {
  id: 'inc-1',
  projectId: 'proj-1',
  number: 1,
  title: 'Checkout latency spike',
  description: 'p99 at 4s',
  severity: 'SEV2',
  status: 'OPEN',
  createdById: 'user-1',
  assigneeId: null,
  deploymentId: null,
  createdAt: NOW,
  updatedAt: NOW,
  resolvedAt: null,
  deletedAt: null,
  createdBy: { id: 'user-1', fullName: 'Jane Doe', email: 'jane@example.com' },
  assignee: null,
  project: { key: 'PAY' },
};

function buildPrismaMock() {
  const prisma = {
    incident: {
      create: jest.fn().mockResolvedValue(incidentRow),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    incidentTimelineEvent: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    outboxEvent: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ number: 1 }]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
  );
  return prisma;
}

function buildOrgsMock() {
  return {
    getProject: jest.fn().mockResolvedValue(project),
    getOrgUser: jest.fn().mockResolvedValue(assignee),
  };
}

function buildRedisMock() {
  return { del: jest.fn().mockResolvedValue(1) };
}

const linkedDeployment = { id: 'deploy-1', version: 'v2.14.0', environment: 'PRODUCTION' };

function buildDeploymentsMock() {
  return { getForProject: jest.fn().mockResolvedValue(linkedDeployment) };
}

describe('IncidentsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let orgs: ReturnType<typeof buildOrgsMock>;
  let deployments: ReturnType<typeof buildDeploymentsMock>;
  let redis: ReturnType<typeof buildRedisMock>;
  let service: IncidentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildPrismaMock();
    orgs = buildOrgsMock();
    deployments = buildDeploymentsMock();
    redis = buildRedisMock();
    service = new IncidentsService(
      prisma as unknown as PrismaService,
      orgs as unknown as OrgsService,
      deployments as unknown as DeploymentsService,
      redis as unknown as RedisService,
    );
  });

  const createDto = {
    projectId: 'proj-1',
    title: 'Checkout latency spike',
    description: 'p99 at 4s',
    severity: 'SEV2' as const,
  };

  describe('create (I1)', () => {
    it('claims a race-safe number and writes incident + timeline + audit + outbox in one tx', async () => {
      const result = await service.create(actor, createDto, ctx);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1); // atomic UPDATE..RETURNING
      expect(prisma.incident.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ projectId: 'proj-1', number: 1 }),
        }),
      );
      expect(prisma.incidentTimelineEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'CREATED' }) }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'incident.created', entityType: 'Incident' }),
        }),
      );
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ routingKey: 'incident.created' }),
        }),
      );
      expect(result.displayNumber).toBe('PAY-1');
      expect(redis.del).toHaveBeenCalledWith('dash:summary:proj-1');
    });

    it('adds an ASSIGNED timeline event when created with an assignee', async () => {
      await service.create(actor, { ...createDto, assigneeId: assignee.id }, ctx);

      expect(orgs.getOrgUser).toHaveBeenCalledWith(actor, assignee.id);
      const types = prisma.incidentTimelineEvent.create.mock.calls.map((c) => c[0].data.type);
      expect(types).toEqual(['CREATED', 'ASSIGNED']);
    });

    it('links a deployment (D4): validates same-project and writes LINKED_DEPLOYMENT', async () => {
      await service.create(actor, { ...createDto, deploymentId: 'deploy-1' }, ctx);

      expect(deployments.getForProject).toHaveBeenCalledWith(actor, 'deploy-1', 'proj-1');
      const types = prisma.incidentTimelineEvent.create.mock.calls.map((c) => c[0].data.type);
      expect(types).toContain('LINKED_DEPLOYMENT');
    });

    it('rejects a deployment from another project (404) before writing anything', async () => {
      deployments.getForProject.mockRejectedValue(
        new AppException(404, 'DEPLOYMENT_NOT_FOUND', 'No such deployment in this project'),
      );
      await expect(
        service.create(actor, { ...createDto, deploymentId: 'deploy-9' }, ctx),
      ).rejects.toMatchObject({ code: 'DEPLOYMENT_NOT_FOUND' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('propagates 404 from the org-scoped project lookup', async () => {
      orgs.getProject.mockRejectedValue(new AppException(404, 'PROJECT_NOT_FOUND', 'No such project'));
      await expect(service.create(actor, createDto, ctx)).rejects.toMatchObject({
        code: 'PROJECT_NOT_FOUND',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('changeStatus (I2)', () => {
    beforeEach(() => {
      prisma.incident.findFirst.mockResolvedValue(incidentRow);
      prisma.incident.update.mockResolvedValue({ ...incidentRow, status: 'INVESTIGATING' });
    });

    it('accepts a legal transition and writes timeline + audit + outbox', async () => {
      const result = await service.changeStatus(actor, 'inc-1', { status: 'INVESTIGATING' }, ctx);

      expect(result.status).toBe('INVESTIGATING');
      expect(prisma.incidentTimelineEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'STATUS_CHANGED',
            payload: { from: 'OPEN', to: 'INVESTIGATING' },
          }),
        }),
      );
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ routingKey: 'incident.status_changed' }),
        }),
      );
      expect(redis.del).toHaveBeenCalledWith('dash:summary:proj-1');
    });

    it('rejects an illegal transition with 422 and writes nothing', async () => {
      await expect(
        service.changeStatus(actor, 'inc-1', { status: 'MONITORING' }, ctx),
      ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });

      const err = await service
        .changeStatus(actor, 'inc-1', { status: 'MONITORING' }, ctx)
        .catch((e: AppException) => e);
      expect((err as AppException).getStatus()).toBe(422);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('stamps resolvedAt when transitioning to RESOLVED (feeds MTTR/I5)', async () => {
      prisma.incident.findFirst.mockResolvedValue({ ...incidentRow, status: 'MONITORING' });
      prisma.incident.update.mockResolvedValue({
        ...incidentRow,
        status: 'RESOLVED',
        resolvedAt: NOW,
      });

      await service.changeStatus(actor, 'inc-1', { status: 'RESOLVED' }, ctx);

      expect(prisma.incident.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'RESOLVED', resolvedAt: expect.any(Date) }),
        }),
      );
    });

    it('404s on incidents outside the actor org', async () => {
      prisma.incident.findFirst.mockResolvedValue(null);
      await expect(
        service.changeStatus(actor, 'inc-1', { status: 'INVESTIGATING' }, ctx),
      ).rejects.toMatchObject({ code: 'INCIDENT_NOT_FOUND' });
    });
  });

  describe('update (I1/I6)', () => {
    beforeEach(() => {
      prisma.incident.findFirst.mockResolvedValue(incidentRow);
      prisma.incident.update.mockResolvedValue({ ...incidentRow, assigneeId: assignee.id, assignee });
    });

    it('assignment writes ASSIGNED timeline + incident.assigned outbox', async () => {
      await service.update(actor, 'inc-1', { assigneeId: assignee.id }, ctx);

      expect(prisma.incidentTimelineEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'ASSIGNED',
            payload: { assigneeId: assignee.id, assigneeName: assignee.fullName },
          }),
        }),
      );
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ routingKey: 'incident.assigned' }),
        }),
      );
    });

    it('severity change writes SEVERITY_CHANGED', async () => {
      prisma.incident.update.mockResolvedValue({ ...incidentRow, severity: 'SEV1' });
      await service.update(actor, 'inc-1', { severity: 'SEV1' }, ctx);

      expect(prisma.incidentTimelineEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'SEVERITY_CHANGED',
            payload: { from: 'SEV2', to: 'SEV1' },
          }),
        }),
      );
    });

    it('title-only edits audit but do not spam the timeline', async () => {
      prisma.incident.update.mockResolvedValue({ ...incidentRow, title: 'New title' });
      await service.update(actor, 'inc-1', { title: 'New title' }, ctx);

      expect(prisma.incidentTimelineEvent.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'incident.updated' }) }),
      );
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('addComment (I3)', () => {
    it('appends a COMMENT event with audit + outbox', async () => {
      prisma.incident.findFirst.mockResolvedValue(incidentRow);
      prisma.incidentTimelineEvent.create.mockResolvedValue({
        id: 'evt-1',
        type: 'COMMENT',
        payload: { body: 'on it' },
        createdAt: NOW,
        actor: { id: 'user-1', fullName: 'Jane Doe' },
      });

      const event = await service.addComment(actor, 'inc-1', { body: 'on it' }, ctx);

      expect(event).toMatchObject({ type: 'COMMENT', payload: { body: 'on it' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'incident.commented' }) }),
      );
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ routingKey: 'incident.commented' }),
        }),
      );
    });
  });

  describe('list (I4)', () => {
    it('org-scopes and maps filters into the where clause', async () => {
      prisma.incident.count.mockResolvedValue(1);
      prisma.incident.findMany.mockResolvedValue([incidentRow]);

      const result = await service.list(actor, {
        status: 'OPEN',
        severity: 'SEV2',
        q: 'latency',
        page: 2,
        pageSize: 10,
      });

      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            project: { organizationId: 'org-1' },
            status: 'OPEN',
            severity: 'SEV2',
            title: { contains: 'latency', mode: 'insensitive' },
          }),
          skip: 10,
          take: 10,
        }),
      );
      expect(result.meta).toEqual({ total: 1, page: 2, pageSize: 10 });
      expect(result.data[0].displayNumber).toBe('PAY-1');
    });
  });

  describe('timeline (I2/I3)', () => {
    it('returns events oldest-first with the pagination envelope', async () => {
      prisma.incident.findFirst.mockResolvedValue(incidentRow);
      prisma.incidentTimelineEvent.count.mockResolvedValue(1);
      prisma.incidentTimelineEvent.findMany.mockResolvedValue([
        {
          id: 'evt-1',
          type: 'CREATED',
          payload: {},
          createdAt: NOW,
          actor: { id: 'user-1', fullName: 'Jane Doe' },
        },
      ]);

      const result = await service.timeline(actor, 'inc-1', { page: 1, pageSize: 25 });

      expect(prisma.incidentTimelineEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
      );
      expect(result.data[0]).toMatchObject({ id: 'evt-1', type: 'CREATED' });
      expect(result.meta.total).toBe(1);
    });
  });
});
