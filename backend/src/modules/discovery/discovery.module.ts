import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WorkflowJobEntity, WorkflowRunEntity } from '../autoflow/entities'
import { PipiAdsModule } from '../pipiads/pipiads.module'
import { PipiAdsAdDiscoveryAdapter } from './adapters/pipiads-ad-discovery.adapter'
import { PipiAdsStoreDiscoveryAdapter } from './adapters/pipiads-store-discovery.adapter'
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
import { StorefrontEnrichmentService } from './storefront-enrichment.service'
import { ShopifySearchModule } from '../shopify-search/shopify-search.module'
import { ShopifyStoreDiscoveryAdapter } from './adapters/shopify-store-discovery.adapter'
import { SourcingModule } from '../sourcing/sourcing.module'

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
    PipiAdsModule,
    ShopifySearchModule,
    SourcingModule,
  ],
  providers: [
    DiscoveryService,
    WorkflowExecutionService,
    WorkflowJobWorkerService,
    StorefrontEnrichmentService,
    ShopifyStoreDiscoveryAdapter,
    { provide: AD_DISCOVERY_ADAPTER, useClass: PipiAdsAdDiscoveryAdapter },
    { provide: STORE_DISCOVERY_ADAPTER, useClass: PipiAdsStoreDiscoveryAdapter },
  ],
  exports: [DiscoveryService, WorkflowExecutionService, StorefrontEnrichmentService],
})
export class DiscoveryModule {}
