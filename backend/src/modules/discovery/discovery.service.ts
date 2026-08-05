import { createHash } from 'crypto'
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity'
import { WorkflowRunEntity } from '../autoflow/entities'
import { DEFAULT_GOOGLE_SEARCH_OPTIONS } from '../autoflow/autoflow.types'
import { isPublicProviderUrl } from '../autoflow/workflow-seed-asset.service'
import { AdCreativeEntity, ShopifyStoreEntity } from './entities'
import { trafficScore } from './discovery-normalizer'
import { StorefrontEnrichmentService } from './storefront-enrichment.service'
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
    private readonly storefrontEnrichmentService: StorefrontEnrichmentService,
    private readonly configService: ConfigService,
  ) {}

  async discoverEvidence(ownerUserId: string, workflowRunId: string): Promise<DiscoveryEvidenceResult> {
    const workflow = await this.workflowRepository.findOne({ where: { id: workflowRunId, ownerUserId } })
    if (!workflow) throw new NotFoundException('Workflow not found')

    const seed = {
      type: workflow.seedType,
      value: this.resolveProviderSeedValue(workflow),
      targetMarket: workflow.targetMarket,
      searchOptions: {
        ...DEFAULT_GOOGLE_SEARCH_OPTIONS,
        ...(workflow.searchOptions || {}),
      },
    }
    const [adapterAds, adapterStores] = await Promise.all([
      this.adAdapter.discover(seed),
      this.storeAdapter.discover(seed),
    ])
    const ads = [...new Map(adapterAds.map((ad) => [this.adKey(ad), ad])).values()]
    const deduplicatedStores = [...new Map(adapterStores.map((store) => [store.normalizedDomain, store])).values()]
    const enrichedStores = await this.storefrontEnrichmentService.enrich(deduplicatedStores)
    const stores = enrichedStores
      .filter((store) => ['verified', 'probable', 'mock'].includes(store.verificationStatus))
      .sort((left, right) => right.validityScore - left.validityScore)

    await Promise.all([
      this.persistAds(ownerUserId, workflow.teamId, workflowRunId, ads),
      this.persistStores(ownerUserId, workflow.teamId, workflowRunId, stores),
    ])

    return {
      workflowRunId,
      ads,
      stores,
      candidates: stores.map((store) => this.toLeadCandidate(store, ads)),
    }
  }

  /**
   * 外部客户发现服务无法访问 localhost。本地上传图片仅在调用时转换为受控公网地址；
   * 公开图片工作流继续使用原始 seedValue，关键词工作流不受影响。
   */
  private resolveProviderSeedValue(workflow: WorkflowRunEntity): string {
    if (workflow.seedType !== 'image' || !workflow.seedAssetPath) return workflow.seedValue

    const publicBaseUrl = this.configService.get<string>('PUBLIC_ASSET_BASE_URL')?.trim()
    if (!publicBaseUrl || !isPublicProviderUrl(publicBaseUrl)) {
      throw new BadRequestException(
        'Workflow product image is only available locally. Configure a publicly reachable PUBLIC_ASSET_BASE_URL.',
      )
    }

    // 资产路径必须仍归属当前工作流用户，阻断数据库异常值借助 URL 拼接切换到其他主机或用户目录。
    const normalizedAssetPath = workflow.seedAssetPath.replace(/\\/g, '/')
    const expectedPrefix = `/uploads/workflow-seeds/${workflow.ownerUserId}/`
    if (!normalizedAssetPath.startsWith(expectedPrefix) || normalizedAssetPath.startsWith('//')) {
      throw new BadRequestException('Workflow image asset path is invalid.')
    }

    return new URL(normalizedAssetPath, `${publicBaseUrl.replace(/\/$/, '')}/`).toString()
  }

  async getPersistedEvidence(
    ownerUserId: string,
    workflowRunId: string,
  ): Promise<DiscoveryEvidenceResult> {
    const workflow = await this.workflowRepository.findOne({ where: { id: workflowRunId, ownerUserId } })
    if (!workflow) throw new NotFoundException('Workflow not found')

    const [adEntities, storeEntities] = await Promise.all([
      this.adCreativeRepository.find({
        where: { workflowRunId, ownerUserId },
        order: { discoveredAt: 'ASC' },
      }),
      this.shopifyStoreRepository.find({
        where: { workflowRunId, ownerUserId },
        order: { discoveredAt: 'ASC' },
      }),
    ])
    const ads: NormalizedAdCreative[] = adEntities.map((ad) => ({
      provider: ad.provider,
      evidenceSource: typeof ad.rawPayload?.evidenceSource === 'string'
        ? ad.rawPayload.evidenceSource
        : ad.provider,
      platform: this.adPlatform(ad.rawPayload?.platform),
      adId: typeof ad.rawPayload?.adId === 'string' ? ad.rawPayload.adId : null,
      advertiserName: ad.advertiserName,
      sourceUrl: ad.sourceUrl,
      isDirectAdLink: ad.rawPayload?.isDirectAdLink === true,
      description: ad.description,
      imageUrl: ad.imageUrl,
      confidence: ad.confidence,
      rawPayload: ad.rawPayload || {},
    }))
    const stores: NormalizedShopifyStore[] = storeEntities.map((store) => ({
      name: store.name,
      domain: store.domain,
      normalizedDomain: store.normalizedDomain,
      url: store.url,
      productUrl: store.productUrl,
      description: store.description,
      imageUrl: store.imageUrl,
      detectionSource: store.detectionSource,
      discoverySources: store.discoverySources || [],
      validityScore: store.validityScore || 0,
      shopifyConfidence: store.shopifyConfidence,
      verificationStatus: store.verificationStatus,
      verificationEvidence: store.verificationEvidence || {},
      verifiedAt: store.verifiedAt?.toISOString() || null,
      contacts: store.contacts || [],
      traffic: store.traffic,
      rawPayload: store.rawPayload || {},
    }))

    return {
      workflowRunId,
      ads,
      stores,
      candidates: stores.map((store) => this.toLeadCandidate(store, ads)),
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
      productUrl: store.productUrl,
      description: store.description,
      imageUrl: store.imageUrl,
      detectionSource: store.detectionSource,
      discoverySources: store.discoverySources,
      validityScore: store.validityScore,
      shopifyConfidence: store.shopifyConfidence,
      verificationStatus: store.verificationStatus,
      verificationEvidence: store.verificationEvidence,
      verifiedAt: store.verifiedAt ? new Date(store.verifiedAt) : null,
      contacts: store.contacts,
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

  private toLeadCandidate(
    store: NormalizedShopifyStore,
    ads: NormalizedAdCreative[],
  ): LeadCandidate {
    const monthlyVisits = typeof store.traffic?.monthlyVisits === 'number'
      ? store.traffic.monthlyVisits
      : undefined

    return {
      brandName: store.name,
      domain: store.domain,
      normalizedDomain: store.normalizedDomain,
      storeUrl: store.url,
      productUrl: store.productUrl,
      discoverySources: store.discoverySources,
      validityScore: store.validityScore,
      source: store.detectionSource,
      shopifyConfidence: store.shopifyConfidence,
      trafficScore: trafficScore(monthlyVisits),
      verificationStatus: store.verificationStatus,
      description: store.description,
      contacts: store.contacts,
      adEvidence: this.matchAds(store, ads),
    }
  }

  private matchAds(store: NormalizedShopifyStore, ads: NormalizedAdCreative[]): LeadCandidate['adEvidence'] {
    const storeIdentity = this.normalizeIdentity(store.name)
    const domainIdentity = this.normalizeIdentity(store.normalizedDomain.split('.')[0])
    const storeTokens = new Set(this.identityTokens(`${store.name} ${store.description} ${domainIdentity}`))

    return ads.flatMap((ad) => {
      const adIdentity = this.normalizeIdentity(ad.advertiserName.replace(/\s+ads?$/i, ''))
      const adTokens = this.identityTokens(`${ad.advertiserName} ${ad.description}`)
      const sharedTokens = adTokens.filter((token) => storeTokens.has(token))
      const directIdentityMatch = Boolean(adIdentity && (
        adIdentity === storeIdentity
        || adIdentity === domainIdentity
        || (adIdentity.length >= 5 && storeIdentity.includes(adIdentity))
      ))
      if (!directIdentityMatch && sharedTokens.length < 2) return []

      return [{
        provider: ad.provider,
        evidenceSource: ad.evidenceSource,
        platform: ad.platform,
        adId: ad.adId,
        sourceUrl: ad.sourceUrl,
        isDirectAdLink: ad.isDirectAdLink,
        confidence: directIdentityMatch ? Math.max(ad.confidence, 80) : ad.confidence,
        matchReasons: directIdentityMatch ? ['advertiser_identity'] : sharedTokens.map((token) => `token:${token}`),
      }]
    })
  }

  private normalizeIdentity(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
  }

  private identityTokens(value: string): string[] {
    const ignored = new Set(['shop', 'store', 'online', 'official', 'with', 'from', 'your', 'products'])
    return value.toLowerCase().split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4 && !ignored.has(token))
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }

  private adKey(ad: NormalizedAdCreative): string {
    return this.hash(`${ad.provider}|${ad.advertiserName.toLowerCase()}|${ad.sourceUrl}`)
  }

  private adPlatform(value: unknown): NormalizedAdCreative['platform'] {
    return ['facebook', 'instagram', 'tiktok'].includes(String(value))
      ? value as NormalizedAdCreative['platform']
      : 'unknown'
  }
}
