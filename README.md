# OpsPilot AI

> AI-powered platform for incident management, deployment tracking, monitoring and engineering operations.

Engineering teams juggle Jira, Grafana, Kibana, GitHub Actions, Slack and PagerDuty during an outage. OpsPilot puts incidents, deployments and system health on **one timeline** — so on-call engineers answer "what broke, what changed, who's on it" in one place.

## Monorepo layout

```
opspilot-ai/
├── apps/
│   ├── api/            # NestJS modular monolith (REST /api/v1, Swagger at /api/docs)
│   │   └── prisma/     # Schema, migrations, seeds
│   └── web/            # Next.js 15 (App Router, Tailwind v4, TanStack Query)
├── packages/
│   └── types/          # Shared Zod schemas — one source of validation truth
├── docs/               # PRD, architecture (HLD), database design
├── infrastructure/     # Grafana dashboards, Terraform (Phase 2)
├── docker-compose.yml  # Postgres 16 · Redis 7 · RabbitMQ 3.13
└── .github/workflows/  # CI: lint → test → build (deploy lands in Phase 2)
```

## Quick start

```bash
# 1. Infrastructure (Postgres, Redis, RabbitMQ)
docker compose up -d

# 2. Install
npm install

# 3. Environment
cp .env.example .env

# 4. Database
npm run prisma:migrate -w apps/api

# 5. Run (two terminals, or npm run dev)
npm run dev:api    # http://localhost:4000/api/docs
npm run dev:web    # http://localhost:3000
```

## Tech stack — and why

| Layer | Choice | Why (short version — full ADRs in docs/02-ARCHITECTURE.md) |
|---|---|---|
| Frontend | Next.js 15 | SSR for data-heavy pages, server components, current ecosystem |
| API | NestJS modular monolith | Module boundaries without the distributed-systems tax; extractable later |
| Data | PostgreSQL + Prisma | Deeply relational domain, transactions, typed queries, versioned migrations |
| Cache | Redis (cache-aside) | Dashboard aggregates; graceful degradation if Redis is down |
| Queue | RabbitMQ + outbox pattern | Async notifications/audit without dual-write data loss |
| Observability | Prometheus + Grafana + pino | Latency histograms, error rates, structured JSON logs |
| Delivery | Docker · GitHub Actions · AWS | Reproducible envs, gated deploys, automatic rollback (Phase 2) |

## Documentation

- [Product Requirements (PRD)](docs/01-PRD.md)
- [Architecture / HLD + ADRs](docs/02-ARCHITECTURE.md)
- [Database design + Prisma schema rationale](docs/03-DATABASE-DESIGN.md)

## Roadmap

- [x] Docs: PRD, HLD, database design
- [x] Monorepo scaffold, Docker Compose, CI skeleton
- [ ] Auth module — JWT + rotating refresh tokens, RBAC
- [ ] Incidents module — status machine, timeline, comments
- [ ] Deployments module — API-key ingestion from CI
- [ ] Dashboard — Redis-cached aggregates
- [ ] RabbitMQ workers — notifications, audit, metrics simulator
- [ ] AWS deploy — EC2 + Compose, ECR, health-gated pipeline with rollback
- [ ] Monitoring — Prometheus metrics, Grafana dashboard, alerts
- [ ] Performance case studies — 1M-row indexing, cache before/after
- [ ] Phase 3 — AI root-cause assistant

## License

MIT
