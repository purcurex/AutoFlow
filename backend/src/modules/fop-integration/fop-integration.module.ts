import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { CrmActivityEntity, LeadEntity } from '../autoflow/entities'
import { FopIntegrationController } from './fop-integration.controller'
import { FopIntegrationService } from './fop-integration.service'
import { FopCrmHandoffPort, FopLogisticsRatePort, FopProductCostPort } from './fop-integration.types'
import {
  SandboxFopCrmHandoffAdapter,
  SandboxFopLogisticsRateAdapter,
  SandboxFopProductCostAdapter,
  UnavailableFopCrmHandoffAdapter,
  UnavailableFopLogisticsRateAdapter,
  UnavailableFopProductCostAdapter,
} from './fop-sandbox.adapters'
import { FopHandoffEntity } from './fop-handoff.entity'
import { FopHandoffController } from './fop-handoff.controller'
import { FopHandoffService } from './fop-handoff.service'

@Module({
  imports: [TypeOrmModule.forFeature([FopHandoffEntity, LeadEntity, CrmActivityEntity])],
  controllers: [FopIntegrationController, FopHandoffController],
  providers: [
    FopIntegrationService,
    FopHandoffService,
    {
      provide: FopProductCostPort,
      inject: [FopIntegrationService],
      useFactory: (service: FopIntegrationService) => service.isSandboxEnabled()
        ? new SandboxFopProductCostAdapter()
        : new UnavailableFopProductCostAdapter(),
    },
    {
      provide: FopLogisticsRatePort,
      inject: [FopIntegrationService],
      useFactory: (service: FopIntegrationService) => service.isSandboxEnabled()
        ? new SandboxFopLogisticsRateAdapter()
        : new UnavailableFopLogisticsRateAdapter(),
    },
    {
      provide: FopCrmHandoffPort,
      inject: [FopIntegrationService],
      useFactory: (service: FopIntegrationService) => service.isSandboxEnabled()
        ? new SandboxFopCrmHandoffAdapter()
        : new UnavailableFopCrmHandoffAdapter(),
    },
  ],
  exports: [FopIntegrationService, FopProductCostPort, FopLogisticsRatePort, FopCrmHandoffPort],
})
export class FopIntegrationModule {}
