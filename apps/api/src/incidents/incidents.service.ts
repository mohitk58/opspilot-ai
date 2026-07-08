import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  INCIDENT_TRANSITIONS,
  type AddCommentDto,
  type ChangeIncidentStatusDto,
  type CreateIncidentDto,
  type IncidentDto,
  type IncidentStatus,
  type ListIncidentsQuery,
  type ListQuery,
  type Paginated,
  type TimelineEventDto,
  type UpdateIncidentDto,
} from '@opspilot/types';
import type { RequestContext } from '../auth/auth.service';
import type { AccessTokenPayload } from '../auth/token.service';
import { AppException } from '../common/app.exception';
import { DeploymentsService } from '../deployments/deployments.service';
import { OrgsService } from '../orgs/orgs.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const USER_SUMMARY = { select: { id: true, fullName: true, email: true } } as const;

const INCIDENT_INCLUDE = {
  createdBy: USER_SUMMARY,
  assignee: USER_SUMMARY,
  project: { select: { key: true } },
  deployment: { select: { id: true, version: true, environment: true } },
} as const;

type IncidentRow = Prisma.IncidentGetPayload<{ include: typeof INCIDENT_INCLUDE }>;

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrgsService,
    private readonly deployments: DeploymentsService,
    private readonly redis: RedisService,
  ) {}

  /** I1 — create with a race-safe per-project number (docs/03 §3). */
  async create(
    actor: AccessTokenPayload,
    dto: CreateIncidentDto,
    ctx: RequestContext,
  ): Promise<IncidentDto> {
    const project = await this.orgs.getProject(actor, dto.projectId);
    const assignee = dto.assigneeId ? await this.orgs.getOrgUser(actor, dto.assigneeId) : null;
    // D4 — "caused by deployment": must exist in the same project (404 otherwise)
    const deployment = dto.deploymentId
      ? await this.deployments.getForProject(actor, dto.deploymentId, dto.projectId)
      : null;

    const incident = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: the row lock taken by UPDATE serializes concurrent
      // creates on the same project; @@unique([projectId, number]) backstops.
      const [{ number }] = await tx.$queryRaw<[{ number: number }]>`
        UPDATE "Project"
        SET "nextIncidentNumber" = "nextIncidentNumber" + 1
        WHERE "id" = ${project.id}::uuid
        RETURNING "nextIncidentNumber" - 1 AS "number"`;

      const created = await tx.incident.create({
        data: {
          projectId: project.id,
          number,
          title: dto.title,
          description: dto.description,
          severity: dto.severity,
          createdById: actor.sub,
          assigneeId: assignee?.id,
          deploymentId: dto.deploymentId,
        },
        include: INCIDENT_INCLUDE,
      });

      await tx.incidentTimelineEvent.create({
        data: {
          incidentId: created.id,
          actorId: actor.sub,
          type: 'CREATED',
          payload: { severity: created.severity, title: created.title },
        },
      });
      if (assignee) {
        await tx.incidentTimelineEvent.create({
          data: {
            incidentId: created.id,
            actorId: actor.sub,
            type: 'ASSIGNED',
            payload: { assigneeId: assignee.id, assigneeName: assignee.fullName },
          },
        });
      }
      if (deployment) {
        await tx.incidentTimelineEvent.create({
          data: {
            incidentId: created.id,
            actorId: actor.sub,
            type: 'LINKED_DEPLOYMENT',
            payload: {
              deploymentId: deployment.id,
              version: deployment.version,
              environment: deployment.environment,
            },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          action: 'incident.created',
          entityType: 'Incident',
          entityId: created.id,
          after: { title: created.title, severity: created.severity, number },
          ip: ctx.ip,
        },
      });
      await tx.outboxEvent.create({
        data: {
          routingKey: 'incident.created',
          payload: {
            incidentId: created.id,
            projectId: project.id,
            displayNumber: `${project.key}-${number}`,
            severity: created.severity,
            assigneeId: assignee?.id ?? null,
            actorId: actor.sub,
          },
        },
      });
      return created;
    });

    await this.invalidateDashboard(project.id);
    return this.toDto(incident);
  }

  /** I4 — filter/search. Maps to @@index([projectId, status, createdAt desc]). */
  async list(
    actor: AccessTokenPayload,
    query: ListIncidentsQuery,
  ): Promise<Paginated<IncidentDto>> {
    const where: Prisma.IncidentWhereInput = {
      deletedAt: null,
      project: { organizationId: actor.orgId },
      ...(query.projectId && { projectId: query.projectId }),
      ...(query.status && { status: query.status }),
      ...(query.severity && { severity: query.severity }),
      ...(query.assigneeId && { assigneeId: query.assigneeId }),
      ...(query.q && { title: { contains: query.q, mode: 'insensitive' as const } }),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.incident.count({ where }),
      this.prisma.incident.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: INCIDENT_INCLUDE,
      }),
    ]);
    return {
      data: rows.map((r) => this.toDto(r)),
      meta: { total, page: query.page, pageSize: query.pageSize },
    };
  }

  async get(actor: AccessTokenPayload, id: string): Promise<IncidentDto> {
    return this.toDto(await this.findIncident(actor, id));
  }

  /**
   * I1/I6 — edit fields / (re)assign. Severity and assignment changes get
   * timeline events; title/description edits are recorded in the AuditLog
   * before/after only (PRD timeline criteria cover status, comments and
   * assignment — free-text edits would drown the feed).
   */
  async update(
    actor: AccessTokenPayload,
    id: string,
    dto: UpdateIncidentDto,
    ctx: RequestContext,
  ): Promise<IncidentDto> {
    const incident = await this.findIncident(actor, id);
    const assigneeTouched = dto.assigneeId !== undefined;
    const newAssignee =
      assigneeTouched && dto.assigneeId !== null
        ? await this.orgs.getOrgUser(actor, dto.assigneeId as string)
        : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.incident.update({
        where: { id: incident.id },
        data: {
          title: dto.title,
          description: dto.description,
          severity: dto.severity,
          ...(assigneeTouched && { assigneeId: newAssignee?.id ?? null }),
        },
        include: INCIDENT_INCLUDE,
      });

      if (dto.severity && dto.severity !== incident.severity) {
        await tx.incidentTimelineEvent.create({
          data: {
            incidentId: incident.id,
            actorId: actor.sub,
            type: 'SEVERITY_CHANGED',
            payload: { from: incident.severity, to: dto.severity },
          },
        });
      }
      if (assigneeTouched && (newAssignee?.id ?? null) !== incident.assigneeId) {
        await tx.incidentTimelineEvent.create({
          data: {
            incidentId: incident.id,
            actorId: actor.sub,
            type: 'ASSIGNED',
            payload: {
              assigneeId: newAssignee?.id ?? null,
              assigneeName: newAssignee?.fullName ?? null,
            },
          },
        });
        if (newAssignee) {
          await tx.outboxEvent.create({
            data: {
              routingKey: 'incident.assigned',
              payload: {
                incidentId: incident.id,
                projectId: incident.projectId,
                assigneeId: newAssignee.id,
                actorId: actor.sub,
              },
            },
          });
        }
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          action: 'incident.updated',
          entityType: 'Incident',
          entityId: incident.id,
          before: {
            title: incident.title,
            severity: incident.severity,
            assigneeId: incident.assigneeId,
          },
          after: { title: row.title, severity: row.severity, assigneeId: row.assigneeId },
          ip: ctx.ip,
        },
      });
      return row;
    });

    await this.invalidateDashboard(incident.projectId);
    return this.toDto(updated);
  }

  /** I2 — status machine; invalid transitions are 422 (architecture rule 3). */
  async changeStatus(
    actor: AccessTokenPayload,
    id: string,
    dto: ChangeIncidentStatusDto,
    ctx: RequestContext,
  ): Promise<IncidentDto> {
    const incident = await this.findIncident(actor, id);
    const from = incident.status as IncidentStatus;
    if (!INCIDENT_TRANSITIONS[from].includes(dto.status)) {
      throw new AppException(
        422,
        'INVALID_STATUS_TRANSITION',
        `Cannot transition from ${from} to ${dto.status}`,
        { allowed: INCIDENT_TRANSITIONS[from] },
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.incident.update({
        where: { id: incident.id },
        data: {
          status: dto.status,
          // MTTR (I5) is computed from createdAt → resolvedAt downstream
          ...(dto.status === 'RESOLVED' && { resolvedAt: new Date() }),
        },
        include: INCIDENT_INCLUDE,
      });
      await tx.incidentTimelineEvent.create({
        data: {
          incidentId: incident.id,
          actorId: actor.sub,
          type: 'STATUS_CHANGED',
          payload: { from, to: dto.status, ...(dto.comment && { comment: dto.comment }) },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          action: 'incident.status_changed',
          entityType: 'Incident',
          entityId: incident.id,
          before: { status: from },
          after: { status: dto.status },
          ip: ctx.ip,
        },
      });
      await tx.outboxEvent.create({
        data: {
          routingKey: 'incident.status_changed',
          payload: {
            incidentId: incident.id,
            projectId: incident.projectId,
            from,
            to: dto.status,
            actorId: actor.sub,
          },
        },
      });
      return row;
    });

    await this.invalidateDashboard(incident.projectId);
    return this.toDto(updated);
  }

  /** I3 — comments are COMMENT timeline events (docs/03 §3), no extra table. */
  async addComment(
    actor: AccessTokenPayload,
    id: string,
    dto: AddCommentDto,
    ctx: RequestContext,
  ): Promise<TimelineEventDto> {
    const incident = await this.findIncident(actor, id);

    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.incidentTimelineEvent.create({
        data: {
          incidentId: incident.id,
          actorId: actor.sub,
          type: 'COMMENT',
          payload: { body: dto.body },
        },
        include: { actor: { select: { id: true, fullName: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          action: 'incident.commented',
          entityType: 'Incident',
          entityId: incident.id,
          after: { eventId: created.id },
          ip: ctx.ip,
        },
      });
      await tx.outboxEvent.create({
        data: {
          routingKey: 'incident.commented',
          payload: { incidentId: incident.id, eventId: created.id, actorId: actor.sub },
        },
      });
      return created;
    });

    return {
      id: event.id,
      type: event.type,
      payload: event.payload,
      createdAt: event.createdAt.toISOString(),
      actor: event.actor,
    };
  }

  /** I2/I3 — reads via @@index([incidentId, createdAt]), oldest first. */
  async timeline(
    actor: AccessTokenPayload,
    id: string,
    query: ListQuery,
  ): Promise<Paginated<TimelineEventDto>> {
    const incident = await this.findIncident(actor, id);
    const where = { incidentId: incident.id };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.incidentTimelineEvent.count({ where }),
      this.prisma.incidentTimelineEvent.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { id: true, fullName: true } } },
      }),
    ]);
    return {
      data: rows.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload,
        createdAt: e.createdAt.toISOString(),
        actor: e.actor,
      })),
      meta: { total, page: query.page, pageSize: query.pageSize },
    };
  }

  /** Org-scoped lookup; cross-org ids 404 (no existence leak). */
  private async findIncident(actor: AccessTokenPayload, id: string): Promise<IncidentRow> {
    const incident = await this.prisma.incident.findFirst({
      where: { id, deletedAt: null, project: { organizationId: actor.orgId } },
      include: INCIDENT_INCLUDE,
    });
    if (!incident) throw new AppException(404, 'INCIDENT_NOT_FOUND', 'No such incident');
    return incident;
  }

  /** Rule 7: delete-on-write for the (future) dashboard aggregate cache. */
  private invalidateDashboard(projectId: string): Promise<unknown> {
    return this.redis.del(`dash:summary:${projectId}`);
  }

  private toDto(row: IncidentRow): IncidentDto {
    return {
      id: row.id,
      projectId: row.projectId,
      number: row.number,
      displayNumber: `${row.project.key}-${row.number}`,
      title: row.title,
      description: row.description,
      severity: row.severity,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdBy: row.createdBy,
      assignee: row.assignee,
      deployment: row.deployment,
    };
  }
}
