# Dashboard summary: Redis cache-aside

2026-07-08 · local Docker (Postgres 16, Redis 7), Apple Silicon dev machine ·
dataset: **200,024 incidents / 10,003 deployments** (seeded via `generate_series`
into a `LOAD` project; the 1M-row rerun happens with the flagship `seed-load.ts`
case study) · API in `nest start --watch` dev mode for both runs.

## Problem

`GET /api/v1/dashboard/summary` computes six aggregates per request: two
incident `groupBy`s, one deployment `groupBy`, and three `date_trunc('day')`
trend queries over 30 days of data. Uncached, a single request costs ~65–90 ms,
and under 20 concurrent connections requests queue behind the Prisma connection
pool: **p50 latency was 1.2 s at just 16 req/s** — for a page every user lands on.

Baseline (Redis unreachable, so every request takes the degraded direct-DB
path; `autocannon -d 10 -c 20`, all 200s):

| | p50 | p97.5 | p99 | avg | req/s |
|---|---|---|---|---|---|
| No cache | 1214 ms | 1458 ms | 1514 ms | 1189 ms | 15.8 |

## Root cause

The daily-trend query has no index it can use for the 30-day window at this
shape — it parallel-seq-scans all 200k incident rows on every request:

```
Finalize GroupAggregate (actual time=55.197..61.170 rows=31)
  -> Gather Merge (Workers Planned: 2)
     -> Sort (quicksort, ~3 MB)
        -> Hash Join (i."projectId" = p.id)  rows=66667/worker
           -> Parallel Seq Scan on "Incident" i   ← 200k rows, every request
              Filter: "deletedAt" IS NULL AND "createdAt" >= now() - '30 days'
Execution Time: 61.302 ms
```

~62 ms × three trend queries + three groupBys, per request, for data whose
product requirement (PRD M1) explicitly tolerates 60 s of staleness.

## Change

One layer, nothing else: cache-aside in `DashboardService` (docs/02 §2.4).
The whole computed summary is stored as JSON under `dash:summary:{projectId}`
(or `dash:summary:org:{orgId}` org-wide) with a 60 s TTL. Per-project keys are
already deleted by every incident/deployment write; the org-wide key relies on
TTL. Redis failure degrades to the direct-DB path (100 ms command timeout,
rule 7) — which is exactly the baseline row above, not an outage.

## Result

Identical `autocannon -d 10 -c 20`, warm cache (single cold request first:
92 ms; the next: 1.7 ms):

| | p50 | p97.5 | p99 | avg | req/s |
|---|---|---|---|---|---|
| No cache | 1214 ms | 1458 ms | 1514 ms | 1189 ms | 15.8 |
| Warm Redis | **1 ms** | **3 ms** | **4 ms** | 1.1 ms | **14,201** |

**~1200× lower p50, ~900× higher throughput.** Verified behaviors, same
session: cache key deleted the moment an incident is written
(`EXISTS` 1 → 0), cross-org `projectId` 404s *before* touching the cache (no
poisoning a key the owning org will read), corrupt cache entries recompute.

## Trade-offs

- **Staleness:** up to 60 s on summary (30 s on activity) — explicitly allowed
  by M1. Write-invalidation makes per-project views fresher than the ceiling.
- **The 10 s test window never crosses the TTL**, so the cached run shows pure
  hit-path costs; sustained real traffic recomputes once per key per 60 s
  (~90 ms for one request, amortized to noise).
- **Dev-mode measurements:** both runs used `nest start --watch`, so absolute
  numbers are conservative; the *ratio* is the honest signal.
- Memory cost is one JSON blob (~3.5 kB) per active project + org — negligible.
- A second dimension (per-user, per-filter) would multiply keys; the endpoint
  deliberately caches only the two documented scopes.
