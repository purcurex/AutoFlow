import { Module } from '@nestjs/common'
import { FopIntegrationController } from './fop-integration.controller'
import { FopIntegrationService } from './fop-integration.service'

@Module({
  controllers: [FopIntegrationController],
  providers: [FopIntegrationService],
  exports: [FopIntegrationService],
})
export class FopIntegrationModule {}
