import { createHash } from 'crypto'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity'
import { WorkflowRunEntity } from '../autoflow/entities'
import { AdCreativeEntity, ShopifyStoreEntity } from './entities'
import { trafficScore } from './discovery-normalizer'
import {
  AD_DISCOVERY_ADAPTER,
  STORE_DISCOVERY_ADAPTER,
  type AdDiscoveryAdapter,
  type DiscoveryEvidenceResult,
  type LeadCandidate,
  type NormalizedAdCreative,
  type NormalizedShopifyStore,
  type StoreDiscoveryAdapter,
} from './discovery.types'

@Injectable()
export class DiscoveryService {
  constructor(
    @InjectRepository(WorkflowRunEntity)
    private readonly workflowRepository: Repository<WorkflowRunEntity>,
    @InjectRepository(AdCreativeEntity)
    private readonly adCreativeRepository: Repository<AdCreativeEntity>,
    @InjectRepository(ShopifyStoreEntity)
    private readonly shopifyStoreRepository: Repository<ShopifyStoreEntity>,
    @Inject(AD_DISCOVERY_ADAPTER)
    private readonly adAdapter: AdDiscoveryAdapter,
    @Inject(STORE_DISCOVERY_ADAPTER)
    private readonly storeAdapter: StoreDiscoveryAdapter,
  ) {}

  async discoverEvidence(ownerUserId: string, workflowRunId: string): Promise<DiscoveryEvidenceResult> {
    const workflow = await this.workflowRepository.findOne({ where: { id: workflowRunId, ownerUserId } })
    if (!workflow) throw new NotFoundException('Workflow not found')

    const seed = {
      type: workflow.seedType,
      value: workflow.seedValue,
      targetMarket: workflow.targetMarket,
    }
    const [adapterAds, adapterStores] = await Promise.all([
      this.adAdapter.discover(seed),
      this.storeAdapter.discover(seed),
    ])
    const ads = [...new Map(adapterAds.map((ad) => [this.adKey(ad), ad])).values()]
    const stores = [...new Map(adapterStores.map((store) => [store.normalizedDomain, store])).values()]

    await Promise.all([
      this.persistAds(ownerUserId, workflow.teamId, workflowRunId, ads),
      this.persistStores(ownerUserId, workflow.teamId, workflowRunId, stores),
    ])

    return {
      workflowRunId,
      ads,
      stores,
      candidates: stores.map((store) => this.toLeadCandidate(store)),
    }
  }

  private async persistAds(
    ownerUserId: string,
    teamId: string | null,
    workflowRunId: string,
    ads: NormalizedAdCreative[],
  ): Promise<void> {
    if (ads.length === 0) return

    const rows = ads.map((ad) => this.adCreativeRepository.create({
      workflowRunId,
      ownerUserId,
      teamId,
      provider: ad.provider,
      deduplicationKey: this.adKey(ad),
      advertiserName: ad.advertiserName,
      sourceUrl: ad.sourceUrl,
      description: ad.description,
      imageUrl: ad.imageUrl,
      confidence: ad.confidence,
      rawPayload: ad.rawPayload,
    }))

    await this.adCreativeRepository.upsert(
      rows as unknown as QueryDeepPartialEntity<AdCreativeEntity>[],
      {
      conflictPaths: ['workflowRunId', 'provider', 'deduplicationKey'],
      skipUpdateIfNoValuesChanged: true,
      },
    )
  }

  private async persistStores(
    ownerUserId: string,
    teamId: string | null,
    workflowRunId: string,
    stores: NormalizedShopifyStore[],
  ): Promise<void> {
    if (stores.length === 0) return

    const rows = stores.map((store) => this.shopifyStoreRepository.create({
      workflowRunId,
      ownerUserId,
      teamId,
      leadId: null,
      name: store.name,
      domain: store.domain,
      normalizedDomain: store.normalizedDomain,
      url: store.url,
      description: store.description,
      imageUrl: store.imageUrl,
      detectionSource: store.detectionSource,
      shopifyConfidence: store.shopifyConfidence,
      traffic: store.traffic,
      rawPayload: store.rawPayload,
    }))

    await this.shopifyStoreRepository.upsert(
      rows as unknown as QueryDeepPartialEntity<ShopifyStoreEntity>[],
      {
      conflictPaths: ['workflowRunId', 'normalizedDomain'],
      skipUpdateIfNoValuesChanged: true,
      },
    )
  }

  private toLeadCandidate(store: NormalizedShopifyStore): LeadCandidate {
    const monthlyVisits = typeof store.traffic?.monthlyVisits === 'number'
      ? store.traffic.monthlyVisits
      : undefined

    return {
      brandName: store.name,
      domain: store.domain,
      normalizedDomain: store.normalizedDomain,
      storeUrl: store.url,
      source: store.detectionSource,
      shopifyConfidence: store.shopifyConfidence,
      trafficScore: trafficScore(monthlyVisits),
    }
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }

  private adKey(ad: NormalizedAdCreative): string {
    return this.hash(`${ad.provider}|${ad.advertiserName.toLowerCase()}|${ad.sourceUrl}`)
  }
}
