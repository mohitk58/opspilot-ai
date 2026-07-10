# SystemMetric: monthly range partitioning

2026-07-10 · local Docker (Postgres 16), Apple Silicon dev machine · dataset:
**~3,003,160 rows spanning 12 months** (2025-07-15 → 2026-07-10), seeded via
`apps/api/prisma/seed-metrics-load.ts` into a dedicated `MTRX` project
(`generate_series` bulk insert, 3,000,000 rows in 60.5s).

Unlike the incident-list index study, this is not a temporary drop/restore —
docs/03 §3 names `SystemMetric` a candidate for monthly partitioning "at
scale," so this measures the case for it and **keeps the partitioned schema
permanently** (migration `20260710163000_partition_system_metric`).

## Problem

`MetricsService.system()` (M3) queries a project's metric history for a
window, ordered by `recordedAt`, capped at 5,000 rows — the exact shape
tested here: the most recent 7 days out of a 12-month table.

```sql
SELECT service, metric, value, "recordedAt" FROM "SystemMetric"
WHERE "projectId" = '<mtrx-project>'
  AND "recordedAt" >= now() - interval '7 days' AND "recordedAt" <= now()
ORDER BY "recordedAt" ASC LIMIT 5000;
```

| | Latency | Buffers |
|---|---|---|
| Flat table (no partitioning) | **353.5 ms** | 34,194 pages (~267 MB) |

## Root cause

The existing composite index `(projectId, service, metric, recordedAt)`
doesn't help here — `service`/`metric` are unfiltered, and every single row in
the table shares one `projectId` (a single high-volume project is exactly
the scale scenario), so the leading index column has zero selectivity. The
planner correctly falls back to a Parallel Seq Scan across **all 3M rows**,
throwing away 981,540 of them per worker to keep ~5,000:

```
Parallel Seq Scan on "SystemMetric" (rows=19380 loops=3)
  Filter: ("projectId" = ... AND "recordedAt" BETWEEN ...)
  Rows Removed by Filter: 981540
Execution Time: 353.465 ms
```

This is the honest point of the study: **no index fixes this.** A btree on
`recordedAt` would help a single-project range scan, but the moment
`projectId` stops being selective, adding more indexes doesn't change that
the whole table must be considered. Partitioning attacks it at the physical
layer instead — by never bringing the other 11 months into consideration at
all.

## Change

Converted `SystemMetric` from a flat table to `PARTITION BY RANGE
("recordedAt")`, monthly partitions (`SystemMetric_y2025m01` …
`SystemMetric_y2027m12`, one per calendar month) plus a `DEFAULT` partition
for anything outside that pre-created range. Standard Postgres table-swap
migration (can't `ALTER` a plain table into a partitioned one in place):
rename old table out of the way (freeing its constraint/index names — table
rename does *not* rename them, which is worth knowing since colliding names
were the first migration attempt's bug), create the new partitioned parent
with a composite `(id, recordedAt)` primary key (Postgres requires the
partition key in every unique/PK constraint), create the index once on the
parent — Postgres propagates it to every partition automatically, current
and future — copy all rows across (auto-routed into the correct monthly
partition by Postgres), drop the old table.

## Result

Identical query, identical data, now partitioned:

```
Parallel Append (rows=19473 loops=3)
  Subplans Removed: 36                                        ← 36 of 37 partitions pruned
  -> Parallel Seq Scan on "SystemMetric_y2026m07" "SystemMetric_1"
        Filter: ("projectId" = ... AND "recordedAt" BETWEEN ...)
        Rows Removed by Filter: 8180                            ← ~27k rows in-partition, not 3M
Execution Time: 20.517 ms
```

| | Latency | Buffers | vs. flat |
|---|---|---|---|
| Flat table | 353.5 ms | 34,194 pages | — |
| **Partitioned** | **20.5 ms** | **1,014 pages** | **~17× faster, ~34× fewer buffers** |

The planner's `Subplans Removed: 36` is the whole story: it eliminated every
partition except the single month the 7-day window could possibly fall
into, before scanning a single row. The remaining scan is still a Seq Scan
— just over ~27k rows in one partition instead of 3,000,000 across the
table, which is why this is a smaller (but still decisive) win than the
incident-list index study: partitioning shrinks the *search space*, it
doesn't turn a scan into a lookup the way an index does.

## Trade-offs

- **No automated partition creation.** Partitions were pre-created for a
  ~2.5-year window (Jan 2025–Dec 2027) plus a `DEFAULT` catch-all so inserts
  never fail. A real production setup needs `pg_partman` or a scheduled job
  to roll new monthly partitions forward — explicitly out of scope here.
- **The `DEFAULT` partition is unindexed-by-boundary** — any row landing
  there (clock skew, a bug, or simply running past Dec 2027 unmaintained)
  sits in an unpruned catch-all and degrades back toward the flat-table
  case for that data. It's a safety net, not a substitute for the real
  partition-maintenance job above.
- **Composite primary key.** `id` is no longer independently unique;
  uniqueness is `(id, recordedAt)`. Confirmed zero application impact — `id`
  is never selected or returned by `MetricsService` or anywhere else in the
  codebase.
- **Write path unaffected.** `MetricsSimulatorService.tick()`'s `createMany`
  needed no code changes — Postgres routes each insert to the right
  partition transparently, and Prisma Client has no partitioning awareness
  to update.
- **37 child tables** (36 months + default) is more catalog/planner
  overhead than one table, negligible at this count; would need
  reconsideration in the thousands (sub-partitioning or coarser granularity).
- Seeded rows and the `MTRX` project were deleted immediately after
  measuring, per this repo's policy — the partitioned **schema** is the
  permanent, kept change; the **data** is exactly as before (the ongoing
  metrics-simulator rows for real projects).
