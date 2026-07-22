import { Module } from '@nestjs/common'
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

@Module({
  controllers: [FopIntegrationController],
  providers: [
    FopIntegrationService,
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
