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
docker compose up -d                 # Postgres 16, Redis 7, RabbitMQ 3.13 (mgmt UI :15672), Prometheus :9090, Grafana :3001 (opspilot/opspilot)
npm install                          # workspace install from repo root
npm run dev:api                      # NestJS on :4000
npm run dev:web                      # Next.js on :3000
npm run dev:workers                  # outbox relay + queue consumers + metrics simulator
npm run prisma:migrate -w apps/api   # create/apply dev migrations
npm run lint / npm test / npm run build
npm test -w apps/api -- incidents.service.spec.ts   # run a single test file (Jest pattern match)
```

Env: copy `.env.example` → `apps/api/.env` (single env home — the API and every Prisma CLI command run with that cwd; a second copy at the repo root makes Prisma abort with an env-conflict error). Never commit `.env`.

### Scaffold gaps (update this list as they're filled)

Root scripts use `--workspaces --if-present`; some tooling is referenced by scripts but **not yet created**. Add these when first needed instead of assuming they exist:

- ESLint config in `apps/web` (lint script exists but has no config)

Filled: Jest config (`apps/api/jest.config.js`), ESLint flat config (`apps/api/eslint.config.mjs`), and the initial Prisma migration exist as of the auth module. `apps/api/prisma/seed.ts` seeds demo logins per role (admin/engineer/viewer `@opspilot.dev`, password from `SEED_PASSWORD`, dev fallback `Password123!`). `apps/api/prisma/seed-load.ts` (`npm run prisma:seed-load -w apps/api`) seeds the 1M/5M/2M-row perf dataset into a `LOAD` project — delete it after measuring, it isn't meant to linger. Both run via ts-node and intentionally stay outside the tsconfig `include`/`rootDir`, which cover only `src/` (their IDE-only "Cannot find name 'process'" squiggle is that, not a real error).

Note: `@opspilot/types` is consumed as raw TS source (`main: src/index.ts`, no build step) — consumers compile it themselves, so keep it free of runtime deps other than `zod`.

## Architecture rules (do not violate without discussing)

1. **Modular monolith, not microservices.** New backend features are NestJS modules with clear boundaries (see module table in docs/02). Modules communicate through services or domain events — never reach into another module's repository/Prisma calls.
2. **All DTO validation via Zod schemas in `packages/types`.** Frontend and backend import the same schema. Do not duplicate validation logic or use class-validator.
3. **Incident status transitions** must use `INCIDENT_TRANSITIONS` from `@opspilot/types`. Invalid transitions return 422.
4. **Every mutation** writes an `IncidentTimelineEvent` (for incidents) and an `AuditLog` row, and publishes a domain event **via the OutboxEvent table in the same transaction** — never publish to RabbitMQ directly inside a request handler. Documented exemption: routine refresh-token rotation is not audited (one row per silent 15-min refresh is noise); login, logout, and replay-detection events are.
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
- [x] Prisma schema (13 models, 7 enums), health endpoint, web shell (landing/login/dashboard)

- [x] Auth module — signup/login/refresh/logout (Epic 1, A1–A5): RBAC guard, refresh rotation with replay detection, unit tests, Swagger annotations. Also introduced the shared Zod pipe, RFC 7807 filter, and degradation-safe Redis service.
- [x] Web auth flow — login/signup pages (react-hook-form + shared Zod DTOs), access token in memory only with single-flight silent refresh and 401 retry (`apps/web/lib/api.ts`), guarded `(app)` layout that bootstraps the session from the refresh cookie, logout. TanStack Query provider wired in the root layout.
- [x] Orgs module (minimal Epic 5 surface) — `POST/GET /projects`, member add/remove (ADMIN-only writes), org-scoped lookups exported for other modules. Plus `GET /users` directory on the auth module for pickers.
- [x] Incidents module (Epic 2, I1–I6) — CRUD + status machine (422 via `INCIDENT_TRANSITIONS`), race-safe per-project numbers (atomic `UPDATE..RETURNING` on `Project.nextIncidentNumber`, verified with 20 parallel creates), comments as COMMENT timeline events, four-step transaction (write + timeline + audit + outbox) on every mutation, `dash:summary:{projectId}` invalidation. UI: incidents list with filters/search/pagination, create form, detail with legal-transitions-only status dropdown (optimistic + rollback), assignee picker, timeline feed, comments; projects page with ADMIN create form.

- [x] Deployments module (Epic 3, D1–D4) — dual-auth ingestion (JWT or hashed `X-API-Key`), `Idempotency-Key` replay via Redis SET NX (24 h, degrades gracefully), status lifecycle with `deployment.recorded`/`deployment.failed` outbox events, ADMIN API-key management (plaintext shown once), incident↔deployment linking with `LINKED_DEPLOYMENT` timeline events. UI: deployments page (filters + record form), per-project API-key panel, "caused by deployment" on incident create/detail.

- [x] Dashboard module (Epic 4, M1/M2/M4) — cache-aside summary (`dash:summary:*`, 60 s) and activity (`dash:activity:*`, 30 s) with write-invalidation and cross-org 404 before cache; UI: severity tiles, Recharts trend charts (palette validated for CVD/contrast on the dark surface), activity feed. **Measured:** p50 1214 ms → 1 ms at 20 conns over 200k incidents — `docs/perf/dashboard-redis-caching.md`. M3 (SystemMetric charts) deferred to the metrics module + simulator cron. Note: the dev DB keeps the 200k-row `LOAD` project used for the measurement.

Every module ships API + UI together (standing instruction): TanStack Query hooks over `authApi` in `apps/web/hooks/`, pages under the guarded `(app)` layout.

- [x] Workers + notifications & metrics (N1, I6, M3) — second entrypoint (`npm run dev:workers`): outbox relay (1 s poll → `opspilot.events`, stamps `publishedAt`), idempotent notifications consumer (`sourceEventId` unique; TTL-backoff retry ×3 → DLQ, verified live with a poison message), metrics simulator (15 s random walk). Read APIs: `/notifications` (+read/read-all) and `/metrics/system` (org-wide reads average across projects per tick). UI: header bell with unread badge, M3 latency/error charts. Deliberate deviation: **no `q.audit` consumer** — audit rows are written transactionally with each mutation (rule 4); the queue is asserted so the documented topology exists.

- [x] Ops — `prom-client` instrumentation (`/metrics`: HTTP histogram by route pattern, error counter, cache hit/miss by key prefix, outbox gauge; RabbitMQ depths via its prometheus plugin), Grafana fully provisioned from `infrastructure/` (dashboard + the 3 documented alerts — DLQ alert verified firing), Dockerfiles (API image serves api/workers/migrate roles; web standalone; **node:24-slim** — raw-TS types package needs Node 24 type stripping, bcrypt needs glibc), `docker-compose.prod.yml`, CI (typecheck, docker build, gitleaks) + `deploy.yml` → GHCR (ECR later) + `infrastructure/deploy/deploy.sh` with health gate and automatic rollback (drilled locally). Broker-restart resilience added to RabbitService (reconnect + consumer re-attach, verified live). Deferred: pino structured logging.

- [x] Performance case studies — flagship study done: `apps/api/prisma/seed-load.ts` seeds 1M incidents/5M timeline events/2M metrics (Postgres `generate_series` bulk insert, not row-by-row — 1M incidents in 18s); dropped and restored `Incident_projectId_status_createdAt_idx`, measured **426.5 ms → 0.085 ms (~5,000×)** on the real incident-list query shape. Evidence + trade-offs in `docs/perf/incident-list-indexing.md`. Seeded rows deleted immediately after measuring — the dev DB does not carry 1M+ rows day-to-day. Metric-range-query partitioning study explicitly deferred to Phase 3 per docs/03 §4.

## MVP roadmap: complete

Every phased item in the original scaffold is checked off (auth → orgs →
incidents → deployments → dashboard → workers/notifications/metrics → ops →
the flagship perf study). Remaining work is Phase 2+ per docs/02 §4 and
deferred items called out above:

- [x] pino structured JSON logging — `nestjs-pino`, wired via `app.useLogger(app.get(Logger))` in both `main.ts` and `workers.main.ts` (`bufferLogs: true` first), so every existing `new Logger(X.name)` call across the codebase emits structured JSON with zero per-file changes. `requestId`/`userId`/route/`responseTime` on every access-log line (FR-5: an incoming `x-request-id` header is echoed, not replaced — verified live); `authorization`/`cookie`/`set-cookie` redacted; `/metrics` and `/health` excluded from access logs (verified zero log lines across repeated polls); `pino-pretty` in dev, plain JSON in prod (CloudWatch-ready); level from `LOG_LEVEL` env, else `info` in prod / `debug` elsewhere.

- [x] `SystemMetric` monthly partitioning (docs/03 §3–4) — converted to native `PARTITION BY RANGE (recordedAt)` via a table-swap migration (`20260710163000_partition_system_metric`), composite `(id, recordedAt)` PK (Postgres requires the partition key in the PK; `id` is never selected anywhere so zero app impact), monthly partitions Jan 2025–Dec 2027 + a `DEFAULT` catch-all. **Kept permanently** (unlike the index study, this isn't reverted). Measured on 3M seeded rows/12 months: **353.5 ms → 20.5 ms** (~17×, ~34× fewer buffers) on a last-7-days range query — the planner's `Subplans Removed: 36` shows it pruned every partition but the one matching month. `MetricsSimulatorService`/`MetricsService` needed zero code changes (Prisma is partition-agnostic). Evidence + trade-offs (no automated partition-creation job — flagged, not built) in `docs/perf/system-metric-partitioning.md`. `apps/api/prisma/seed-metrics-load.ts` is the reusable seed script; seeded rows deleted after measuring.

- ECS Fargate + Terraform (stretch goal, currently single-EC2/Docker Compose)
- ECR instead of GHCR (swap is two lines in `deploy.yml`)
- OpenTelemetry tracing (docs/02 §5, explicitly a stretch goal)
- Real metrics ingestion (Prometheus scrape of live services) to replace the
  simulator once there is real traffic to observe
- Automated partition maintenance (`pg_partman` or a cron) for `SystemMetric`
  — partitions are currently pre-created through Dec 2027 with a `DEFAULT`
  safety net, not auto-rolled monthly

## The portfolio narrative (why it matters)

Every performance claim in this project must be **measured, not invented**. When you complete a perf-sensitive feature, produce the before/after evidence (EXPLAIN output, k6/autocannon numbers) and save it under `docs/perf/`. These become interview case studies.
