import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ListNotificationsQuery } from '@opspilot/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../auth/token.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'My notifications (N1), newest first; includes unreadCount' })
  list(
    @Query(new ZodValidationPipe(ListNotificationsQuery)) query: ListNotificationsQuery,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    return this.notifications.list(actor, query);
  }

  @Patch(':id/read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark one notification read' })
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AccessTokenPayload,
    @Req() req: Request,
  ) {
    await this.notifications.markRead(actor, id, { ip: req.ip });
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all my notifications read' })
  markAllRead(@CurrentUser() actor: AccessTokenPayload, @Req() req: Request) {
    return this.notifications.markAllRead(actor, { ip: req.ip });
  }
}
