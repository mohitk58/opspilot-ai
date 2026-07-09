import { Injectable } from '@nestjs/common';
import type { ListNotificationsQuery, NotificationDto, Paginated } from '@opspilot/types';
import type { RequestContext } from '../auth/auth.service';
import type { AccessTokenPayload } from '../auth/token.service';
import { AppException } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Read/ack side of N1. Rows are created only by the queue consumer — this
 * module never writes new notifications inline (that is the whole point of
 * the async pipeline). Per the docs/02 module table it publishes no events;
 * read-state changes are audited but not outboxed.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    actor: AccessTokenPayload,
    query: ListNotificationsQuery,
  ): Promise<Paginated<NotificationDto> & { unreadCount: number }> {
    const where = {
      userId: actor.sub, // strictly owner-scoped
      ...(query.unread === 'true' && { readAt: null }),
    };
    const [total, unreadCount, rows] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: actor.sub, readAt: null } }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' }, // @@index([userId, readAt, createdAt desc])
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      meta: { total, page: query.page, pageSize: query.pageSize },
      unreadCount,
    };
  }

  async markRead(actor: AccessTokenPayload, id: string, ctx: RequestContext): Promise<void> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId: actor.sub, readAt: null },
      data: { readAt: new Date() },
    });
    if (count === 0) {
      throw new AppException(404, 'NOTIFICATION_NOT_FOUND', 'No such unread notification');
    }
    await this.audit(actor, 'notification.read', id, ctx);
  }

  async markAllRead(actor: AccessTokenPayload, ctx: RequestContext): Promise<{ marked: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId: actor.sub, readAt: null },
      data: { readAt: new Date() },
    });
    if (count > 0) await this.audit(actor, 'notification.read_all', actor.sub, ctx);
    return { marked: count };
  }

  private audit(actor: AccessTokenPayload, action: string, entityId: string, ctx: RequestContext) {
    return this.prisma.auditLog.create({
      data: { actorId: actor.sub, action, entityType: 'Notification', entityId, ip: ctx.ip },
    });
  }
}
