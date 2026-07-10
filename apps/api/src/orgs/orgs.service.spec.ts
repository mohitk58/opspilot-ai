import { PrismaService } from '../prisma/prisma.service';
import { OrgsService } from './orgs.service';

const NOW = new Date('2026-07-08T12:00:00Z');

const actor = {
  sub: 'user-1',
  orgId: 'org-1',
  email: 'admin@example.com',
  role: 'ADMIN' as const,
};
const ctx = { ip: '127.0.0.1' };

const project = {
  id: 'proj-1',
  organizationId: 'org-1',
  name: 'Payments',
  key: 'PAY',
  description: null,
  nextIncidentNumber: 1,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

function buildPrismaMock() {
  const prisma = {
    project: {
      create: jest.fn().mockResolvedValue(project),
      findFirst: jest.fn().mockResolvedValue(project),
      findMany: jest.fn().mockResolvedValue([project]),
      count: jest.fn().mockResolvedValue(1),
    },
    projectMember: {
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
  );
  return prisma;
}

describe('OrgsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: OrgsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildPrismaMock();
    service = new OrgsService(prisma as unknown as PrismaService);
  });

  describe('createProject (O1)', () => {
    it('creates in the actor org and audits', async () => {
      const result = await service.createProject(actor, { name: 'Payments', key: 'PAY' }, ctx);

      expect(prisma.project.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-1' }) }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'project.created' }) }),
      );
      expect(result).toBe(project);
    });

    it('maps duplicate keys to 409 PROJECT_KEY_TAKEN', async () => {
      prisma.project.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
      await expect(
        service.createProject(actor, { name: 'Payments', key: 'PAY' }, ctx),
      ).rejects.toMatchObject({ code: 'PROJECT_KEY_TAKEN' });
    });
  });

  describe('listProjects', () => {
    it('returns the pagination envelope scoped to the org', async () => {
      const result = await service.listProjects(actor, { page: 1, pageSize: 25 });
      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1', deletedAt: null } }),
      );
      expect(result.meta).toEqual({ total: 1, page: 1, pageSize: 25 });
    });
  });

  describe('addMember (O2)', () => {
    it('404s when the user is not in the org', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.addMember(actor, 'proj-1', { userId: 'user-9' }, ctx),
      ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    });

    it('maps duplicate membership to 409 ALREADY_MEMBER', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2' });
      prisma.projectMember.create.mockRejectedValue(
        Object.assign(new Error('dup'), { code: 'P2002' }),
      );
      await expect(
        service.addMember(actor, 'proj-1', { userId: 'user-2' }, ctx),
      ).rejects.toMatchObject({ code: 'ALREADY_MEMBER' });
    });

    it('adds and audits on the happy path', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2' });
      const result = await service.addMember(actor, 'proj-1', { userId: 'user-2' }, ctx);
      expect(result).toEqual({ projectId: 'proj-1', userId: 'user-2' });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'project.member_added' }),
        }),
      );
    });
  });

  describe('removeMember (O2)', () => {
    it('404s when not a member', async () => {
      prisma.projectMember.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.removeMember(actor, 'proj-1', 'user-2', ctx)).rejects.toMatchObject({
        code: 'NOT_A_MEMBER',
      });
    });

    it('removes and audits on the happy path', async () => {
      await service.removeMember(actor, 'proj-1', 'user-2', ctx);
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'project.member_removed' }),
        }),
      );
    });
  });

  describe('getProject / getOrgUser (cross-module lookups)', () => {
    it('404s on projects outside the actor org', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.getProject(actor, 'proj-9')).rejects.toMatchObject({
        code: 'PROJECT_NOT_FOUND',
      });
    });

    it('404s on users outside the actor org', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.getOrgUser(actor, 'user-9')).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
      });
    });
  });
});
