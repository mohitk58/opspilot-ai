import { PrismaService } from '../prisma/prisma.service';
import { OutboxRelayService } from './outbox-relay.service';
import { RabbitService } from './rabbit.service';

const NOW = new Date('2026-07-09T08:00:00Z');

const events = [
  { id: 'evt-1', routingKey: 'incident.assigned', payload: { incidentId: 'inc-1' }, createdAt: NOW, publishedAt: null, attempts: 0 },
  { id: 'evt-2', routingKey: 'incident.status_changed', payload: { incidentId: 'inc-1' }, createdAt: NOW, publishedAt: null, attempts: 0 },
];

function buildPrismaMock() {
  return {
    outboxEvent: {
      findMany: jest.fn().mockResolvedValue(events),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

function buildRabbitMock() {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

describe('OutboxRelayService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let rabbit: ReturnType<typeof buildRabbitMock>;
  let relay: OutboxRelayService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildPrismaMock();
    rabbit = buildRabbitMock();
    relay = new OutboxRelayService(
      prisma as unknown as PrismaService,
      rabbit as unknown as RabbitService,
    );
  });

  it('publishes pending events oldest-first and stamps publishedAt', async () => {
    const published = await relay.drainOnce();

    expect(published).toBe(2);
    expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { publishedAt: null }, orderBy: { createdAt: 'asc' } }),
    );
    expect(rabbit.publish).toHaveBeenNthCalledWith(
      1,
      'incident.assigned',
      expect.objectContaining({ eventId: 'evt-1', payload: { incidentId: 'inc-1' } }),
    );
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'evt-1' }, data: { publishedAt: expect.any(Date) } }),
    );
  });

  it('on broker failure: increments attempts, stops the batch, never stamps', async () => {
    rabbit.publish.mockRejectedValue(new Error('ECONNREFUSED'));

    const published = await relay.drainOnce();

    expect(published).toBe(0);
    expect(rabbit.publish).toHaveBeenCalledTimes(1); // stopped after the first failure
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'evt-1' }, data: { attempts: { increment: 1 } } }),
    );
  });

  it('partial failure keeps earlier successes stamped', async () => {
    rabbit.publish
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('channel closed'));

    const published = await relay.drainOnce();

    expect(published).toBe(1);
    const updates = prisma.outboxEvent.update.mock.calls.map((c) => c[0]);
    expect(updates).toEqual([
      expect.objectContaining({ where: { id: 'evt-1' }, data: { publishedAt: expect.any(Date) } }),
      expect.objectContaining({ where: { id: 'evt-2' }, data: { attempts: { increment: 1 } } }),
    ]);
  });

  it('overlapping ticks are skipped', async () => {
    let release!: () => void;
    prisma.outboxEvent.findMany.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve([]))),
    );
    const first = relay.drainOnce();
    const second = await relay.drainOnce(); // while the first is in flight
    expect(second).toBe(0);
    release();
    await first;
  });
});
