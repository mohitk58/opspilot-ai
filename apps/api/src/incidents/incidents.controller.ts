import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  AddCommentDto,
  ChangeIncidentStatusDto,
  CreateIncidentDto,
  ListIncidentsQuery,
  ListQuery,
  UpdateIncidentDto,
} from '@opspilot/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AccessTokenPayload } from '../auth/token.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  AddCommentBody,
  ChangeIncidentStatusBody,
  CreateIncidentBody,
  UpdateIncidentBody,
} from './dto/incidents.dto';
import { IncidentsService } from './incidents.service';

@ApiTags('incidents')
@ApiBearerAuth()
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Post()
  @Roles('ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Create an incident (I1) — number auto-generated, e.g. PAY-42' })
  @ApiBody({ type: CreateIncidentBody })
  create(
    @Body(new ZodValidationPipe(CreateIncidentDto)) dto: CreateIncidentDto,
    @CurrentUser() actor: AccessTokenPayload,
    @Req() req: Request,
  ) {
    return this.incidents.create(actor, dto, { ip: req.ip });
  }

  @Get()
  @ApiOperation({ summary: 'List/filter/search incidents (I4), paginated' })
  list(
    @Query(new ZodValidationPipe(ListIncidentsQuery)) query: ListIncidentsQuery,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    return this.incidents.list(actor, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Incident detail' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AccessTokenPayload) {
    return this.incidents.get(actor, id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Edit fields / (re)assign (I1, I6)' })
  @ApiBody({ type: UpdateIncidentBody })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateIncidentDto)) dto: UpdateIncidentDto,
    @CurrentUser() actor: AccessTokenPayload,
    @Req() req: Request,
  ) {
    return this.incidents.update(actor, id, dto, { ip: req.ip });
  }

  @Patch(':id/status')
  @Roles('ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Change status (I2) — invalid transitions return 422' })
  @ApiBody({ type: ChangeIncidentStatusBody })
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ChangeIncidentStatusDto)) dto: ChangeIncidentStatusDto,
    @CurrentUser() actor: AccessTokenPayload,
    @Req() req: Request,
  ) {
    return this.incidents.changeStatus(actor, id, dto, { ip: req.ip });
  }

  @Post(':id/comments')
  @Roles('ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Comment on an incident (I3)' })
  @ApiBody({ type: AddCommentBody })
  addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AddCommentDto)) dto: AddCommentDto,
    @CurrentUser() actor: AccessTokenPayload,
    @Req() req: Request,
  ) {
    return this.incidents.addComment(actor, id, dto, { ip: req.ip });
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Incident timeline (I2/I3), oldest first, paginated' })
  timeline(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(ListQuery)) query: ListQuery,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    return this.incidents.timeline(actor, id, query);
  }
}
