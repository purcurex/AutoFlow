import type { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm'
import type { Alibaba1688Service } from '../alibaba1688'
import { WorkflowRunEntity } from '../autoflow/entities'
import {
  SourcingOfferEntity,
  SourcingSearchEntity,
  SourcingSearchPageEntity,
  SourcingSupplierEntity,
} from './entities'
import type { SourcingImageResolverService } from './sourcing-image-resolver.service'
import {
  SourcingPageExecutorService,
  type ClaimedSourcingPage,
} from './sourcing-page-executor.service'

describe('SourcingPageExecutorService', () => {
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
    const normalized = {
      provider: 'alibaba_1688',
      sourceTag: '1688货源',
      searchMode,
      page: 2,
      pageSize: 20,
      totalRecords: 21,
      totalPages: 2,
      offers: [],
      affectsContactConfidence: false,
    } as const
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
    const service = new SourcingPageExecutorService(
      searches,
      workflows,
      provider,
      imageResolver,
      dataSource,
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
    return { service, page, provider, imageResolver, searches, pages, search }
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
})
