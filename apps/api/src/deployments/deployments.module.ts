import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OrgsModule } from '../orgs/orgs.module';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController, DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { ApiKeyOrJwtGuard } from './guards/api-key-or-jwt.guard';

@Module({
  // Bare JwtModule: the guard verifies with an explicit secret per call.
  imports: [JwtModule.register({}), OrgsModule],
  controllers: [DeploymentsController, ApiKeysController],
  providers: [DeploymentsService, ApiKeysService, ApiKeyOrJwtGuard],
  // Exported so incidents can resolve deployment links (D4) via this service.
  exports: [DeploymentsService],
})
export class DeploymentsModule {}
