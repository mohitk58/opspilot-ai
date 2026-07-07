---
name: nest-module
description: Use when creating or extending any backend feature module (auth, incidents, deployments, dashboard, notifications) in apps/api. Encodes this project's mandatory module anatomy, validation, eventing, and testing conventions.
---

# Building a NestJS module in OpsPilot

## Module anatomy (mandatory layout)

```
apps/api/src/<feature>/
├── <feature>.module.ts
├── <feature>.controller.ts    # HTTP only: parse, call service, shape response
├── <feature>.service.ts       # ALL business logic lives here
├── <feature>.service.spec.ts  # unit tests, Prisma mocked
└── dto/                       # thin wrappers importing Zod from @opspilot/types
```

Controllers never touch Prisma. Services never import other modules'
services directly for writes — use domain events via the outbox.

## Validation

Every request body/query validates against a Zod schema from
`packages/types`. If the schema doesn't exist, ADD IT THERE — never define
validation inline in the API. Use a ZodValidationPipe; on failure return
422 problem+json with the flattened Zod issues.

## Mutations: the four-step transaction

Every write follows this pattern inside ONE `prisma.$transaction`:
1. Business write (e.g., update incident status — validate the transition
   against INCIDENT_TRANSITIONS first)
2. Append IncidentTimelineEvent (if incident-related)
3. Append AuditLog (actor, action, entityType, entityId, before, after)
4. Insert OutboxEvent (routingKey like "incident.status_changed", payload)

NEVER publish to RabbitMQ inside a request handler — the outbox relay does that.

## Endpoints

- Version prefix comes free from bootstrap: routes live at /api/v1/...
- List endpoints: page/pageSize (cap 100) → { data, meta: { total, page, pageSize } }
- Annotate everything for Swagger (@ApiTags, @ApiOperation, @ApiBearerAuth)
- RBAC: @Roles('ADMIN','ENGINEER') + RolesGuard; VIEWER gets 403 on writes

## Tests (definition of done)

- Service unit tests covering: happy path, invalid transition/authz failure,
  and the transaction contents (timeline + audit + outbox rows created)
- Target ≥80% coverage on the service
- One controller test for the validation pipe wiring
