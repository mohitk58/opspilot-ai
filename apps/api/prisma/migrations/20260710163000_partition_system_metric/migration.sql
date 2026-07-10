-- Convert SystemMetric to a native Postgres partitioned table, RANGE
-- (recordedAt), monthly partitions. Postgres can't ALTER a plain table into
-- a partitioned one in place, so this is the standard table-swap:
-- rename old -> create new partitioned parent -> copy data -> drop old.
-- See docs/perf/system-metric-partitioning.md for the measured before/after.

-- Renaming a table does NOT rename its constraints/indexes (they're unique
-- per-schema, not per-table) — must free up the names explicitly or the new
-- table's identically-named PK collides with the old one.
ALTER TABLE "SystemMetric" RENAME TO "SystemMetric_old";
ALTER TABLE "SystemMetric_old" RENAME CONSTRAINT "SystemMetric_pkey" TO "SystemMetric_old_pkey";
ALTER TABLE "SystemMetric_old" DROP CONSTRAINT "SystemMetric_projectId_fkey";
ALTER INDEX "SystemMetric_projectId_service_metric_recordedAt_idx" RENAME TO "SystemMetric_old_projectId_service_metric_recordedAt_idx";

-- Postgres requires the partition key in every unique/primary key, hence
-- the composite PK (id, recordedAt) — id alone is never selected/returned
-- by the app, so this has no application-code impact.
CREATE TABLE "SystemMetric" (
  "id" BIGINT NOT NULL DEFAULT nextval('"SystemMetric_id_seq"'::regclass),
  "projectId" UUID NOT NULL,
  "service" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SystemMetric_pkey" PRIMARY KEY ("id", "recordedAt")
) PARTITION BY RANGE ("recordedAt");

ALTER SEQUENCE "SystemMetric_id_seq" OWNED BY "SystemMetric"."id";

ALTER TABLE "SystemMetric" ADD CONSTRAINT "SystemMetric_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

-- Created once on the partitioned parent; Postgres auto-creates and
-- maintains a matching index on every current AND future partition.
CREATE INDEX "SystemMetric_projectId_service_metric_recordedAt_idx"
  ON "SystemMetric" ("projectId", "service", "metric", "recordedAt");

-- Monthly partitions covering Jan 2025 - Dec 2027 (seeded backfill + ~1.5y
-- runway). DEFAULT partition catches anything outside this pre-created
-- range until a real partition-maintenance job (pg_partman or a cron)
-- exists — explicitly out of scope for this case study.
DO $$
DECLARE
  d date := '2025-01-01';
BEGIN
  WHILE d < '2028-01-01' LOOP
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF "SystemMetric" FOR VALUES FROM (%L) TO (%L)',
      'SystemMetric_y' || to_char(d, 'YYYY') || 'm' || to_char(d, 'MM'),
      d,
      d + interval '1 month'
    );
    d := d + interval '1 month';
  END LOOP;
END $$;

CREATE TABLE "SystemMetric_default" PARTITION OF "SystemMetric" DEFAULT;

-- Carry existing rows across; Postgres routes each into its correct
-- monthly partition automatically based on recordedAt.
INSERT INTO "SystemMetric" ("id", "projectId", "service", "metric", "value", "recordedAt")
  SELECT "id", "projectId", "service", "metric", "value", "recordedAt" FROM "SystemMetric_old";

DROP TABLE "SystemMetric_old";
