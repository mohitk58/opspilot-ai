import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MONTHS_OF_HISTORY = 12;
const ROWS_PER_MONTH = 250_000;
const TOTAL_ROWS = MONTHS_OF_HISTORY * ROWS_PER_MONTH; // 3,000,000

/**
 * SystemMetric partitioning case study (docs/03 §3–4): backfills 12 months
 * of history (~3M rows) into a dedicated "MTRX" project, uniformly spread
 * across the full year so a recent, narrow range query only touches a
 * small fraction of the table — exactly the shape partition pruning helps.
 * Uses Postgres generate_series bulk INSERT..SELECT (see seed-load.ts for
 * why: row-by-row Prisma calls would take an order of magnitude longer).
 *
 * Run once, measure before/after the partitioning migration, then delete —
 * see docs/perf/system-metric-partitioning.md.
 */
async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the load-test seed in production');
  }

  const org = await prisma.organization.findUniqueOrThrow({ where: { slug: 'default' } });

  const project = await prisma.project.upsert({
    where: { organizationId_key: { organizationId: org.id, key: 'MTRX' } },
    create: {
      organizationId: org.id,
      name: 'Metrics Load Test',
      key: 'MTRX',
      description: 'Perf case-study data — see docs/perf/system-metric-partitioning.md',
    },
    update: {},
  });

  console.log(`Seeding ${TOTAL_ROWS.toLocaleString()} metrics over ${MONTHS_OF_HISTORY} months into ${project.key} (${project.id})`);
  const startedAt = Date.now();

  await prisma.$executeRaw`
    INSERT INTO "SystemMetric" ("projectId", service, metric, value, "recordedAt")
    SELECT
      ${project.id}::uuid,
      (ARRAY['api','worker'])[1 + (n % 2)],
      (ARRAY['latency_p95_ms','error_rate'])[1 + (n % 2)],
      CASE WHEN n % 2 = 0 THEN 100 + random() * 500 ELSE random() * 5 END,
      -- uniform across the full year ending now, so a recent window is a
      -- small, roughly-even slice of the total (realistic for pruning)
      now() - (random() * (${MONTHS_OF_HISTORY} * 30)) * interval '1 day'
    FROM generate_series(1, ${TOTAL_ROWS}) AS n`;

  console.log(`  done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  const [count, range] = await Promise.all([
    prisma.systemMetric.count({ where: { projectId: project.id } }),
    prisma.$queryRaw<[{ min: Date; max: Date }]>`
      SELECT min("recordedAt"), max("recordedAt") FROM "SystemMetric" WHERE "projectId" = ${project.id}::uuid`,
  ]);
  console.log(`Final count: ${count.toLocaleString()}, range: ${range[0].min.toISOString()} .. ${range[0].max.toISOString()}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
