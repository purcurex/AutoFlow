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
  type CustomerDiscoveryResult,
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

  async discoverEvidence(ownerUserId: string, workflowRunId: string): Promise<CustomerDiscoveryResult> {
    const workflow = await this.workflowRepository.findOne({ where: { id: workflowRunId, ownerUserId } })
    if (!workflow) throw new NotFoundException('Workflow not found')

    const providerSeedValue = this.resolveProviderSeedValue(workflow)
    if (providerSeedValue === null) {
      return {
        status: 'skipped',
        reasonCode: 'public_image_not_configured',
        reason: 'Public image URL is not configured; customer discovery was skipped.',
        evidence: { workflowRunId, ads: [], stores: [], candidates: [] },
      }
    }

    const seed = {
      type: workflow.seedType,
      value: providerSeedValue,
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
      status: 'completed',
      evidence: {
        workflowRunId,
        ads,
        stores,
        candidates: stores.map((store) => this.toLeadCandidate(store, ads)),
      },
    }
  }

  /**
   * 外部客户发现服务无法访问本机地址。本机资产路径先做用户归属校验，再决定是否可拼接公网地址。
   * 返回 null 只表示公网图片尚未配置；非法资产路径仍抛出异常，避免把数据损坏降级为正常跳过。
   */
  private resolveProviderSeedValue(workflow: WorkflowRunEntity): string | null {
    if (workflow.seedType !== 'image' || !workflow.seedAssetPath) return workflow.seedValue

    // 资产路径必须仍归属当前工作流用户，阻断数据库异常值借助 URL 拼接切换到其他主机或用户目录。
    const normalizedAssetPath = workflow.seedAssetPath.replace(/\\/g, '/')
    const expectedPrefix = `/uploads/workflow-seeds/${workflow.ownerUserId}/`
    if (!normalizedAssetPath.startsWith(expectedPrefix) || normalizedAssetPath.startsWith('//')) {
      throw new BadRequestException('Workflow image asset path is invalid.')
    }

    const publicBaseUrl = this.configService.get<string>('PUBLIC_ASSET_BASE_URL')?.trim()
    if (!publicBaseUrl || !isPublicProviderUrl(publicBaseUrl)) return null

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
