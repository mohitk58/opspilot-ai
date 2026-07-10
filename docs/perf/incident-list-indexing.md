# Incident list: composite index `(projectId, status, createdAt)`

2026-07-09 · local Docker (Postgres 16), Apple Silicon dev machine ·
dataset: **1,000,000 incidents / 5,000,000 timeline events / 2,000,000
metrics** seeded via `apps/api/prisma/seed-load.ts` into a dedicated `LOAD`
project — see that file's header for the seeding approach (Postgres
`generate_series` bulk `INSERT..SELECT`, not row-by-row Prisma calls; 1M
incidents in 18.1s, 5M events in 103.1s, 2M metrics in 17.4s).

## Problem

`IncidentsService.list()` (docs/03 §4's "incident list query") filters by
project and status, ordered by `createdAt DESC`, page size 25 — the exact
shape `GET /api/v1/incidents?projectId=&status=` issues on every page load.
The schema ships `@@index([projectId, status, createdAt(sort: Desc)])`
specifically for this query. To prove it's earning its place rather than
assert it, the index was dropped and the query re-measured:

```sql
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM "Incident"
WHERE "projectId" = '<load-project>' AND "deletedAt" IS NULL AND status = 'OPEN'
ORDER BY "createdAt" DESC LIMIT 25;
```

| | Latency | Buffers |
|---|---|---|
| Index dropped | **426.5 ms** | 637 hit + 23,918 read + 8,477 written |

426 ms already breaches the incident-list NFR (p95 < 400 ms, docs/01 §5) on
a single request with no concurrency.

## Root cause

With the target index gone, the planner didn't fall back to a full
sequential scan — it opportunistically reused the sibling
`Incident_status_severity_idx` (present for a different query pattern) to
narrow `status = 'OPEN'` down to 200,001 rows, then filtered `projectId`
and `deletedAt` by hand, then **sorted all 200,001 matches** to take the
top 25:

```
Limit (actual time=425.785..426.437 rows=25)
  -> Gather Merge
     -> Sort (Sort Key: "createdAt" DESC)                    ← sorts 200k rows
        -> Parallel Bitmap Heap Scan on "Incident"
              Recheck Cond: (status = 'OPEN')
              Filter: ("deletedAt" IS NULL) AND ("projectId" = ...)
              Heap Blocks: exact=8229                         ← 8,229 heap pages fetched
              -> Bitmap Index Scan on "Incident_status_severity_idx"
                    Index Cond: (status = 'OPEN')
```

The honest lesson: a "wrong" index isn't always a Seq Scan — it can be a
plausible-looking Bitmap Heap Scan that still touches tens of thousands of
buffer pages and sorts six figures of rows for a 25-row page.

## Change

Restored the identical index from the original migration
(`20260707163553_init`) — no schema change, since it already existed in the
committed schema; this only proves what dropping it costs:

```sql
CREATE INDEX "Incident_projectId_status_createdAt_idx"
  ON "Incident"("projectId", "status", "createdAt" DESC);
```

## Result

Identical query, same dataset, index restored:

```
Limit (actual time=0.033..0.068 rows=25)
  -> Index Scan using "Incident_projectId_status_createdAt_idx" on "Incident"
        Index Cond: ("projectId" = ... AND status = 'OPEN')
        Filter: ("deletedAt" IS NULL)
Execution Time: 0.085 ms
```

| | Latency | Buffers | vs. no index |
|---|---|---|---|
| Index dropped | 426.5 ms | 32,395 pages (~253 MB) | — |
| **Composite index** | **0.085 ms** | **6 pages** (~48 KB) | **~5,000× faster, ~5,400× fewer buffers** |

`projectId + status` narrows straight to the exact rows via the index's
leading columns; `createdAt DESC` means "top 25" is just "read the first 25
index entries" — no sort node at all in the plan.

## Trade-offs

- **Write cost**: every incident insert/update maintains four indexes
  (`pkey`, this composite, `assigneeId,status`, `status,severity`). The
  1M-row seed took 18.1s including all four — acceptable for a table whose
  read:write ratio is read-heavy (every dashboard/list view vs. one write
  per incident action).
- **Index size**: ~253 MB of heap/index pages touched in the no-index case
  vs. 48 KB indexed — the flip side is the composite index itself occupies
  disk space proportional to row count; at 1M rows this is still a small
  fraction of the table.
- **Column order matters**: this index only helps queries that filter
  `projectId` (and optionally `status`) with `createdAt` ordering. A query
  filtering by `status` alone across all projects would still prefer
  `Incident_status_severity_idx` — column order is a deliberate match to
  the actual query shape, not a general-purpose index.
- Dataset was seeded and **measured in isolation**, then deleted immediately
  after (see `apps/api/prisma/seed-load.ts` docstring) — this repo's dev
  database does not carry 1M+ rows day-to-day.
