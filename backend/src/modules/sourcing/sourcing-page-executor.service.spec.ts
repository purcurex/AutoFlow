import type { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm'
import type {
  Alibaba1688Service,
  Alibaba1688StableOffer,
  Alibaba1688StableProductDetail,
  Alibaba1688StableSearchResult,
} from '../alibaba1688'
import { WorkflowRunEntity } from '../autoflow/entities'
import {
  SourcingOfferEntity,
  SourcingSearchEntity,
  SourcingSearchPageEntity,
  SourcingSupplierEntity,
} from './entities'
import type { SourcingImageResolverService } from './sourcing-image-resolver.service'
import type { SourcingSupplierNameCacheService } from './sourcing-supplier-name-cache.service'
import {
  SourcingPageExecutorService,
  type ClaimedSourcingPage,
} from './sourcing-page-executor.service'

describe('SourcingPageExecutorService', () => {
  function stableOffer(index: number): Alibaba1688StableOffer {
    return {
      provider: 'alibaba_1688',
      sourceTag: '1688货源',
      offerId: `offer-${index}`,
      offerUrl: `https://detail.1688.com/offer/offer-${index}.html`,
      title: `Pet brush ${index}`,
      translatedTitle: `Pet brush ${index}`,
      imageUrl: `https://cbu01.alicdn.com/offer-${index}.jpg`,
      price: {
        currency: 'CNY',
        amount: '8.80',
        consignAmount: null,
        selectedSupplyAmount: null,
        promotionAmount: null,
      },
      minOrderQuantity: 1,
      monthSold: 20,
      repurchaseRate: '0.25',
      onePieceDropshipping: true,
      selectedSupply: false,
      tradeScore: '4.5',
      offerIdentities: [],
      seller: {
        openId: null,
        companyName: null,
        shopUrl: null,
        identities: [],
        tradeMedalLevel: null,
        compositeServiceScore: null,
        logisticsExperienceScore: null,
        repeatPurchasePercent: null,
      },
    }
  }

  function stableDetail(offerId: string): Alibaba1688StableProductDetail {
    return {
      provider: 'alibaba_1688',
      sourceTag: '1688货源',
      offerId,
      offerUrl: `https://detail.1688.com/offer/${offerId}.html`,
      title: `Detail ${offerId}`,
      translatedTitle: `Detail ${offerId}`,
      description: null,
      categoryId: 'pet-care',
      categoryName: 'Pet care',
      imageUrls: [`https://cbu01.alicdn.com/${offerId}.jpg`],
      minOrderQuantity: 1,
      status: 'published',
      sold: 100,
      tradeScore: '4.8',
      sellingPoints: [],
      skus: [],
      seller: {
        openId: `supplier-${offerId}`,
        companyName: `Supplier ${offerId}`,
        shopUrl: null,
        identities: [],
        tradeMedalLevel: null,
        compositeServiceScore: '4.8',
        logisticsExperienceScore: null,
        repeatPurchasePercent: null,
      },
      affectsContactConfidence: false,
    }
  }

  function repository<T extends ObjectLiteral>() {
    return {
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn((value) => value),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (value) => value),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as jest.Mocked<Repository<T>>
  }

  function setup(searchMode: 'keyword' | 'image', imageId: string | null = null) {
    const searches = repository<SourcingSearchEntity>()
    const workflows = repository<WorkflowRunEntity>()
    const pages = repository<SourcingSearchPageEntity>()
    const offers = repository<SourcingOfferEntity>()
    const suppliers = repository<SourcingSupplierEntity>()
    const search = {
      id: 'search-1',
      ownerUserId: 'owner-1',
      workflowRunId: 'workflow-1',
      searchMode,
      keyword: searchMode === 'keyword' ? 'pet brush' : null,
      imageUrl: searchMode === 'image' ? 'https://assets.example.test/image.png' : null,
      imageId,
      languageCode: 'en',
      pageSize: 20,
      totalRecords: null,
      totalPages: null,
      requestPayload: { priceMin: '1.0000', priceMax: '10.0000' },
      status: 'running',
    } as unknown as SourcingSearchEntity
    const workflow = {
      id: 'workflow-1',
      ownerUserId: 'owner-1',
      seedType: searchMode,
      seedValue: searchMode === 'keyword' ? 'pet brush' : 'https://assets.example.test/image.png',
    } as WorkflowRunEntity
    searches.findOne.mockResolvedValue(search)
    workflows.findOne.mockResolvedValue(workflow)
    pages.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
    const normalized: Alibaba1688StableSearchResult = {
      provider: 'alibaba_1688',
      sourceTag: '1688货源',
      searchMode,
      page: 2,
      pageSize: 20,
      totalRecords: 21,
      totalPages: 2,
      offers: [],
      affectsContactConfidence: false,
    }
    const provider = {
      searchByKeyword: jest.fn().mockResolvedValue({
        provider: { result: { result: { data: [] } } },
        normalized,
        metadata: { requestId: 'request-1', traceId: 'trace-1' },
      }),
      searchByImage: jest.fn().mockResolvedValue({
        provider: { result: { result: { data: [] } } },
        normalized,
        metadata: { requestId: 'request-1', traceId: 'trace-1' },
      }),
      uploadImage: jest.fn().mockResolvedValue({
        provider: {},
        normalized: { provider: 'alibaba_1688', imageId: 'image-1' },
        metadata: { requestId: 'upload-request', traceId: 'upload-trace' },
      }),
      getProductDetail: jest.fn(),
    } as unknown as jest.Mocked<Alibaba1688Service>
    const imageResolver = {
      resolve: jest.fn().mockResolvedValue({
        bytes: Buffer.from('verified-image'),
        mimeType: 'image/jpeg',
        byteLength: 14,
        sha256: 'a'.repeat(64),
        sourceType: 'local',
        sourceHost: null,
      }),
    } as unknown as jest.Mocked<SourcingImageResolverService>
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === SourcingSearchEntity) return searches
        if (entity === SourcingSearchPageEntity) return pages
        if (entity === SourcingOfferEntity) return offers
        return suppliers
      }),
    } as unknown as EntityManager
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    } as unknown as jest.Mocked<DataSource>
    const supplierNameCache = {
      findRecent: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<SourcingSupplierNameCacheService>
    const service = new SourcingPageExecutorService(
      searches,
      workflows,
      provider,
      imageResolver,
      dataSource,
      supplierNameCache,
    )
    const page: ClaimedSourcingPage = {
      id: 'page-2',
      searchId: 'search-1',
      workflowRunId: 'workflow-1',
      ownerUserId: 'owner-1',
      pageNumber: 2,
      pageSize: 20,
      attempts: 1,
      maxAttempts: 3,
      leaseOwner: 'worker-1',
    }
    return {
      service,
      page,
      provider,
      imageResolver,
      searches,
      pages,
      offers,
      suppliers,
      search,
      normalized,
      supplierNameCache,
    }
  }

  it('requests the claimed keyword page and completes it under the same lease', async () => {
    const { service, page, provider, pages } = setup('keyword')

    await service.executePage(page)

    expect(provider.searchByKeyword).toHaveBeenCalledWith(expect.objectContaining({
      keyword: 'pet brush',
      beginPage: 2,
      pageSize: 20,
      priceStart: '1.0000',
      priceEnd: '10.0000',
    }))
    expect(pages.update).toHaveBeenCalledWith(
      { id: 'page-2', status: 'running', leaseOwner: 'worker-1' },
      expect.objectContaining({
        status: 'succeeded',
        providerRequestId: 'request-1',
        providerTraceId: 'trace-1',
      }),
    )
  })

  it('uploads an image once and searches only with the returned imageId', async () => {
    const { service, page, provider, imageResolver, searches } = setup('image')
    page.pageNumber = 1

    await service.executePage(page)

    expect(imageResolver.resolve).toHaveBeenCalledTimes(1)
    expect(provider.uploadImage).toHaveBeenCalledTimes(1)
    expect(provider.searchByImage).toHaveBeenCalledWith(expect.objectContaining({
      imageId: 'image-1',
      beginPage: 1,
      pageSize: 20,
    }))
    expect(searches.update).toHaveBeenCalledWith(
      { id: 'search-1', ownerUserId: 'owner-1' },
      expect.objectContaining({
        imageId: 'image-1',
        imageUploadRequestId: 'upload-request',
        imageUploadTraceId: 'upload-trace',
      }),
    )
  })

  it('reuses an existing imageId on later pages', async () => {
    const { service, page, provider, imageResolver } = setup('image', 'existing-image')

    await service.executePage(page)

    expect(imageResolver.resolve).not.toHaveBeenCalled()
    expect(provider.uploadImage).not.toHaveBeenCalled()
    expect(provider.searchByImage).toHaveBeenCalledWith(expect.objectContaining({
      imageId: 'existing-image',
      beginPage: 2,
    }))
  })

  it('returns a partial search to succeeded after its last failed page succeeds', async () => {
    const { service, page, pages, searches, search } = setup('keyword')
    search.status = 'partial'
    pages.count
      .mockReset()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0)

    await service.executePage(page)

    expect(searches.save).toHaveBeenCalledWith(expect.objectContaining({
      status: 'succeeded',
      errorCode: null,
      errorMessage: null,
    }))
  })

  it('loads supplier details for every offer with at most five concurrent requests', async () => {
    const { service, page, provider, normalized, offers, suppliers } = setup('keyword')
    normalized.offers = Array.from({ length: 6 }, (_, index) => stableOffer(index + 1))
    let activeRequests = 0
    let maximumActiveRequests = 0
    provider.getProductDetail.mockImplementation(async ({ offerId }) => {
      activeRequests += 1
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests)
      await new Promise<void>((resolve) => setImmediate(resolve))
      activeRequests -= 1
      return {
        provider: {},
        normalized: stableDetail(String(offerId)),
        metadata: { requestId: `detail-${offerId}`, traceId: null },
      } as Awaited<ReturnType<Alibaba1688Service['getProductDetail']>>
    })

    await service.executePage(page)

    expect(provider.getProductDetail).toHaveBeenCalledTimes(6)
    expect(maximumActiveRequests).toBe(5)
    expect(offers.save).toHaveBeenCalledTimes(6)
    expect(offers.save).toHaveBeenLastCalledWith(expect.objectContaining({
      detailStatus: 'succeeded',
      title: 'Pet brush 6',
    }))
    expect(suppliers.save).toHaveBeenLastCalledWith(expect.objectContaining({
      companyName: 'Supplier offer-6',
    }))
  })

  it('skips the sixth detail request when the search response already has a supplier name', async () => {
    const { service, page, provider, normalized, offers, suppliers } = setup('keyword')
    normalized.offers = Array.from({ length: 6 }, (_, index) => stableOffer(index + 1))
    normalized.offers[5].seller.companyName = 'Search Supplier'
    normalized.offers[5].seller.openId = 'search-supplier-6'
    provider.getProductDetail.mockImplementation(async ({ offerId }) => ({
      provider: {},
      normalized: stableDetail(String(offerId)),
      metadata: { requestId: `detail-${offerId}`, traceId: null },
    }) as Awaited<ReturnType<Alibaba1688Service['getProductDetail']>>)

    await service.executePage(page)

    expect(provider.getProductDetail).toHaveBeenCalledTimes(5)
    expect(suppliers.save).toHaveBeenLastCalledWith(expect.objectContaining({
      companyName: 'Search Supplier',
    }))
    expect(offers.save).toHaveBeenLastCalledWith(expect.objectContaining({
      offerId: 'offer-6',
      title: 'Pet brush 6',
      detailStatus: 'not_requested',
      productFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
  })

  it('uses a recent supplier name cache for the sixth offer without requesting detail', async () => {
    const {
      service,
      page,
      provider,
      normalized,
      suppliers,
      supplierNameCache,
    } = setup('keyword')
    normalized.offers = Array.from({ length: 6 }, (_, index) => stableOffer(index + 1))
    supplierNameCache.findRecent.mockResolvedValue(new Map([[
      'offer:offer-6',
      { openId: 'cached-supplier-6', companyName: 'Cached Supplier', shopUrl: null },
    ]]))
    provider.getProductDetail.mockImplementation(async ({ offerId }) => ({
      provider: {},
      normalized: stableDetail(String(offerId)),
      metadata: { requestId: `detail-${offerId}`, traceId: null },
    }) as Awaited<ReturnType<Alibaba1688Service['getProductDetail']>>)

    await service.executePage(page)

    expect(provider.getProductDetail).toHaveBeenCalledTimes(5)
    expect(suppliers.save).toHaveBeenLastCalledWith(expect.objectContaining({
      openId: 'cached-supplier-6',
      companyName: 'Cached Supplier',
    }))
  })

  it('keeps the first-page total snapshot when a later page reports a different total', async () => {
    const { service, search, searches, normalized } = setup('keyword')
    search.totalRecords = '100'
    search.totalPages = 5
    normalized.totalRecords = 140
    normalized.totalPages = 7

    await service.executePage({
      id: 'page-2',
      searchId: 'search-1',
      workflowRunId: 'workflow-1',
      ownerUserId: 'owner-1',
      pageNumber: 2,
      pageSize: 20,
      attempts: 1,
      maxAttempts: 3,
      leaseOwner: 'worker-1',
    })

    expect(searches.save).toHaveBeenCalledWith(expect.objectContaining({
      totalRecords: '100',
      totalPages: 5,
    }))
  })

  it('persists the page when one supplier detail request fails', async () => {
    const { service, page, provider, normalized, offers, pages } = setup('keyword')
    normalized.offers = [stableOffer(1), stableOffer(2)]
    provider.getProductDetail
      .mockResolvedValueOnce({
        provider: {},
        normalized: stableDetail('offer-1'),
        metadata: { requestId: 'detail-1', traceId: null },
      } as Awaited<ReturnType<Alibaba1688Service['getProductDetail']>>)
      .mockRejectedValueOnce(new Error('detail unavailable'))

    await service.executePage(page)

    expect(offers.save).toHaveBeenCalledTimes(2)
    expect(offers.save).toHaveBeenNthCalledWith(1, expect.objectContaining({
      detailStatus: 'succeeded',
    }))
    expect(offers.save).toHaveBeenNthCalledWith(2, expect.objectContaining({
      detailStatus: 'failed',
    }))
    expect(pages.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'page-2' }),
      expect.objectContaining({ status: 'succeeded', resultCount: 2 }),
    )
  })

  it('deduplicates only identical products from the same supplier', async () => {
    const { service, page, provider, normalized, offers } = setup('keyword')
    normalized.offers = [stableOffer(1), stableOffer(2), stableOffer(3), stableOffer(4)]
    const details = new Map<string, Alibaba1688StableProductDetail>()
    for (const offerId of ['offer-1', 'offer-2', 'offer-3', 'offer-4']) {
      const detail = stableDetail(offerId)
      detail.title = offerId === 'offer-4' ? 'Different pet brush' : 'Identical pet brush'
      detail.translatedTitle = detail.title
      detail.imageUrls = ['https://cbu01.alicdn.com/identical-pet-brush.jpg']
      detail.seller.openId = offerId === 'offer-3' ? 'supplier-other' : 'supplier-same'
      detail.seller.companyName = offerId === 'offer-3' ? 'Other Supplier' : 'Same Supplier'
      details.set(offerId, detail)
    }
    provider.getProductDetail.mockImplementation(async ({ offerId }) => ({
      provider: {},
      normalized: details.get(String(offerId))!,
      metadata: { requestId: `detail-${offerId}`, traceId: null },
    }) as Awaited<ReturnType<Alibaba1688Service['getProductDetail']>>)

    await service.executePage(page)

    const savedOffers = offers.save.mock.calls.map(([offer]) => offer)
    expect(savedOffers).toHaveLength(3)
    expect(savedOffers.map((offer) => offer.offerId)).toEqual([
      'offer-1',
      'offer-3',
      'offer-4',
    ])
    expect(savedOffers.every((offer) => /^[a-f0-9]{64}$/.test(offer.productFingerprint!)))
      .toBe(true)
  })
})
