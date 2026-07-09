import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TOTAL_INCIDENTS = 1_000_000;
const EVENTS_PER_INCIDENT = 5; // 1M x 5 = 5,000,000 timeline events (docs/03 §4)
const TOTAL_METRICS = 2_000_000;
const WINDOW_DAYS = 90;

/**
 * Flagship perf case study (docs/03 §4): seeds 1M incidents, 5M timeline
 * events, 2M metrics into a dedicated "LOAD" project. Uses Postgres
 * generate_series bulk INSERT..SELECT rather than row-by-row Prisma calls —
 * round-tripping 8M rows through Node would take an order of magnitude
 * longer for no benefit (no application logic runs during seeding).
 *
 * Timeline event payloads are a generic {seed:true} marker, not real
 * per-type shapes — fine for EXPLAIN ANALYZE on the incident list, but the
 * UI's TIMELINE_PAYLOADS.parse() would reject them, so don't browse the
 * LOAD project's incident detail pages.
 *
 * Intended to run once, be measured against, then be deleted — see
 * docs/perf/incident-list-indexing.md.
 */
async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the load-test seed in production');
  }

  const org = await prisma.organization.findUniqueOrThrow({ where: { slug: 'default' } });
  const admin = await prisma.user.findFirstOrThrow({
    where: { organizationId: org.id, role: 'ADMIN' },
  });

  const project = await prisma.project.upsert({
    where: { organizationId_key: { organizationId: org.id, key: 'LOAD' } },
    create: {
      organizationId: org.id,
      name: 'Load Test',
      key: 'LOAD',
      description: 'Perf case-study data — see docs/perf/incident-list-indexing.md',
      nextIncidentNumber: TOTAL_INCIDENTS + 1,
    },
    update: { nextIncidentNumber: TOTAL_INCIDENTS + 1 },
  });

  const timed = async (label: string, fn: () => Promise<unknown>) => {
    const startedAt = Date.now();
    await fn();
    console.log(`  ${label}: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  };

  console.log(`Seeding into project ${project.key} (${project.id})`);

  await timed(`${TOTAL_INCIDENTS.toLocaleString()} incidents`, () =>
    prisma.$executeRaw`
      INSERT INTO "Incident"
        (id, "projectId", number, title, description, severity, status,
         "createdById", "createdAt", "updatedAt", "resolvedAt")
      SELECT
        gen_random_uuid(),
        ${project.id}::uuid,
        n,
        'Load incident ' || n,
        'Synthetic row for the incident-list indexing case study.',
        (ARRAY['SEV1','SEV2','SEV3','SEV4']::"IncidentSeverity"[])[1 + (n % 4)],
        (ARRAY['OPEN','INVESTIGATING','IDENTIFIED','MONITORING','RESOLVED']::"IncidentStatus"[])[1 + (n % 5)],
        ${admin.id}::uuid,
        t.created_at,
        t.created_at,
        CASE
          WHEN (ARRAY['OPEN','INVESTIGATING','IDENTIFIED','MONITORING','RESOLVED']::"IncidentStatus"[])[1 + (n % 5)] = 'RESOLVED'
          THEN t.created_at + interval '1 hour'
        END
      FROM generate_series(1, ${TOTAL_INCIDENTS}) AS n
      CROSS JOIN LATERAL (
        SELECT now() - (random() * ${WINDOW_DAYS}) * interval '1 day' AS created_at
      ) t`,
  );

  await timed(`${(TOTAL_INCIDENTS * EVENTS_PER_INCIDENT).toLocaleString()} timeline events`, () =>
    prisma.$executeRaw`
      INSERT INTO "IncidentTimelineEvent" (id, "incidentId", "actorId", type, payload, "createdAt")
      SELECT
        gen_random_uuid(),
        i.id,
        ${admin.id}::uuid,
        (ARRAY['CREATED','STATUS_CHANGED','COMMENT','ASSIGNED','SEVERITY_CHANGED']::"TimelineEventType"[])[e],
        '{"seed": true}'::jsonb,
        i."createdAt"
      FROM "Incident" i
      CROSS JOIN generate_series(1, ${EVENTS_PER_INCIDENT}) AS e
      WHERE i."projectId" = ${project.id}::uuid`,
  );

  await timed(`${TOTAL_METRICS.toLocaleString()} system metrics`, () =>
    prisma.$executeRaw`
      INSERT INTO "SystemMetric" ("projectId", service, metric, value, "recordedAt")
      SELECT
        ${project.id}::uuid,
        (ARRAY['api','worker'])[1 + (n % 2)],
        (ARRAY['latency_p95_ms','error_rate'])[1 + (n % 2)],
        -- index 1 (n even) = latency_p95_ms, index 2 (n odd) = error_rate
        CASE WHEN n % 2 = 0 THEN 100 + random() * 500 ELSE random() * 5 END,
        now() - (random() * ${WINDOW_DAYS}) * interval '1 day'
      FROM generate_series(1, ${TOTAL_METRICS}) AS n`,
  );

  const [incidents, events, metrics] = await Promise.all([
    prisma.incident.count({ where: { projectId: project.id } }),
    prisma.incidentTimelineEvent.count({ where: { incident: { projectId: project.id } } }),
    prisma.systemMetric.count({ where: { projectId: project.id } }),
  ]);
  console.log(
    `\nFinal counts — incidents: ${incidents.toLocaleString()}, events: ${events.toLocaleString()}, metrics: ${metrics.toLocaleString()}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
