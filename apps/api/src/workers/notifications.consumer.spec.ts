import { PrismaService } from '../prisma/prisma.service';
import { NotificationsConsumer } from './notifications.consumer';
import { RabbitService } from './rabbit.service';

const incident = {
  id: 'inc-1',
  title: 'Checkout latency spike',
  number: 42,
  createdById: 'user-creator',
  assigneeId: 'user-assignee',
  project: { key: 'PAY' },
};

function buildPrismaMock() {
  return {
    incident: { findUnique: jest.fn().mockResolvedValue(incident) },
    projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
}

describe('NotificationsConsumer', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let consumer: NotificationsConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildPrismaMock();
    consumer = new NotificationsConsumer(
      prisma as unknown as PrismaService,
      {} as unknown as RabbitService,
    );
  });

  it('incident.assigned notifies the assignee with a deduping sourceEventId', async () => {
    await consumer.handle({
      eventId: 'evt-1',
      routingKey: 'incident.assigned',
      payload: { incidentId: 'inc-1', assigneeId: 'user-assignee', actorId: 'user-actor' },
    });

    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: 'user-assignee',
          type: 'INCIDENT_ASSIGNED',
          title: 'You were assigned PAY-42',
          link: '/incidents/inc-1',
          sourceEventId: 'evt-1:user-assignee',
        }),
      ],
      skipDuplicates: true, // replay of the same eventId is a no-op
    });
  });

  it('self-assignment produces no notification', async () => {
    await consumer.handle({
      eventId: 'evt-2',
      routingKey: 'incident.assigned',
      payload: { incidentId: 'inc-1', assigneeId: 'user-1', actorId: 'user-1' },
    });
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('status change notifies creator and assignee, excluding the actor', async () => {
    await consumer.handle({
      eventId: 'evt-3',
      routingKey: 'incident.status_changed',
      payload: { incidentId: 'inc-1', from: 'OPEN', to: 'INVESTIGATING', actorId: 'user-creator' },
    });

    const rows = prisma.notification.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1); // creator was the actor → only the assignee
    expect(rows[0]).toMatchObject({
      userId: 'user-assignee',
      type: 'INCIDENT_STATUS',
      title: 'PAY-42 moved to INVESTIGATING',
    });
  });

  it('deployment.failed notifies every project member', async () => {
    prisma.projectMember.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);

    await consumer.handle({
      eventId: 'evt-4',
      routingKey: 'deployment.failed',
      payload: {
        projectId: 'proj-1',
        version: 'v2.14.0',
        environment: 'PRODUCTION',
        status: 'ROLLED_BACK',
        triggeredBy: 'api-key:ci',
      },
    });

    const rows = prisma.notification.createMany.mock.calls[0][0].data;
    expect(rows.map((r: { userId: string }) => r.userId)).toEqual(['u1', 'u2']);
    expect(rows[0]).toMatchObject({
      type: 'DEPLOYMENT_FAILED',
      title: 'Deployment v2.14.0 rolled back in PRODUCTION',
    });
  });

  it('unknown routing keys are ignored without writing', async () => {
    await consumer.handle({ eventId: 'evt-5', routingKey: 'user.registered', payload: {} });
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('missing incident (deleted since) is a clean no-op, not an error', async () => {
    prisma.incident.findUnique.mockResolvedValue(null);
    await consumer.handle({
      eventId: 'evt-6',
      routingKey: 'incident.assigned',
      payload: { incidentId: 'inc-gone', assigneeId: 'user-2' },
    });
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });
});
