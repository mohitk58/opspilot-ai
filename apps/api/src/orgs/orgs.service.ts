import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AddProjectMemberDto, CreateProjectDto, ListQuery, Paginated } from '@opspilot/types';
import { AppException } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload } from '../auth/token.service';
import type { RequestContext } from '../auth/auth.service';

/**
 * Minimal Epic 5 surface (O1/O2): projects and memberships. Per the docs/02
 * module table the orgs module publishes no domain events; mutations still
 * write AuditLog rows.
 */
@Injectable()
export class OrgsService {
  constructor(private readonly prisma: PrismaService) {}

  /** O1 — projects live in the actor's organization. */
  async createProject(actor: AccessTokenPayload, dto: CreateProjectDto, ctx: RequestContext) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const project = await tx.project.create({
          data: {
            organizationId: actor.orgId,
            name: dto.name,
            key: dto.key,
            description: dto.description,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            action: 'project.created',
            entityType: 'Project',
            entityId: project.id,
            after: { name: project.name, key: project.key },
            ip: ctx.ip,
          },
        });
        return project;
      });
    } catch (err) {
      if ((err as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
        throw new AppException(409, 'PROJECT_KEY_TAKEN', `Project key "${dto.key}" already exists in this organization`);
      }
      throw err;
    }
  }

  async listProjects(actor: AccessTokenPayload, query: ListQuery): Promise<Paginated<unknown>> {
    const where = { organizationId: actor.orgId, deletedAt: null };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { members: { select: { userId: true } } },
      }),
    ]);
    return { data, meta: { total, page: query.page, pageSize: query.pageSize } };
  }

  /** O2 — membership controls incident visibility, so changes are audited. */
  async addMember(
    actor: AccessTokenPayload,
    projectId: string,
    dto: AddProjectMemberDto,
    ctx: RequestContext,
  ) {
    const project = await this.findProject(actor, projectId);
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, organizationId: actor.orgId, deletedAt: null },
    });
    if (!user) throw new AppException(404, 'USER_NOT_FOUND', 'No such user in this organization');

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.projectMember.create({ data: { projectId: project.id, userId: user.id } });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            action: 'project.member_added',
            entityType: 'Project',
            entityId: project.id,
            after: { userId: user.id },
            ip: ctx.ip,
          },
        });
      });
    } catch (err) {
      if ((err as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
        throw new AppException(409, 'ALREADY_MEMBER', 'User is already a member of this project');
      }
      throw err;
    }
    return { projectId: project.id, userId: user.id };
  }

  async removeMember(
    actor: AccessTokenPayload,
    projectId: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const project = await this.findProject(actor, projectId);
    const { count } = await this.prisma.projectMember.deleteMany({
      where: { projectId: project.id, userId },
    });
    if (count === 0) {
      throw new AppException(404, 'NOT_A_MEMBER', 'User is not a member of this project');
    }
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.sub,
        action: 'project.member_removed',
        entityType: 'Project',
        entityId: project.id,
        after: { userId },
        ip: ctx.ip,
      },
    });
  }

  /**
   * Org-scoped project lookup for other modules (incidents attaches to
   * projects through this, not through its own Prisma query — rule 1).
   * Cross-org ids 404 rather than 403: no existence leak.
   */
  async getProject(actor: AccessTokenPayload, projectId: string) {
    return this.findProject(actor, projectId);
  }

  /** Org-scoped user lookup (e.g. incident assignee validation). */
  async getOrgUser(actor: AccessTokenPayload, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: actor.orgId, deletedAt: null },
      select: { id: true, fullName: true, email: true },
    });
    if (!user) throw new AppException(404, 'USER_NOT_FOUND', 'No such user in this organization');
    return user;
  }

  private async findProject(actor: AccessTokenPayload, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId: actor.orgId, deletedAt: null },
    });
    if (!project) throw new AppException(404, 'PROJECT_NOT_FOUND', 'No such project');
    return project;
  }
}
