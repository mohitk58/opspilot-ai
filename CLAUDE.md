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
npm test -w apps/api -- incidents.service.spec.ts   # run a single test file (Jest pattern match)
```

Env: copy `.env.example` → `.env`. Never commit `.env`.

### Scaffold gaps (update this list as they're filled)

Root scripts use `--workspaces --if-present`; some tooling is referenced by scripts but **not yet created**. Add these when first needed instead of assuming they exist:

- ESLint config in `apps/web` (lint script exists but has no config)

Filled: Jest config (`apps/api/jest.config.js`), ESLint flat config (`apps/api/eslint.config.mjs`), and the initial Prisma migration exist as of the auth module. `apps/api/prisma/seed.ts` seeds demo logins per role (admin/engineer/viewer `@opspilot.dev`, password from `SEED_PASSWORD`, dev fallback `Password123!`); it runs via ts-node and stays outside the tsconfig `include`/`rootDir`, which cover only `src/`.

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

Every module ships API + UI together (standing instruction): TanStack Query hooks over `authApi` in `apps/web/hooks/`, pages under the guarded `(app)` layout.

Next, in order:
1. **Dashboard module** — Epic 4, Redis-cached aggregates + cache invalidation. UI: dashboard charts (Recharts), replacing the interim client-side counts.
2. **Workers** — outbox relay, RabbitMQ consumers (notifications, audit), metrics simulator cron.
6. **Ops** — Prometheus metrics, Grafana dashboard JSON, Dockerfiles, deploy pipeline with health gate + rollback.
7. **Performance case studies** — seed 1M incidents, capture EXPLAIN ANALYZE before/after indexes; dashboard latency before/after Redis. Write results to `docs/perf/`.

## The portfolio narrative (why it matters)

Every performance claim in this project must be **measured, not invented**. When you complete a perf-sensitive feature, produce the before/after evidence (EXPLAIN output, k6/autocannon numbers) and save it under `docs/perf/`. These become interview case studies.
