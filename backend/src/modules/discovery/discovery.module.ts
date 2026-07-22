import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WorkflowJobEntity, WorkflowRunEntity } from '../autoflow/entities'
import { FacebookAdsModule } from '../facebook-ads/facebook-ads.module'
import { ShopifySearchModule } from '../shopify-search/shopify-search.module'
import { FacebookAdsDiscoveryAdapter } from './adapters/facebook-ads-discovery.adapter'
import { ShopifyStoreDiscoveryAdapter } from './adapters/shopify-store-discovery.adapter'
import { DiscoveryService } from './discovery.service'
import { AD_DISCOVERY_ADAPTER, STORE_DISCOVERY_ADAPTER } from './discovery.types'
import { AdCreativeEntity, ShopifyStoreEntity } from './entities'
import {
  LeadEntity,
  LeadScoreEntity,
  WorkflowLeadEntity,
  WorkflowStepEntity,
} from '../autoflow/entities'
import { WorkflowExecutionService } from './workflow-execution.service'
import { WorkflowJobWorkerService } from './workflow-job-worker.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkflowRunEntity,
      WorkflowJobEntity,
      WorkflowStepEntity,
      WorkflowLeadEntity,
      LeadEntity,
      LeadScoreEntity,
      AdCreativeEntity,
      ShopifyStoreEntity,
    ]),
    FacebookAdsModule,
    ShopifySearchModule,
  ],
  providers: [
    DiscoveryService,
    WorkflowExecutionService,
    WorkflowJobWorkerService,
    { provide: AD_DISCOVERY_ADAPTER, useClass: FacebookAdsDiscoveryAdapter },
    { provide: STORE_DISCOVERY_ADAPTER, useClass: ShopifyStoreDiscoveryAdapter },
  ],
  exports: [DiscoveryService, WorkflowExecutionService],
})
export class DiscoveryModule {}
