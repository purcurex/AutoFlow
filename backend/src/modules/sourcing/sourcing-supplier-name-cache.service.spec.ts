import type { ObjectLiteral, Repository } from 'typeorm'
import type { Alibaba1688StableOffer } from '../alibaba1688'
import { SourcingOfferEntity, SourcingSupplierEntity } from './entities'
import { SourcingSupplierNameCacheService } from './sourcing-supplier-name-cache.service'

describe('SourcingSupplierNameCacheService', () => {
  const ownerUserId = '11111111-1111-4111-8111-111111111111'

  function repository<T extends ObjectLiteral>() {
    return {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<Repository<T>>
  }

  function stableOffer(index: number, openId: string | null = null): Alibaba1688StableOffer {
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
        openId,
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

  it('returns recent tenant-owned names by both offer and supplier identity', async () => {
    const offers = repository<SourcingOfferEntity>()
    const suppliers = repository<SourcingSupplierEntity>()
    const historicalSupplier = {
      ownerUserId,
      provider: 'alibaba_1688',
      openId: 'supplier-6',
      companyName: 'Cached Supplier',
      shopName: 'Cached Supplier',
      shopUrl: null,
      updatedAt: new Date(Date.now() - 60 * 60 * 1000),
    } as SourcingSupplierEntity
    offers.find.mockResolvedValue([{
      ownerUserId,
      provider: 'alibaba_1688',
      offerId: 'offer-6',
      retrievedAt: new Date(Date.now() - 60 * 60 * 1000),
      supplier: historicalSupplier,
    } as SourcingOfferEntity])
    suppliers.find.mockResolvedValue([historicalSupplier])
    const cache = new SourcingSupplierNameCacheService(offers, suppliers)

    const result = await cache.findRecent(ownerUserId, [stableOffer(6, 'supplier-6')])

    expect(result.get('offer:offer-6')).toEqual({
      openId: 'supplier-6',
      companyName: 'Cached Supplier',
      shopUrl: null,
    })
    expect(result.get('open:supplier-6')).toEqual(result.get('offer:offer-6'))
    expect(offers.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId }),
      relations: { supplier: true },
    }))
    expect(suppliers.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId }),
    }))
  })

  it('ignores expired, cross-tenant, and blank supplier records returned by storage', async () => {
    const offers = repository<SourcingOfferEntity>()
    const suppliers = repository<SourcingSupplierEntity>()
    offers.find.mockResolvedValue([
      {
        ownerUserId,
        provider: 'alibaba_1688',
        offerId: 'offer-1',
        retrievedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        supplier: {
          ownerUserId,
          companyName: 'Expired Supplier',
          shopName: null,
          openId: null,
        },
      } as SourcingOfferEntity,
      {
        ownerUserId: '99999999-9999-4999-8999-999999999999',
        provider: 'alibaba_1688',
        offerId: 'offer-2',
        retrievedAt: new Date(),
        supplier: {
          ownerUserId: '99999999-9999-4999-8999-999999999999',
          companyName: 'Other Tenant',
          shopName: null,
          openId: null,
        },
      } as SourcingOfferEntity,
      {
        ownerUserId,
        provider: 'alibaba_1688',
        offerId: 'offer-3',
        retrievedAt: new Date(),
        supplier: {
          ownerUserId,
          companyName: '   ',
          shopName: null,
          openId: null,
        },
      } as SourcingOfferEntity,
    ])
    const cache = new SourcingSupplierNameCacheService(offers, suppliers)

    const result = await cache.findRecent(ownerUserId, [
      stableOffer(1), stableOffer(2), stableOffer(3),
    ])

    expect(result.size).toBe(0)
  })

  it('falls back to an empty cache when the history query fails', async () => {
    const offers = repository<SourcingOfferEntity>()
    const suppliers = repository<SourcingSupplierEntity>()
    offers.find.mockRejectedValue(new Error('database unavailable'))
    const cache = new SourcingSupplierNameCacheService(offers, suppliers)

    await expect(cache.findRecent(ownerUserId, [stableOffer(1)]))
      .resolves.toEqual(new Map())
  })
})
