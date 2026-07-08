import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  ChangeDeploymentStatusDto,
  CreateApiKeyDto,
  ListDeploymentsQuery,
  RecordDeploymentDto,
} from '@opspilot/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AccessTokenPayload } from '../auth/token.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ApiKeysService } from './api-keys.service';
import { DeploymentsService } from './deployments.service';
import {
  ChangeDeploymentStatusBody,
  CreateApiKeyBody,
  RecordDeploymentBody,
} from './dto/deployments.dto';
import { ApiKeyOrJwtGuard, type IngestRequest } from './guards/api-key-or-jwt.guard';

@ApiTags('deployments')
@Controller('deployments')
export class DeploymentsController {
  constructor(private readonly deployments: DeploymentsService) {}

  // @Public only skips the global JWT guard; ApiKeyOrJwtGuard still requires
  // a valid X-API-Key or a write-capable bearer token.
  @Public()
  @UseGuards(ApiKeyOrJwtGuard)
  @Post()
  @ApiSecurity('api-key')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record a deployment (D1/D2) — JWT or X-API-Key' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Replays return the original record (24 h)' })
  @ApiBody({ type: RecordDeploymentBody })
  async record(
    @Body(new ZodValidationPipe(RecordDeploymentDto)) dto: RecordDeploymentDto,
    @Req() req: IngestRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const { deployment, replayed } = await this.deployments.record(
      req.deployActor!, // set by ApiKeyOrJwtGuard
      dto,
      { ip: req.ip },
      idempotencyKey,
    );
    res.status(replayed ? 200 : 201);
    return deployment;
  }

  @Public()
  @UseGuards(ApiKeyOrJwtGuard)
  @Patch(':id/status')
  @ApiSecurity('api-key')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update deployment status (D1) — CI completion/rollback' })
  @ApiBody({ type: ChangeDeploymentStatusBody })
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ChangeDeploymentStatusDto)) dto: ChangeDeploymentStatusDto,
    @Req() req: IngestRequest,
  ) {
    return this.deployments.changeStatus(req.deployActor!, id, dto, { ip: req.ip });
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deployment history (D3): filter by project/env/status' })
  list(
    @Query(new ZodValidationPipe(ListDeploymentsQuery)) query: ListDeploymentsQuery,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    return this.deployments.list(actor, query);
  }
}

@ApiTags('api-keys')
@ApiBearerAuth()
@Controller()
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Post('projects/:id/api-keys')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a CI API key (D2, ADMIN) — plaintext returned once' })
  @ApiBody({ type: CreateApiKeyBody })
  create(
    @Param('id', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(CreateApiKeyDto)) dto: CreateApiKeyDto,
    @CurrentUser() actor: AccessTokenPayload,
    @Req() req: Request,
  ) {
    return this.apiKeys.create(actor, projectId, dto, { ip: req.ip });
  }

  @Get('projects/:id/api-keys')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List a project’s API keys (prefix only)' })
  list(
    @Param('id', ParseUUIDPipe) projectId: string,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    return this.apiKeys.list(actor, projectId);
  }

  @Delete('api-keys/:id')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke an API key' })
  revoke(
    @Param('id', ParseUUIDPipe) keyId: string,
    @CurrentUser() actor: AccessTokenPayload,
    @Req() req: Request,
  ) {
    return this.apiKeys.revoke(actor, keyId, { ip: req.ip });
  }
}
