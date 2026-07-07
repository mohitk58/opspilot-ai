---
name: perf-case-study
description: Use when doing any performance work — adding indexes, adding Redis caching, load testing, or optimizing queries. Ensures every optimization produces measured before/after evidence saved to docs/perf/.
---

# Performance case studies in OpsPilot

The portfolio rule: every performance claim must be MEASURED, not invented.
Never write "reduced latency from 8s to 150ms" without the receipts.

## Procedure

1. BASELINE FIRST. Before optimizing, capture the slow state:
   - SQL: `EXPLAIN (ANALYZE, BUFFERS)` output of the real query
   - API: latency via autocannon (e.g. `npx autocannon -d 10 -c 20 <url>`)
     recording p50/p95/p99
2. Apply ONE change (one index, one cache layer) — never bundle changes,
   or the attribution is meaningless.
3. Re-measure identically.
4. Write the case study to `docs/perf/<slug>.md` using the template below.
5. Update README roadmap if this completes a case-study item.

## Template (docs/perf/<slug>.md)

```markdown
# <Title, e.g. Incident list: composite index>
Date · Environment (local Docker, seeded rows count)

## Problem        — symptom + measured baseline
## Root cause     — EXPLAIN output / profile excerpt
## Change         — migration/code diff summary, and why this fix
## Result         — before/after table (p50/p95/p99 or query ms)
## Trade-offs     — write amplification, memory, staleness, etc.
```

## Seeding for the flagship study

Use `prisma/seed-load.ts` to generate ~1M incidents + 5M timeline events
(create it if missing; batch inserts with createMany, 10k rows per batch).
Run the incident-list query with the composite index dropped, capture the
Seq Scan plan, then re-add via migration and capture the Index Scan plan.
Commit BOTH plans in the case study.
