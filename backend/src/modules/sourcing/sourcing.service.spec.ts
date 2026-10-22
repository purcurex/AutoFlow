jest.mock('../users/business-data-access', () => ({ readBusinessOwners: jest.fn(async (_dataSource, id) => ({ ids: [id], filter: id })) }))
import { BadRequestException } from '@nestjs/common'
import type { DataSource, Repository } from 'typeorm'
import type { Alibaba1688Service } from '../alibaba1688'
import type { WorkflowRunEntity } from '../autoflow/entities'
import {
  SourcingOfferEntity,
  SourcingSearchEntity,
  SourcingSupplierEntity,
} from './entities'
import { SourcingService } from './sourcing.service'

describe('SourcingService', () => {
  const ownerUserId = 'd90f3d90-7f2b-45e7-9c8f-88fa0d915c8d'
  const workflowRunId = 'e1e830d6-8efe-4f04-a031-1afdfc88a902'

  function createService() {
    const workflowRepository = {
      findOne: jest.fn().mockResolvedValue({ id: workflowRunId, ownerUserId }),
    }
    const searchRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    }
    const offerRepository = {
      find: jest.fn().mockResolvedValue([]),
    }
    const alibaba1688Service = {
      getReadiness: jest.fn().mockReturnValue({
        ready: false,
        enabled: false,
        missing: ['ALIBABA_1688_ENABLED'],
        provider: 'alibaba_1688',
      }),
    }
    const dataSource = {
      transaction: jest.fn(),
    }
    const service = new SourcingService(
      workflowRepository as unknown as Repository<WorkflowRunEntity>,
      searchRepository as unknown as Repository<SourcingSearchEntity>,
      offerRepository as unknown as Repository<SourcingOfferEntity>,
      alibaba1688Service as unknown as Alibaba1688Service,
      dataSource as unknown as DataSource,
    )
    return {
      service,
      workflowRepository,
      searchRepository,
      offerRepository,
      alibaba1688Service,
      dataSource,
    }
  }

  it('returns an explicit unconfigured state without fabricating offers', async () => {
    const { service, workflowRepository, offerRepository } = createService()

    await expect(service.getSummary(ownerUserId, workflowRunId)).resolves.toEqual({
      workflowId: workflowRunId,
      provider: 'alibaba_1688',
      providerConfigured: false,
      status: 'not_configured',
      latestSearch: null,
      offers: [],
    })
    expect(workflowRepository.findOne).toHaveBeenCalledWith({
      where: { id: workflowRunId, ownerUserId },
    })
    expect(offerRepository.find).not.toHaveBeenCalled()
  })

  it('maps persisted procurement evidence without customer score fields', async () => {
    const {
      service,
      searchRepository,
      offerRepository,
      alibaba1688Service,
    } = createService()
    alibaba1688Service.getReadiness.mockReturnValue({
      ready: true,
      enabled: true,
      missing: [],
      provider: 'alibaba_1688',
    })
    searchRepository.findOne.mockResolvedValue({
      id: 'search-1',
      ownerUserId,
      workflowRunId,
      status: 'succeeded',
      searchMode: 'keyword',
      keyword: 'pet brush',
      imageUrl: null,
      errorCode: null,
      errorMessage: null,
      startedAt: new Date('2026-07-23T01:00:00.000Z'),
      completedAt: new Date('2026-07-23T01:00:05.000Z'),
    })
    offerRepository.find.mockResolvedValue([
      {
        id: 'offer-row-1',
        offerId: '16880001',
        sourcingScore: 88,
        imageUrl: 'https://example.test/offer.jpg',
        title: 'Pet Brush',
        titleZh: '宠物梳',
        titleEn: 'Pet Brush',
        offerUrl: 'https://detail.1688.com/offer/16880001.html',
        currency: 'CNY',
        priceMin: '3.20',
        priceMax: '4.80',
        minimumOrderQuantity: '2',
        quantityUnit: null,
        salesVolume: '500',
        repurchaseRate: 32,
        sourcingScoreReasons: [
          { code: 'high_product_relevance', label: 'High product relevance', score: 35 },
        ],
        tags: ['verified'],
        supplier: {
          companyName: 'Example Supplier',
          shopName: 'Example Shop',
          shopUrl: 'https://example.1688.com',
          supplierRating: 90,
          capabilities: { identities: ['verified'] },
        } as unknown as SourcingSupplierEntity,
      },
    ])

    const summary = await service.getSummary(ownerUserId, workflowRunId)

    expect(summary.status).toBe('completed')
    expect(summary.offers[0]).toMatchObject({
      providerOfferId: '16880001',
      sourcingScore: 88,
      recommendationReasons: ['High product relevance'],
    })
    expect(summary.offers[0]).not.toHaveProperty('contactScore')
    expect(summary.offers[0]).not.toHaveProperty('totalScore')
  })

  it('rejects an inverted price range before using provider traffic', async () => {
    const { service, alibaba1688Service } = createService()

    await expect(
      service.startSearch(ownerUserId, workflowRunId, { priceMin: 20, priceMax: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(alibaba1688Service.getReadiness).not.toHaveBeenCalled()
  })

  it('keeps automatic workflow discovery alive when sourcing raises an error', async () => {
    const { service } = createService()
    jest.spyOn(service, 'startSearch').mockRejectedValue(new Error('provider timeout'))

    await expect(service.runForWorkflow(ownerUserId, workflowRunId)).resolves.toBeUndefined()
  })
})
