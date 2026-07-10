import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AddProjectMemberDto, CreateProjectDto, ListQuery } from '@opspilot/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AccessTokenPayload } from '../auth/token.service';
import { AddProjectMemberBody, CreateProjectBody } from './dto/orgs.dto';
import { OrgsService } from './orgs.service';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a project (O1, ADMIN only)' })
  @ApiBody({ type: CreateProjectBody })
  create(
    @Body(new ZodValidationPipe(CreateProjectDto)) dto: CreateProjectDto,
    @CurrentUser() actor: AccessTokenPayload,
    @Req() req: Request,
  ) {
    return this.orgs.createProject(actor, dto, { ip: req.ip });
  }

  @Get()
  @ApiOperation({ summary: 'List projects in my organization (paginated)' })
  list(
    @Query(new ZodValidationPipe(ListQuery)) query: ListQuery,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    return this.orgs.listProjects(actor, query);
  }

  @Post(':id/members')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Add a member to a project (O2, ADMIN only)' })
  @ApiBody({ type: AddProjectMemberBody })
  addMember(
    @Param('id', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(AddProjectMemberDto)) dto: AddProjectMemberDto,
    @CurrentUser() actor: AccessTokenPayload,
    @Req() req: Request,
  ) {
    return this.orgs.addMember(actor, projectId, dto, { ip: req.ip });
  }

  @Delete(':id/members/:userId')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a member from a project (O2, ADMIN only)' })
  removeMember(
    @Param('id', ParseUUIDPipe) projectId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() actor: AccessTokenPayload,
    @Req() req: Request,
  ) {
    return this.orgs.removeMember(actor, projectId, userId, { ip: req.ip });
  }
}
