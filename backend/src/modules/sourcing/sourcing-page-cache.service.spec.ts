import type { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm'
import {
  SourcingOfferEntity,
  SourcingSearchEntity,
  SourcingSearchPageEntity,
  SourcingSupplierEntity,
} from './entities'
import { SourcingPageCacheService } from './sourcing-page-cache.service'

describe('SourcingPageCacheService', () => {
  const ownerUserId = '11111111-1111-4111-8111-111111111111'
  const workflowRunId = '22222222-2222-4222-8222-222222222222'

  function repository<T extends ObjectLiteral>() {
    return {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((value) => value),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (value) => value),
    } as unknown as jest.Mocked<Repository<T>>
  }

  function setup() {
    const searches = repository<SourcingSearchEntity>()
    const pages = repository<SourcingSearchPageEntity>()
    const offers = repository<SourcingOfferEntity>()
    const suppliers = repository<SourcingSupplierEntity>()
    const currentSearch = {
      id: 'current-search',
      ownerUserId,
      workflowRunId,
      provider: 'alibaba_1688',
      cacheFingerprint: 'a'.repeat(64),
      pageSize: 20,
      totalRecords: '40',
      totalPages: 2,
      loadedPageCount: 1,
      status: 'succeeded',
    } as SourcingSearchEntity
    const sourceSearch = {
      id: 'source-search',
      ownerUserId,
      workflowRunId: '33333333-3333-4333-8333-333333333333',
      provider: 'alibaba_1688',
      cacheFingerprint: currentSearch.cacheFingerprint,
      pageSize: 20,
    } as SourcingSearchEntity
    const sourcePage = {
      id: 'source-page-2',
      searchId: sourceSearch.id,
      ownerUserId,
      pageNumber: 2,
      pageSize: 20,
      status: 'succeeded',
      resultCount: 1,
      completedAt: new Date(Date.now() - 60 * 60 * 1000),
      search: sourceSearch,
    } as SourcingSearchPageEntity
    const sourceSupplier = {
      id: 'source-supplier',
      searchId: sourceSearch.id,
      ownerUserId,
      workflowRunId: sourceSearch.workflowRunId,
      provider: 'alibaba_1688',
      supplierKey: 'open:supplier-1',
      memberId: null,
      openId: 'supplier-1',
      companyName: 'Cached Supplier',
      shopName: 'Cached Supplier',
      shopUrl: null,
      supplierRating: '96.0000',
      yearsInBusiness: null,
      capabilities: { identities: ['verified'] },
    } as unknown as SourcingSupplierEntity
    const sourceOffer = {
      id: 'source-offer-row',
      searchId: sourceSearch.id,
      supplierId: sourceSupplier.id,
      ownerUserId,
      workflowRunId: sourceSearch.workflowRunId,
      provider: 'alibaba_1688',
      offerId: 'offer-21',
      productFingerprint: 'b'.repeat(64),
      offerUrl: 'https://detail.1688.com/offer/offer-21.html',
      imageUrl: 'https://cbu01.alicdn.com/offer-21.jpg',
      title: 'Cached pet brush',
      titleZh: 'Cached pet brush',
      titleEn: 'Cached pet brush',
      categoryId: 'pet-care',
      categoryName: 'Pet care',
      minimumOrderQuantity: '1.0000',
      quantityUnit: null,
      priceMin: '8.8000',
      priceMax: '8.8000',
      currency: 'CNY',
      priceTiers: [],
      salesVolume: '20',
      repurchaseRate: '25.0000',
      pageNumber: 2,
      rankInPage: 1,
      absoluteRank: 21,
      detailStatus: 'succeeded',
      detailRetrievedAt: new Date(Date.now() - 60 * 60 * 1000),
      scoreVersion: 'v1',
      scoreDimensions: { relevance: 90 },
      tags: ['verified'],
      sourcingScore: 88,
      sourcingScoreReasons: [],
      rawSnapshot: { provider: 'must-not-be-copied' },
      supplier: sourceSupplier,
    } as unknown as SourcingOfferEntity

    pages.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(sourcePage)
    offers.find
      .mockResolvedValueOnce([sourceOffer])
      .mockResolvedValueOnce([])
    suppliers.find.mockResolvedValue([])
    suppliers.save.mockImplementation(async (value) => {
      const values = Array.isArray(value) ? value : [value]
      return values.map((item, index) => ({ id: `target-supplier-${index + 1}`, ...item })) as never
    })
    offers.save.mockImplementation(async (value) => value as never)
    pages.save.mockImplementation(async (value) => ({ id: 'target-page-2', ...value }) as never)
    pages.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0)
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
    const service = new SourcingPageCacheService(pages, dataSource)
    return {
      service,
      currentSearch,
      sourceSearch,
      sourcePage,
      sourceSupplier,
      sourceOffer,
      searches,
      pages,
      offers,
      suppliers,
    }
  }

  it('copies a recent complete page into the current search without copying raw provider data', async () => {
    const { service, currentSearch, sourcePage, pages, offers, searches } = setup()

    const restored = await service.restore(ownerUserId, currentSearch, 2)

    expect(restored).toMatchObject({
      searchId: currentSearch.id,
      ownerUserId,
      pageNumber: 2,
      status: 'succeeded',
      resultCount: 1,
      cacheHit: true,
      cacheSourcePageId: sourcePage.id,
    })
    const savedOffers = offers.save.mock.calls[0][0] as unknown as SourcingOfferEntity[]
    expect(savedOffers).toHaveLength(1)
    expect(savedOffers[0]).toMatchObject({
      searchId: currentSearch.id,
      workflowRunId,
      offerId: 'offer-21',
      rawSnapshot: {
        cacheSourcePageId: sourcePage.id,
        cacheSourceOfferId: 'source-offer-row',
      },
    })
    expect(searches.save).toHaveBeenCalledWith(expect.objectContaining({
      id: currentSearch.id,
      loadedPageCount: 2,
      totalRecords: '40',
      totalPages: 2,
    }))
    expect(pages.findOne).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        ownerUserId,
        pageNumber: 2,
        pageSize: 20,
      }),
    }))
  })

  it.each([
    ['expired page', (value: ReturnType<typeof setup>) => {
      value.sourcePage.completedAt = new Date(Date.now() - 7 * 60 * 60 * 1000)
    }],
    ['other owner', (value: ReturnType<typeof setup>) => {
      value.sourcePage.ownerUserId = '99999999-9999-4999-8999-999999999999'
    }],
    ['different fingerprint', (value: ReturnType<typeof setup>) => {
      value.sourceSearch.cacheFingerprint = 'c'.repeat(64)
    }],
    ['different page size', (value: ReturnType<typeof setup>) => {
      value.sourcePage.pageSize = 50
    }],
    ['unfinished page', (value: ReturnType<typeof setup>) => {
      value.sourcePage.status = 'running'
    }],
  ])('rejects an ineligible cache source: %s', async (_name, mutate) => {
    const value = setup()
    mutate(value)

    await expect(value.service.restore(ownerUserId, value.currentSearch, 2))
      .resolves.toBeNull()
    expect(value.pages.save).not.toHaveBeenCalled()
    expect(value.offers.save).not.toHaveBeenCalled()
  })

  it('rejects a cached page when any displayed offer has no supplier name', async () => {
    const value = setup()
    value.sourceSupplier.companyName = null
    value.sourceSupplier.shopName = null

    await expect(value.service.restore(ownerUserId, value.currentSearch, 2))
      .resolves.toBeNull()
    expect(value.pages.save).not.toHaveBeenCalled()
  })

  it('skips duplicate offers and records the actual restored count', async () => {
    const value = setup()
    value.sourcePage.resultCount = 2
    value.offers.find.mockReset()
    value.offers.find
      .mockResolvedValueOnce([value.sourceOffer, {
        ...value.sourceOffer,
        id: 'source-offer-row-2',
        offerId: 'offer-22',
        productFingerprint: 'c'.repeat(64),
      } as SourcingOfferEntity])
      .mockResolvedValueOnce([{
        offerId: 'offer-21',
        productFingerprint: value.sourceOffer.productFingerprint,
      } as SourcingOfferEntity])

    const restored = await value.service.restore(ownerUserId, value.currentSearch, 2)

    const savedOffers = value.offers.save.mock.calls[0][0] as unknown as SourcingOfferEntity[]
    expect(savedOffers.map((offer) => offer.offerId)).toEqual(['offer-22'])
    expect(restored?.resultCount).toBe(1)
  })

  it('fills an existing target supplier whose cached name is blank', async () => {
    const value = setup()
    value.suppliers.find.mockResolvedValue([{
      ...value.sourceSupplier,
      id: 'target-existing-supplier',
      searchId: value.currentSearch.id,
      workflowRunId,
      companyName: null,
      shopName: null,
    } as SourcingSupplierEntity])

    await value.service.restore(ownerUserId, value.currentSearch, 2)

    const savedSuppliers = value.suppliers.save.mock.calls[0][0]
    expect(savedSuppliers).toEqual([
      expect.objectContaining({
        id: 'target-existing-supplier',
        companyName: 'Cached Supplier',
        shopName: 'Cached Supplier',
      }),
    ])
  })

  it('falls back to a live page when both cache reads fail', async () => {
    const value = setup()
    value.pages.findOne.mockReset().mockRejectedValue(new Error('cache database unavailable'))

    await expect(value.service.restore(ownerUserId, value.currentSearch, 2))
      .resolves.toBeNull()
  })
})
