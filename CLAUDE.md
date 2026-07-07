# CLAUDE.md — OpsPilot AI

## What this project is

OpsPilot AI is an enterprise engineering-operations platform: incident management, deployment tracking, dashboards, and (later) AI-assisted root-cause analysis. It is a **portfolio project built to production standards** — the goal is demonstrating senior-level engineering across frontend, backend, data, DevOps, and documentation. Quality and defensible decisions matter more than speed.

**Read these before making design decisions — they are the source of truth:**

- `docs/01-PRD.md` — requirements, user stories with acceptance criteria, NFR targets, phased scope
- `docs/02-ARCHITECTURE.md` — HLD, module boundaries, caching/queue strategy, ADRs
- `docs/03-DATABASE-DESIGN.md` — ER model, index rationale, outbox pattern, migration policy

## Repo layout

```
apps/api        NestJS modular monolith — REST /api/v1, Swagger at /api/docs
apps/api/prisma Prisma schema, migrations, seeds
apps/web        Next.js 15 App Router, Tailwind v4, TanStack Query, Zustand
packages/types  Shared Zod schemas (DTOs, enums, incident status transitions)
docs/           PRD, architecture, DB design (+ future runbook, perf reports)
infrastructure/ Grafana dashboards, Terraform (Phase 2)
```

## Commands

```bash
docker compose up -d                 # Postgres 16, Redis 7, RabbitMQ 3.13 (mgmt UI :15672)
npm install                          # workspace install from repo root
npm run dev:api                      # NestJS on :4000
npm run dev:web                      # Next.js on :3000
npm run prisma:migrate -w apps/api   # create/apply dev migrations
npm run lint / npm test / npm run build
```

Env: copy `.env.example` → `.env`. Never commit `.env`.

## Architecture rules (do not violate without discussing)

1. **Modular monolith, not microservices.** New backend features are NestJS modules with clear boundaries (see module table in docs/02). Modules communicate through services or domain events — never reach into another module's repository/Prisma calls.
2. **All DTO validation via Zod schemas in `packages/types`.** Frontend and backend import the same schema. Do not duplicate validation logic or use class-validator.
3. **Incident status transitions** must use `INCIDENT_TRANSITIONS` from `@opspilot/types`. Invalid transitions return 422.
4. **Every mutation** writes an `IncidentTimelineEvent` (for incidents) and an `AuditLog` row, and publishes a domain event **via the OutboxEvent table in the same transaction** — never publish to RabbitMQ directly inside a request handler.
5. **Timeline and audit tables are append-only.** No updates, no deletes.
6. **Database changes only via `prisma migrate dev`** (never `db push`). Breaking changes use expand-and-contract (docs/03 §5). Every index must map to a named query — add a comment saying which.
7. **Caching:** cache-aside in Redis with explicit key deletion on writes (key patterns in docs/02 §2.4). Redis failure must degrade gracefully to DB reads (100 ms timeout), never take the request down.
8. **Errors:** RFC 7807 `application/problem+json` with stable `code` values, via the global exception filter.
9. **Pagination** on every list endpoint: `page`/`pageSize` (max 100), response `{ data, meta: { total, page, pageSize } }`.
10. **Auth:** access JWT 15 min in memory; refresh token 7 d, httpOnly cookie, rotated on every use, hashed at rest, replay detection via rotation chain. RBAC via `@Roles()` decorator + guard.
11. **Secrets** only from env. No credentials, tokens, or keys in code or fixtures.

## Code style

- TypeScript strict mode everywhere; no `any` unless justified with a comment.
- API: feature-module folders (`src/incidents/{incidents.module,controller,service}.ts` + `dto/`).
- Web: server components by default; `'use client'` only where interactivity requires it. TanStack Query for client data; Zustand only for session/theme.
- Tests colocated as `*.spec.ts` (unit) — target ≥80% on services; E2E under `apps/api/test/`.
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `perf:`.
- Branches: `feature/<name>` off `develop` (create `develop` from `main` if it doesn't exist).

## Current status & roadmap

Done:
- [x] Docs (PRD, HLD/ADRs, DB design), monorepo scaffold, Docker Compose, CI skeleton
- [x] Prisma schema (16 models), health endpoint, web shell (landing/login/dashboard)

Next, in order:
1. **Auth module** — signup/login/refresh/logout per docs/01 Epic 1 (stories A1–A5). Includes RBAC guard, refresh rotation, unit tests, Swagger annotations.
2. **Incidents module** — Epic 2 (I1–I6): CRUD, status machine, per-project incident numbers (`PAY-42`, race-safe — see docs/03 §3), timeline, comments.
3. **Deployments module** — Epic 3, including hashed API-key auth for CI ingestion.
4. **Dashboard module** — Epic 4, Redis-cached aggregates + cache invalidation.
5. **Workers** — outbox relay, RabbitMQ consumers (notifications, audit), metrics simulator cron.
6. **Frontend features** — auth flow, incident list/detail with optimistic status updates, dashboard charts (Recharts).
7. **Ops** — Prometheus metrics, Grafana dashboard JSON, Dockerfiles, deploy pipeline with health gate + rollback.
8. **Performance case studies** — seed 1M incidents, capture EXPLAIN ANALYZE before/after indexes; dashboard latency before/after Redis. Write results to `docs/perf/`.

## The portfolio narrative (why it matters)

Every performance claim in this project must be **measured, not invented**. When you complete a perf-sensitive feature, produce the before/after evidence (EXPLAIN output, k6/autocannon numbers) and save it under `docs/perf/`. These become interview case studies.
