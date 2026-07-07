# Product Requirements Document (PRD)

**Product:** OpsPilot AI — Enterprise Engineering Operations Platform
**Version:** 1.0 (MVP)
**Status:** Approved for development
**Author:** MK (Product/Engineering)
**Last updated:** 2026-07-07

---

## 1. Overview

### 1.1 Problem statement

Engineering teams manage incidents, deployments, and system health across many disconnected tools: Jira for tickets, Grafana for metrics, Kibana for logs, GitHub Actions for deployments, Slack and PagerDuty for alerting. During a production incident, an on-call engineer typically switches between 4–6 tools to answer one question: *what changed, what broke, and who needs to act?*

This context switching increases Mean Time To Resolution (MTTR), causes missed handoffs, and leaves incident history scattered and unsearchable.

### 1.2 Product vision

OpsPilot AI is a single operations hub where engineering teams can:

1. Track and resolve production incidents with a full timeline.
2. See deployment history and correlate deployments with incidents.
3. Monitor key service health signals on one dashboard.
4. Use AI-assisted diagnostics to suggest likely root causes.

### 1.3 Target users

| Persona | Role | Primary need |
|---|---|---|
| On-call Engineer | Resolves incidents | Fast triage: what broke, when, what changed |
| Engineering Manager | Oversees team health | MTTR trends, incident volume, deployment success rate |
| SRE / DevOps | Owns infrastructure | Deployment tracking, service health, alert routing |
| Viewer (stakeholder) | Read-only | Status visibility without edit access |

---

## 2. Goals and non-goals

### 2.1 Goals (MVP)

- G1: An engineer can create, assign, update, and resolve an incident in under 60 seconds of UI interaction.
- G2: Every incident has an immutable timeline (status changes, comments, assignments).
- G3: Deployments are recorded per project/environment with status and duration.
- G4: A dashboard summarizes open incidents, recent deployments, and key metrics.
- G5: Access is controlled by roles (Admin, Engineer, Viewer).
- G6: The system is deployed on AWS via an automated CI/CD pipeline.

### 2.2 Non-goals (explicitly out of MVP scope)

- Multi-tenant billing / subscription management.
- Real Slack/PagerDuty integrations (simulated via queue workers in MVP).
- Real agent-based metric collection (MVP seeds/simulates metrics; Prometheus scrapes the app itself).
- Mobile applications.
- SSO (Google/Azure AD) — Phase 2.
- OpenSearch log search — Phase 2.
- AI root-cause analysis — Phase 2 (the data model supports it from day one).

---

## 3. User stories

### Epic 1 — Authentication & access

| ID | Story | Priority | Acceptance criteria |
|---|---|---|---|
| A1 | As a user, I can sign up with email + password | Must | Password ≥ 8 chars, hashed with bcrypt; duplicate email rejected with clear error |
| A2 | As a user, I can log in and stay logged in | Must | JWT access token (15 min) + refresh token (7 days, rotated); silent refresh; no forced logout during active use |
| A3 | As a user, I can log out | Must | Refresh token revoked server-side |
| A4 | As an Admin, I can assign roles to users | Must | Roles: ADMIN, ENGINEER, VIEWER; changes take effect on next token refresh |
| A5 | As a Viewer, I cannot modify any resource | Must | All write endpoints return 403 for VIEWER |

### Epic 2 — Incident management

| ID | Story | Priority | Acceptance criteria |
|---|---|---|---|
| I1 | As an engineer, I can create an incident with title, description, severity, project, assignee | Must | Severity: SEV1–SEV4; incident number auto-generated (e.g. INC-042) |
| I2 | As an engineer, I can change incident status | Must | OPEN → INVESTIGATING → IDENTIFIED → MONITORING → RESOLVED; every change appears on the timeline with actor + timestamp |
| I3 | As an engineer, I can comment on an incident | Must | Comments appear on the timeline in order |
| I4 | As a user, I can filter/search incidents | Must | Filter by status, severity, project, assignee; text search on title |
| I5 | As a manager, I can see MTTR per project | Should | Computed from createdAt → resolvedAt |
| I6 | As an engineer, I get notified when assigned | Should | Notification created asynchronously via queue |

### Epic 3 — Deployment tracking

| ID | Story | Priority | Acceptance criteria |
|---|---|---|---|
| D1 | As an SRE, I can record a deployment (version, env, status, duration) | Must | Environments: DEV, STAGING, PRODUCTION; statuses: PENDING, IN_PROGRESS, SUCCESS, FAILED, ROLLED_BACK |
| D2 | As an SRE, deployments can be created via API key (CI integration) | Should | `POST /api/v1/deployments` with `X-API-Key` header |
| D3 | As a user, I can see deployment history per project | Must | Sorted by date, filter by env/status |
| D4 | As an engineer, I can link an incident to a deployment | Should | "Caused by deployment" reference on incident |

### Epic 4 — Dashboard & metrics

| ID | Story | Priority | Acceptance criteria |
|---|---|---|---|
| M1 | As a user, I see open incident count by severity | Must | Live counts; cached (≤ 60 s stale) |
| M2 | As a user, I see deployment success rate (last 30 days) | Must | Success / total, per project |
| M3 | As a user, I see API latency & error-rate charts | Should | From SystemMetrics table (seeded/simulated) |
| M4 | As a user, I see a recent activity feed | Should | Latest timeline events across projects |

### Epic 5 — Organizations, projects, teams

| ID | Story | Priority | Acceptance criteria |
|---|---|---|---|
| O1 | As an Admin, I can create projects inside my organization | Must | Single organization per install in MVP (schema supports many) |
| O2 | As an Admin, I can add/remove users to a project | Must | Membership controls incident visibility |

### Epic 6 — Notifications & audit

| ID | Story | Priority | Acceptance criteria |
|---|---|---|---|
| N1 | Assignment/status changes produce in-app notifications | Should | Delivered via RabbitMQ worker, not inline in the request |
| N2 | All write actions are recorded in an audit log | Must | Actor, action, entity, before/after snapshot, timestamp |

---

## 4. Functional requirements summary

- FR-1: RESTful API, versioned under `/api/v1`, documented with OpenAPI (Swagger).
- FR-2: All list endpoints support pagination (`page`, `pageSize`, max 100) and return total counts.
- FR-3: Dashboard aggregate endpoints are cached in Redis (TTL 60 s) with cache invalidation on relevant writes.
- FR-4: Side effects (notifications, audit fan-out, simulated Slack/email) run asynchronously via RabbitMQ.
- FR-5: Every request is traceable via a request ID propagated to logs.

## 5. Non-functional requirements

| Category | Requirement | Target |
|---|---|---|
| Performance | Dashboard API p95 latency | < 300 ms (cached), < 1.5 s (cold) |
| Performance | Incident list p95 (10k+ rows) | < 400 ms |
| Availability | Uptime (single-region MVP) | 99.5% |
| Security | OWASP top-10 mitigations | Helmet, rate limiting, CORS, input validation (Zod/class-validator), secrets in AWS Secrets Manager |
| Security | Password storage | bcrypt, cost ≥ 10 |
| Scalability | Stateless API | Horizontally scalable behind Nginx/ALB |
| Observability | Metrics + logs | Prometheus /metrics endpoint, structured JSON logs, Grafana dashboard |
| Testing | Coverage | ≥ 80% unit on services; E2E for auth + incident lifecycle |
| Recovery | DB backups | RDS automated daily snapshots, 7-day retention |

## 6. Success metrics (for the portfolio narrative)

- Dashboard latency reduced from ~4 s (uncached baseline) to < 200 ms with Redis.
- Incident list query on 1M seeded rows: > 5 s unindexed → < 150 ms with proper indexes.
- Zero-downtime deployment demonstrated (blue-green or rolling on ECS/EC2).
- Full CI pipeline: lint → test → build → dockerize → deploy → smoke test, < 10 min.

## 7. Release plan

| Phase | Scope | Duration (est.) |
|---|---|---|
| Phase 1 (MVP) | Auth, RBAC, incidents, deployments, dashboard, Docker Compose local | ~3 weeks |
| Phase 2 | Redis, RabbitMQ workers, audit logs, notifications, AWS deploy + CI/CD, monitoring | ~2–3 weeks |
| Phase 3 | AI root-cause assistant, OpenSearch, SSO, advanced reports | ~2–4 weeks |

## 8. Open questions

1. ECS vs. plain EC2 + Docker Compose for first deployment? (Recommendation: EC2 first for cost/simplicity, ECS as a stretch goal.)
2. Simulated metrics generator: seed script vs. background cron? (Recommendation: cron worker that writes SystemMetrics every 30 s — looks alive in demos.)
3. AI provider for Phase 3: Anthropic/OpenAI API vs. local model.

## 9. Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Product Owner | | | |
| Tech Lead | | | |
| QA Lead | | | |
