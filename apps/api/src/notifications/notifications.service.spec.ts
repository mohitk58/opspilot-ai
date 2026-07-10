import type { AccessTokenPayload } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const NOW = new Date('2026-07-09T08:00:00Z');

const actor: AccessTokenPayload = {
  sub: 'user-1',
  orgId: 'org-1',
  email: 'evan@example.com',
  role: 'ENGINEER',
};
const ctx = { ip: '127.0.0.1' };

const row = {
  id: 'ntf-1',
  userId: 'user-1',
  type: 'INCIDENT_ASSIGNED',
  title: 'You were assigned PAY-42',
  body: 'Checkout latency spike',
  link: '/incidents/inc-1',
  readAt: null,
  sourceEventId: 'evt-1:user-1',
  createdAt: NOW,
};

function buildPrismaMock() {
  const prisma = {
    notification: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([row]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
  );
  return prisma;
}

describe('NotificationsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildPrismaMock();
    service = new NotificationsService(prisma as unknown as PrismaService);
  });

  it('lists strictly owner-scoped with unreadCount', async () => {
    const result = await service.list(actor, { page: 1, pageSize: 25 });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(result.unreadCount).toBe(1);
    expect(result.data[0]).toMatchObject({ id: 'ntf-1', readAt: null });
  });

  it("unread='true' filters to readAt null", async () => {
    await service.list(actor, { unread: 'true', page: 1, pageSize: 25 });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', readAt: null } }),
    );
  });

  it('markRead only touches own unread rows; 404 otherwise', async () => {
    await service.markRead(actor, 'ntf-1', ctx);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'ntf-1', userId: 'user-1', readAt: null },
      data: { readAt: expect.any(Date) },
    });
    expect(prisma.auditLog.create).toHaveBeenCalled();

    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.markRead(actor, 'ntf-other', ctx)).rejects.toMatchObject({
      code: 'NOTIFICATION_NOT_FOUND',
    });
  });

  it('markAllRead reports the count and skips the audit row when nothing changed', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });
    expect(await service.markAllRead(actor, ctx)).toEqual({ marked: 3 });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);

    prisma.auditLog.create.mockClear();
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.markAllRead(actor, ctx)).toEqual({ marked: 0 });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
