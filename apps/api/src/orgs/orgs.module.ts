import { Module } from '@nestjs/common';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';

@Module({
  controllers: [OrgsController],
  providers: [OrgsService],
  // Exported so the incidents module resolves projects through this service
  // instead of reaching into Prisma across the module boundary (rule 1).
  exports: [OrgsService],
})
export class OrgsModule {}
