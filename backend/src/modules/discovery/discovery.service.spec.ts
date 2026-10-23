import { NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { ObjectLiteral, Repository } from 'typeorm'
import { WorkflowRunEntity } from '../autoflow/entities'
import { DiscoveryService } from './discovery.service'
import type { AdDiscoveryAdapter, NormalizedShopifyStore, StoreDiscoveryAdapter } from './discovery.types'
import { AdCreativeEntity, ShopifyStoreEntity } from './entities'
import type { StorefrontEnrichmentService } from './storefront-enrichment.service'

describe('DiscoveryService', () => {
  function repository<T extends ObjectLiteral>() {
    return {
      create: jest.fn((value) => value),
      findOne: jest.fn(),
      upsert: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Repository<T>>
  }

  function createService(config: Record<string, string> = {}) {
    const workflows = repository<WorkflowRunEntity>()
    const ads = repository<AdCreativeEntity>()
    const stores = repository<ShopifyStoreEntity>()
    const adAdapter = { discover: jest.fn() } as jest.Mocked<AdDiscoveryAdapter>
    const storeAdapter = { discover: jest.fn() } as jest.Mocked<StoreDiscoveryAdapter>
    const enrichment = {
      enrich: jest.fn().mockImplementation(async (values) => values),
    } as unknown as jest.Mocked<StorefrontEnrichmentService>
    const service = new DiscoveryService(
      workflows,
      ads,
      stores,
      adAdapter,
      storeAdapter,
      enrichment,
      new ConfigService(config),
    )
    return { service, workflows, ads, stores, adAdapter, storeAdapter }
  }

  it('checks workflow ownership before calling paid adapters', async () => {
    const { service, workflows, adAdapter, storeAdapter } = createService()
    workflows.findOne.mockResolvedValue(null)

    await expect(service.discoverEvidence('owner-1', 'workflow-1')).rejects.toBeInstanceOf(NotFoundException)
    expect(adAdapter.discover).not.toHaveBeenCalled()
    expect(storeAdapter.discover).not.toHaveBeenCalled()
  })

  it('normalizes, deduplicates, and persists workflow evidence', async () => {
    const { service, workflows, ads, stores, adAdapter, storeAdapter } = createService()
    workflows.findOne.mockResolvedValue({
      id: 'workflow-1',
      ownerUserId: 'owner-1',
      teamId: null,
      seedType: 'keyword',
      seedValue: 'pet brush',
      targetMarket: 'United States',
    } as WorkflowRunEntity)
    const ad = {
      provider: 'facebook_ads',
      evidenceSource: 'facebook_ads_search',
      platform: 'facebook' as const,
      adId: 'ad-1',
      advertiserName: 'PawSpark',
      sourceUrl: 'https://facebook.example/ad/1',
      isDirectAdLink: true,
      description: 'Pet brush ad',
      imageUrl: null,
      confidence: 60,
      rawPayload: {},
    }
    adAdapter.discover.mockResolvedValue([ad, ad])
    const store: NormalizedShopifyStore = {
      name: 'PawSpark',
      domain: 'pawspark.myshopify.com',
      normalizedDomain: 'pawspark.myshopify.com',
      url: 'https://pawspark.myshopify.com',
      productUrl: 'https://pawspark.myshopify.com/products/pet-brush',
      description: 'Pet products',
      imageUrl: null,
      detectionSource: 'shopify_search',
      discoverySources: ['google_search'],
      validityScore: 90,
      shopifyConfidence: 100,
      verificationStatus: 'verified' as const,
      verificationEvidence: { source: 'test' },
      verifiedAt: '2026-07-22T00:00:00.000Z',
      contacts: [],
      traffic: { monthlyVisits: 50000 },
      rawPayload: {},
    }
    storeAdapter.discover.mockResolvedValue([store, store])

    const result = await service.discoverEvidence('owner-1', 'workflow-1')

    expect(adAdapter.discover).toHaveBeenCalledWith(expect.objectContaining({
      type: 'keyword',
      value: 'pet brush',
      targetMarket: 'United States',
    }))
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('Expected completed customer discovery')
    expect(result.evidence.ads).toHaveLength(1)
    expect(result.evidence.stores).toHaveLength(1)
    expect(result.evidence.candidates).toEqual([expect.objectContaining({
      normalizedDomain: 'pawspark.myshopify.com',
      shopifyConfidence: 100,
      trafficScore: 85,
      adEvidence: [expect.objectContaining({ matchReasons: ['advertiser_identity'] })],
    })])
    expect(ads.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ ownerUserId: 'owner-1', teamId: null, workflowRunId: 'workflow-1' })],
      expect.objectContaining({ conflictPaths: ['workflowRunId', 'provider', 'deduplicationKey'] }),
    )
    expect(stores.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ ownerUserId: 'owner-1', teamId: null, normalizedDomain: 'pawspark.myshopify.com' })],
      expect.objectContaining({ conflictPaths: ['workflowRunId', 'normalizedDomain'] }),
    )
  })

  it('converts an owned local image path to the configured public provider URL', async () => {
    const { service, workflows, adAdapter, storeAdapter } = createService({
      PUBLIC_ASSET_BASE_URL: 'https://assets.example.com/',
    })
    workflows.findOne.mockResolvedValue({
      id: 'workflow-image',
      ownerUserId: 'owner-1',
      teamId: null,
      seedType: 'image',
      seedValue: 'http://localhost:3000/uploads/workflow-seeds/owner-1/product.jpg',
      seedAssetPath: '/uploads/workflow-seeds/owner-1/product.jpg',
      targetMarket: 'United States',
    } as WorkflowRunEntity)
    adAdapter.discover.mockResolvedValue([])
    storeAdapter.discover.mockResolvedValue([])

    const result = await service.discoverEvidence('owner-1', 'workflow-image')

    expect(result.status).toBe('completed')
    expect(adAdapter.discover).toHaveBeenCalledWith(expect.objectContaining({
      type: 'image',
      value: 'https://assets.example.com/uploads/workflow-seeds/owner-1/product.jpg',
    }))
    expect(storeAdapter.discover).toHaveBeenCalledWith(expect.objectContaining({
      value: 'https://assets.example.com/uploads/workflow-seeds/owner-1/product.jpg',
    }))
  })

  it('skips customer discovery without calling paid adapters when a local image has no public base', async () => {
    const { service, workflows, adAdapter, storeAdapter } = createService()
    workflows.findOne.mockResolvedValue({
      id: 'workflow-image',
      ownerUserId: 'owner-1',
      teamId: null,
      seedType: 'image',
      seedValue: 'http://localhost:3000/uploads/workflow-seeds/owner-1/product.jpg',
      seedAssetPath: '/uploads/workflow-seeds/owner-1/product.jpg',
      targetMarket: 'United States',
    } as WorkflowRunEntity)

    const result = await service.discoverEvidence('owner-1', 'workflow-image')

    expect(result).toEqual({
      status: 'skipped',
      reasonCode: 'public_image_not_configured',
      reason: 'Public image URL is not configured; customer discovery was skipped.',
      evidence: {
        workflowRunId: 'workflow-image',
        ads: [],
        stores: [],
        candidates: [],
      },
    })
    expect(adAdapter.discover).not.toHaveBeenCalled()
    expect(storeAdapter.discover).not.toHaveBeenCalled()
  })

  it('rejects an invalid local asset path instead of treating it as an unconfigured public image', async () => {
    const { service, workflows, adAdapter, storeAdapter } = createService()
    workflows.findOne.mockResolvedValue({
      id: 'workflow-image',
      ownerUserId: 'owner-1',
      teamId: null,
      seedType: 'image',
      seedValue: 'http://localhost:3000/uploads/workflow-seeds/owner-2/product.jpg',
      seedAssetPath: '/uploads/workflow-seeds/owner-2/product.jpg',
      targetMarket: 'United States',
    } as WorkflowRunEntity)

    await expect(service.discoverEvidence('owner-1', 'workflow-image'))
      .rejects.toThrow('Workflow image asset path is invalid')
    expect(adAdapter.discover).not.toHaveBeenCalled()
    expect(storeAdapter.discover).not.toHaveBeenCalled()
  })
})
