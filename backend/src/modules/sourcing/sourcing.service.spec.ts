import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm'
import type { Alibaba1688Service } from '../alibaba1688'
import { WorkflowRunEntity } from '../autoflow/entities'
import {
  SourcingOfferEntity,
  SourcingSearchEntity,
  SourcingSearchPageEntity,
} from './entities'
import { SourcingService } from './sourcing.service'
import { ListSourcingDto } from './dto/list-sourcing.dto'
import type { SourcingPageCacheService } from './sourcing-page-cache.service'

describe('SourcingService asynchronous pagination', () => {
  const ownerUserId = 'd90f3d90-7f2b-45e7-9c8f-88fa0d915c8d'
  const otherOwnerUserId = '11111111-1111-4111-8111-111111111111'
  const workflowRunId = 'e1e830d6-8efe-4f04-a031-1afdfc88a902'
  const searchId = '22222222-2222-4222-8222-222222222222'

  function repository<T extends ObjectLiteral>() {
    return {
      create: jest.fn((value) => value),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (value) => value),
    } as unknown as jest.Mocked<Repository<T>>
  }

  function createService() {
    const workflows = repository<WorkflowRunEntity>()
    const searches = repository<SourcingSearchEntity>()
    const pages = repository<SourcingSearchPageEntity>()
    const offers = repository<SourcingOfferEntity>()
    const workflow = {
      id: workflowRunId,
      ownerUserId,
      name: 'Pet brush prospecting',
      seedType: 'keyword',
      seedValue: 'pet brush',
      targetMarket: 'United States',
    } as WorkflowRunEntity
    workflows.findOne.mockResolvedValue(workflow)
    const provider = {
      getReadiness: jest.fn().mockReturnValue({
        ready: true,
        enabled: true,
        missing: [],
        provider: 'alibaba_1688',
      }),
    } as unknown as jest.Mocked<Alibaba1688Service>
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === WorkflowRunEntity) return workflows
        if (entity === SourcingSearchEntity) return searches
        if (entity === SourcingSearchPageEntity) return pages
        return offers
      }),
    } as unknown as EntityManager
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    } as unknown as jest.Mocked<DataSource>
    const pageCache = {
      restore: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<SourcingPageCacheService>
    const service = new SourcingService(
      workflows,
      searches,
      pages,
      offers,
      provider,
      dataSource,
      pageCache,
    )
    return { service, workflows, searches, pages, offers, provider, workflow, pageCache }
  }

  it('creates a search and only queues its first page', async () => {
    const { service, searches, pages } = createService()
    searches.save.mockImplementation(async (value) => ({ id: searchId, ...value }) as SourcingSearchEntity)

    await expect(service.startSearch(ownerUserId, workflowRunId, { pageSize: 20 }))
      .resolves.toEqual({ searchId, status: 'pending', page: 1, pageSize: 20 })
    expect(pages.save).toHaveBeenCalledTimes(1)
    expect(pages.save).toHaveBeenCalledWith(expect.objectContaining({
      searchId,
      ownerUserId,
      pageNumber: 1,
      pageSize: 20,
      status: 'pending',
    }))
    expect(searches.save).toHaveBeenCalledWith(expect.objectContaining({
      searchMode: 'keyword',
      keyword: 'pet brush',
      imageUrl: null,
      queryFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      cacheFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      requestPayload: expect.objectContaining({
        workflowName: 'Pet brush prospecting',
        targetMarket: 'United States',
        forceRefresh: false,
      }),
    }))
  })

  it('maps an image workflow URL to image sourcing and keeps its workflow context', async () => {
    const { service, searches, workflow } = createService()
    Object.assign(workflow, {
      name: 'Pet brush image sourcing',
      seedType: 'image',
      seedValue: 'https://cdn.example.com/pet-brush.png',
      targetMarket: 'Canada',
    })
    searches.save.mockImplementation(async (value) => ({ id: searchId, ...value }) as SourcingSearchEntity)

    await service.startSearch(ownerUserId, workflowRunId, { pageSize: 20 })

    expect(searches.save).toHaveBeenCalledWith(expect.objectContaining({
      searchMode: 'image',
      keyword: null,
      imageUrl: 'https://cdn.example.com/pet-brush.png',
      requestPayload: expect.objectContaining({
        workflowName: 'Pet brush image sourcing',
        targetMarket: 'Canada',
      }),
    }))
  })

  it('reuses a matching successful search unless force is true', async () => {
    const { service, searches, pages } = createService()
    searches.findOne.mockResolvedValue({
      id: searchId,
      status: 'succeeded',
      pageSize: 20,
    } as SourcingSearchEntity)

    await expect(service.startSearch(ownerUserId, workflowRunId, { pageSize: 20 }))
      .resolves.toEqual({ searchId, status: 'succeeded', page: 1, pageSize: 20 })
    expect(searches.save).not.toHaveBeenCalled()
    expect(pages.save).not.toHaveBeenCalled()

    searches.save.mockImplementation(async (value) => ({ id: 'new-search', ...value }) as SourcingSearchEntity)
    await expect(service.startSearch(ownerUserId, workflowRunId, { pageSize: 20, force: true }))
      .resolves.toMatchObject({ searchId: 'new-search', status: 'pending' })
    expect(searches.save).toHaveBeenLastCalledWith(expect.objectContaining({
      requestPayload: expect.objectContaining({ forceRefresh: true }),
    }))
  })

  it('shares the cache fingerprint across workflows without changing request idempotency', async () => {
    const { service, searches, workflow } = createService()
    searches.save.mockImplementation(async (value) => ({
      id: `search-${searches.save.mock.calls.length}`,
      ...value,
    }) as SourcingSearchEntity)

    await service.startSearch(ownerUserId, workflowRunId, { pageSize: 20, force: true })
    const first = searches.save.mock.calls[0][0]
    workflow.id = '77777777-7777-4777-8777-777777777777'
    await service.startSearch(ownerUserId, workflow.id, { pageSize: 20, force: true })
    const second = searches.save.mock.calls[1][0]

    expect(first.queryFingerprint).not.toBe(second.queryFingerprint)
    expect(first.cacheFingerprint).toBe(second.cacheFingerprint)
  })

  it('rejects page access outside owner and workflow scope', async () => {
    const { service, searches } = createService()
    searches.findOne.mockResolvedValue(null)

    await expect(service.requestPage(otherOwnerUserId, workflowRunId, searchId, 2))
      .rejects.toBeInstanceOf(NotFoundException)
  })

  it('requires known pagination bounds and keeps duplicate page requests idempotent', async () => {
    const { service, searches, pages } = createService()
    searches.findOne.mockResolvedValue({
      id: searchId,
      ownerUserId,
      workflowRunId,
      pageSize: 20,
      totalPages: null,
    } as SourcingSearchEntity)

    await expect(service.requestPage(ownerUserId, workflowRunId, searchId, 2))
      .rejects.toBeInstanceOf(BadRequestException)

    searches.findOne.mockResolvedValue({
      id: searchId,
      ownerUserId,
      workflowRunId,
      pageSize: 20,
      totalPages: 3,
    } as SourcingSearchEntity)
    pages.findOne.mockResolvedValue({
      searchId,
      pageNumber: 2,
      pageSize: 20,
      status: 'pending',
    } as SourcingSearchPageEntity)
    await expect(service.requestPage(ownerUserId, workflowRunId, searchId, 2))
      .resolves.toMatchObject({ searchId, page: 2, status: 'pending' })
    expect(pages.save).not.toHaveBeenCalled()
  })

  it('returns a restored cache page without queuing a worker page', async () => {
    const { service, searches, pages, pageCache } = createService()
    const search = {
      id: searchId,
      ownerUserId,
      workflowRunId,
      provider: 'alibaba_1688',
      cacheFingerprint: 'a'.repeat(64),
      pageSize: 20,
      totalPages: 3,
    } as SourcingSearchEntity
    searches.findOne.mockResolvedValue(search)
    pages.findOne.mockResolvedValue(null)
    pageCache.restore.mockResolvedValue({
      id: 'cached-page-2',
      searchId,
      ownerUserId,
      pageNumber: 2,
      pageSize: 20,
      status: 'succeeded',
    } as SourcingSearchPageEntity)

    await expect(service.requestPage(ownerUserId, workflowRunId, searchId, 2))
      .resolves.toEqual({ searchId, status: 'succeeded', page: 2, pageSize: 20 })
    expect(pages.save).not.toHaveBeenCalled()
  })

  it('queues an uncached page after the cache service misses', async () => {
    const { service, searches, pages, pageCache } = createService()
    searches.findOne.mockResolvedValue({
      id: searchId,
      ownerUserId,
      workflowRunId,
      provider: 'alibaba_1688',
      cacheFingerprint: 'a'.repeat(64),
      pageSize: 20,
      totalPages: 3,
    } as SourcingSearchEntity)
    pages.findOne.mockResolvedValue(null)
    pages.save.mockImplementation(async (value) => value as SourcingSearchPageEntity)

    await expect(service.requestPage(ownerUserId, workflowRunId, searchId, 2))
      .resolves.toEqual({ searchId, status: 'pending', page: 2, pageSize: 20 })
    expect(pageCache.restore).toHaveBeenCalledTimes(1)
    expect(pages.save).toHaveBeenCalledWith(expect.objectContaining({
      searchId,
      pageNumber: 2,
      status: 'pending',
    }))
  })

  it('returns a page created by a concurrent request instead of failing', async () => {
    const { service, searches, pages } = createService()
    searches.findOne.mockResolvedValue({
      id: searchId,
      ownerUserId,
      workflowRunId,
      provider: 'alibaba_1688',
      cacheFingerprint: 'a'.repeat(64),
      pageSize: 20,
      totalPages: 3,
    } as SourcingSearchEntity)
    pages.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        searchId,
        ownerUserId,
        pageNumber: 2,
        pageSize: 20,
        status: 'succeeded',
      } as SourcingSearchPageEntity)
    pages.save.mockRejectedValue(Object.assign(new Error('duplicate page'), { code: '23505' }))

    await expect(service.requestPage(ownerUserId, workflowRunId, searchId, 2))
      .resolves.toEqual({ searchId, status: 'succeeded', page: 2, pageSize: 20 })
  })

  it('reads only the requested persisted page with explicit tenant filters', async () => {
    const { service, searches, pages, offers } = createService()
    const search = {
      id: searchId,
      ownerUserId,
      workflowRunId,
      searchMode: 'keyword',
      status: 'succeeded',
      pageSize: 20,
      totalRecords: '25',
      totalPages: 2,
      loadedPageCount: 1,
      keyword: 'pet brush',
      imageUrl: null,
      errorCode: null,
      errorMessage: null,
      requestedAt: new Date('2026-08-04T00:00:00.000Z'),
      startedAt: null,
      completedAt: null,
    } as SourcingSearchEntity
    searches.findOne.mockResolvedValue(search)
    pages.findOne.mockResolvedValue({
      searchId,
      ownerUserId,
      pageNumber: 1,
      pageSize: 20,
      status: 'succeeded',
      resultCount: 1,
      errorCode: null,
      errorMessage: null,
    } as SourcingSearchPageEntity)
    offers.find.mockResolvedValue([])

    const result = await service.getSummary(ownerUserId, workflowRunId, {
      searchId,
      page: 1,
      pageSize: 20,
    })

    expect(result.pagination).toMatchObject({
      page: 1,
      pageSize: 20,
      totalRecords: 25,
      totalPages: 2,
      loaded: true,
      status: 'succeeded',
    })
    expect(result.workflowInput).toEqual({
      name: 'Pet brush prospecting',
      seedType: 'keyword',
      seedValue: 'pet brush',
      targetMarket: 'United States',
    })
    expect(offers.find).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerUserId, workflowRunId, searchId, pageNumber: 1 },
      order: { rankInPage: 'ASC' },
    }))
  })

  it('uses the persisted page size when the summary request does not specify one', async () => {
    const { service, searches, pages, offers } = createService()
    searches.findOne.mockResolvedValue({
      id: searchId,
      ownerUserId,
      workflowRunId,
      searchMode: 'keyword',
      status: 'succeeded',
      pageSize: 10,
      totalRecords: '574',
      totalPages: 58,
      loadedPageCount: 1,
      keyword: 'pet brush',
      imageUrl: null,
      errorCode: null,
      errorMessage: null,
      requestedAt: new Date('2026-08-04T00:00:00.000Z'),
      startedAt: null,
      completedAt: null,
    } as SourcingSearchEntity)
    pages.findOne.mockResolvedValue({
      searchId,
      ownerUserId,
      pageNumber: 1,
      pageSize: 10,
      status: 'succeeded',
      resultCount: 10,
      errorCode: null,
      errorMessage: null,
    } as SourcingSearchPageEntity)
    offers.find.mockResolvedValue([])

    const result = await service.getSummary(ownerUserId, workflowRunId, {
      searchId,
      page: 1,
    } as ListSourcingDto)

    expect(result.pagination.pageSize).toBe(10)
    expect(result.pagination.totalRecords).toBe(574)
  })

  it('returns workflow matching input before the first sourcing task exists', async () => {
    const { service } = createService()

    const result = await service.getSummary(ownerUserId, workflowRunId)

    expect(result.status).toBe('idle')
    expect(result.search).toBeNull()
    expect(result.workflowInput).toEqual({
      name: 'Pet brush prospecting',
      seedType: 'keyword',
      seedValue: 'pet brush',
      targetMarket: 'United States',
    })
  })
})
