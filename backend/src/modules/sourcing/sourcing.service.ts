import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash, randomUUID } from 'crypto'
import { DataSource, In, Repository } from 'typeorm'
import { Alibaba1688Service } from '../alibaba1688'
import { WorkflowRunEntity } from '../autoflow/entities'
import { ListSourcingDto } from './dto/list-sourcing.dto'
import { StartSourcingDto } from './dto/start-sourcing.dto'
import {
  SourcingOfferEntity,
  SourcingSearchEntity,
  SourcingSearchPageEntity,
} from './entities'
import { decimalCompare } from './sourcing-decimal'
import type {
  SourcingOfferResponse,
  SourcingPageRequestResponse,
  SourcingSearchResponse,
  SourcingStartResponse,
  SourcingSummaryResponse,
  SourcingWindowResponse,
} from './sourcing-response.types'
import { SOURCING_PROVIDER } from './sourcing.types'
import { SourcingPageCacheService } from './sourcing-page-cache.service'

export const SOURCING_RESULT_WINDOW_STEP = 100

interface SourcingResultWindow {
  totalRecords: number | null
  totalPages: number | null
  providerTotalRecords: number | null
  resultLimit: number
  canExpand: boolean
}

/**
 * 寻源命令与查询服务。
 * HTTP请求只创建/读取数据库分页任务，任何1688网络调用均由分页Worker在请求生命周期外执行。
 */
@Injectable()
export class SourcingService {
  private readonly logger = new Logger(SourcingService.name)

  constructor(
    @InjectRepository(WorkflowRunEntity)
    private readonly workflowRepository: Repository<WorkflowRunEntity>,
    @InjectRepository(SourcingSearchEntity)
    private readonly searchRepository: Repository<SourcingSearchEntity>,
    @InjectRepository(SourcingSearchPageEntity)
    private readonly pageRepository: Repository<SourcingSearchPageEntity>,
    @InjectRepository(SourcingOfferEntity)
    private readonly offerRepository: Repository<SourcingOfferEntity>,
    private readonly alibaba1688Service: Alibaba1688Service,
    private readonly dataSource: DataSource,
    private readonly pageCache: SourcingPageCacheService,
  ) {}

  async getSummary(
    ownerUserId: string,
    workflowRunId: string,
    query: ListSourcingDto = new ListSourcingDto(),
  ): Promise<SourcingSummaryResponse> {
    const workflow = await this.requireWorkflow(ownerUserId, workflowRunId)
    const workflowInput = this.mapWorkflowInput(workflow)
    const readiness = this.alibaba1688Service.getReadiness()
    const pageNumber = query.page || 1
    const requestedPageSize = query.pageSize
    const search = await this.searchRepository.findOne({
      where: query.searchId
        ? { id: query.searchId, ownerUserId, workflowRunId }
        : { ownerUserId, workflowRunId },
      order: { createdAt: 'DESC' },
    })
    if (query.searchId && !search) throw new NotFoundException('Sourcing search not found')

    if (!search) {
      return {
        workflowId: workflowRunId,
        workflowInput,
        provider: SOURCING_PROVIDER,
        providerConfigured: readiness.ready,
        status: readiness.ready ? 'idle' : 'not_configured',
        search: null,
        latestSearch: null,
        pagination: {
          page: pageNumber,
          pageSize: (requestedPageSize || 20) as 10 | 20 | 50,
          totalRecords: null,
          totalPages: null,
          providerTotalRecords: null,
          resultLimit: SOURCING_RESULT_WINDOW_STEP,
          canExpand: false,
          resultCount: 0,
          loaded: false,
          status: 'pending',
          errorCode: null,
          errorMessage: null,
        },
        items: [],
        offers: [],
      }
    }

    if (requestedPageSize !== undefined && requestedPageSize !== search.pageSize) {
      throw new BadRequestException('pageSize must match the sourcing search page size')
    }
    const resultWindow = this.resultWindow(search)
    if (resultWindow.totalPages !== null && pageNumber > resultWindow.totalPages) {
      throw new BadRequestException('Requested sourcing page exceeds total pages')
    }

    const page = await this.pageRepository.findOne({
      where: { ownerUserId, searchId: search.id, pageNumber },
    })
    const offerEntities = page?.status === 'succeeded'
      ? await this.offerRepository.find({
          where: { ownerUserId, workflowRunId, searchId: search.id, pageNumber },
          relations: { supplier: true },
          order: { rankInPage: 'ASC' },
        })
      : []
    const items = offerEntities.map((offer) => this.mapOffer(offer))
    const searchResponse = this.mapSearch(search, page)

    return {
      workflowId: workflowRunId,
      workflowInput,
      provider: SOURCING_PROVIDER,
      providerConfigured: readiness.ready,
      status: this.apiStatus(search.status),
      search: searchResponse,
      latestSearch: searchResponse,
      pagination: {
        page: pageNumber,
        pageSize: search.pageSize as 10 | 20 | 50,
        ...resultWindow,
        resultCount: page?.resultCount || 0,
        loaded: page?.status === 'succeeded',
        status: page?.status || 'pending',
        errorCode: page?.errorCode || null,
        errorMessage: page?.errorMessage || null,
      },
      items,
      offers: items,
    }
  }

  async startSearch(
    ownerUserId: string,
    workflowRunId: string,
    options: StartSourcingDto = {},
  ): Promise<SourcingStartResponse> {
    if (
      options.priceMin !== undefined
      && options.priceMax !== undefined
      && decimalCompare(options.priceMin, options.priceMax) === 1
    ) {
      throw new BadRequestException('priceMin cannot be greater than priceMax')
    }
    const readiness = this.alibaba1688Service.getReadiness()
    if (!readiness.ready) {
      await this.requireWorkflow(ownerUserId, workflowRunId)
      throw new ServiceUnavailableException({
        code: 'NOT_CONFIGURED',
        message: `Alibaba 1688 is not configured: ${readiness.missing.join(', ')}`,
      })
    }

    return this.dataSource.transaction(async (manager) => {
      const workflowRepository = manager.getRepository(WorkflowRunEntity)
      const searchRepository = manager.getRepository(SourcingSearchEntity)
      const pageRepository = manager.getRepository(SourcingSearchPageEntity)
      const workflow = await workflowRepository.findOne({
        where: { id: workflowRunId, ownerUserId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!workflow) throw new NotFoundException('Workflow not found')

      const pageSize = (options.pageSize || 20) as 10 | 20 | 50
      const languageCode = 'en'
      const queryFingerprint = this.queryFingerprint(ownerUserId, workflow, {
        ...options,
        pageSize,
      }, languageCode)
      const cacheFingerprint = this.buildCacheFingerprint(ownerUserId, workflow, {
        ...options,
        pageSize,
      }, languageCode)
      if (!options.force) {
        const existing = await searchRepository.findOne({
          where: {
            ownerUserId,
            workflowRunId,
            queryFingerprint,
            status: In(['pending', 'running', 'succeeded', 'partial']),
          },
          order: { createdAt: 'DESC' },
        })
        if (existing) {
          return {
            searchId: existing.id,
            status: existing.status as 'pending' | 'running' | 'succeeded' | 'partial',
            page: 1,
            pageSize: existing.pageSize as 10 | 20 | 50,
          }
        }
      }

      const search = await searchRepository.save(searchRepository.create({
        ownerUserId,
        workflowRunId,
        provider: SOURCING_PROVIDER,
        searchMode: workflow.seedType,
        status: 'pending',
        requestId: randomUUID(),
        providerRequestId: null,
        providerMethod: workflow.seedType === 'keyword'
          ? 'product.search.keywordQuery'
          : 'product.search.imageQuery',
        keyword: workflow.seedType === 'keyword' ? workflow.seedValue.trim() : null,
        imageUrl: workflow.seedType === 'image' ? workflow.seedValue.trim() : null,
        languageCode,
        imageId: null,
        imageUploadRequestId: null,
        imageUploadTraceId: null,
        totalRecords: null,
        totalPages: null,
        pageSize,
        resultLimit: SOURCING_RESULT_WINDOW_STEP,
        loadedPageCount: 0,
        queryFingerprint,
        cacheFingerprint,
        requestPayload: {
          // 业务上下文仅用于审计和前端回显；1688检索分支严格由seedType/seedValue决定。
          workflowName: workflow.name,
          targetMarket: workflow.targetMarket,
          pageSize,
          priceMin: options.priceMin || null,
          priceMax: options.priceMax || null,
          languageCode,
          forceRefresh: options.force === true,
        },
        errorCode: null,
        errorMessage: null,
        requestedAt: new Date(),
        startedAt: null,
        completedAt: null,
      }))
      await pageRepository.save(pageRepository.create({
        searchId: search.id,
        ownerUserId,
        pageNumber: 1,
        pageSize,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        availableAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        providerRequestId: null,
        providerTraceId: null,
        resultCount: 0,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
      }))
      return { searchId: search.id, status: 'pending', page: 1, pageSize }
    })
  }

  async requestPage(
    ownerUserId: string,
    workflowRunId: string,
    searchId: string,
    pageNumber: number,
  ): Promise<SourcingPageRequestResponse> {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new BadRequestException('Sourcing page must be a positive integer')
    }
    const search = await this.searchRepository.findOne({
      where: { id: searchId, ownerUserId, workflowRunId },
    })
    if (!search) throw new NotFoundException('Sourcing search not found')
    if (search.totalPages === null && pageNumber > 1) {
      throw new BadRequestException('Load the first sourcing page before requesting later pages')
    }
    const resultWindow = this.resultWindow(search)
    if (resultWindow.totalPages !== null && pageNumber > resultWindow.totalPages) {
      throw new BadRequestException('Requested sourcing page exceeds total pages')
    }

    const existing = await this.pageRepository.findOne({
      where: { ownerUserId, searchId, pageNumber },
    })
    if (existing) {
      if (existing.status === 'failed') {
        existing.status = 'pending'
        existing.attempts = 0
        existing.availableAt = new Date()
        existing.leaseOwner = null
        existing.leaseExpiresAt = null
        existing.heartbeatAt = null
        existing.errorCode = null
        existing.errorMessage = null
        existing.startedAt = null
        existing.completedAt = null
        await this.pageRepository.save(existing)
      }
      return {
        searchId,
        status: existing.status as 'pending' | 'running' | 'succeeded',
        page: pageNumber,
        pageSize: search.pageSize as 10 | 20 | 50,
      }
    }

    const cachedPage = await this.pageCache.restore(ownerUserId, search, pageNumber)
    if (cachedPage) {
      return {
        searchId,
        status: cachedPage.status as 'pending' | 'running' | 'succeeded',
        page: pageNumber,
        pageSize: search.pageSize as 10 | 20 | 50,
      }
    }

    let created: SourcingSearchPageEntity
    try {
      created = await this.pageRepository.save(this.pageRepository.create({
        searchId,
        ownerUserId,
        pageNumber,
        pageSize: search.pageSize,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        availableAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        providerRequestId: null,
        providerTraceId: null,
        resultCount: 0,
        cacheHit: false,
        cacheSourcePageId: null,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
      }))
    } catch (error) {
      // 唯一约束竞争发生时返回并发请求已经创建的分页；没有目标页则保留原异常。
      const racedPage = await this.pageRepository.findOne({
        where: { ownerUserId, searchId, pageNumber },
      })
      if (!racedPage) throw error
      created = racedPage
    }
    return {
      searchId,
      status: created.status as 'pending' | 'running' | 'succeeded',
      page: pageNumber,
      pageSize: search.pageSize as 10 | 20 | 50,
    }
  }

  async runForWorkflow(ownerUserId: string, workflowRunId: string): Promise<void> {
    try {
      await this.startSearch(ownerUserId, workflowRunId)
    } catch (error) {
      this.logger.warn(
        `1688 sourcing sidecar skipped workflow=${workflowRunId} reason=${
          error instanceof Error ? error.message : 'unknown'
        }`,
      )
    }
  }

  /**
   * 返回创建工作流时的原始匹配字段，让前端明确展示本次1688查询依据。
   */
  private mapWorkflowInput(workflow: WorkflowRunEntity) {
    return {
      name: workflow.name,
      seedType: workflow.seedType,
      seedValue: workflow.seedValue,
      targetMarket: workflow.targetMarket,
    }
  }

  private queryFingerprint(
    ownerUserId: string,
    workflow: WorkflowRunEntity,
    options: StartSourcingDto,
    languageCode: string,
  ): string {
    return createHash('sha256').update(JSON.stringify({
      ownerUserId,
      workflowRunId: workflow.id,
      searchMode: workflow.seedType,
      seed: workflow.seedValue.trim().toLocaleLowerCase(),
      languageCode,
      pageSize: options.pageSize || 20,
      priceMin: options.priceMin || null,
      priceMax: options.priceMax || null,
    })).digest('hex')
  }

  /**
   * 生成跨工作流可复用的短期缓存指纹；不包含工作流ID，但始终包含用户ID，禁止跨租户复用。
   */
  private buildCacheFingerprint(
    ownerUserId: string,
    workflow: WorkflowRunEntity,
    options: StartSourcingDto,
    languageCode: string,
  ): string {
    return createHash('sha256').update(JSON.stringify({
      ownerUserId,
      provider: SOURCING_PROVIDER,
      searchMode: workflow.seedType,
      seed: workflow.seedValue.trim().toLocaleLowerCase(),
      targetMarket: workflow.targetMarket,
      languageCode,
      pageSize: options.pageSize || 20,
      priceMin: options.priceMin || null,
      priceMax: options.priceMax || null,
    })).digest('hex')
  }

  private async requireWorkflow(
    ownerUserId: string,
    workflowRunId: string,
  ): Promise<WorkflowRunEntity> {
    const workflow = await this.workflowRepository.findOne({
      where: { id: workflowRunId, ownerUserId },
    })
    if (!workflow) throw new NotFoundException('Workflow not found')
    return workflow
  }

  private mapSearch(
    search: SourcingSearchEntity,
    page: SourcingSearchPageEntity | null,
  ): SourcingSearchResponse {
    return {
      id: search.id,
      status: this.apiStatus(search.status),
      searchMode: search.searchMode,
      query: search.keyword ?? search.imageUrl,
      failureCode: page?.errorCode || search.errorCode,
      failureMessage: page?.errorMessage || search.errorMessage,
      requestedAt: search.requestedAt.toISOString(),
      startedAt: search.startedAt?.toISOString() ?? null,
      completedAt: search.completedAt?.toISOString() ?? null,
    }
  }

  /**
   * 只开放下一批100条结果，不预取商品。targetLimit采用目标值语义，同一请求重复到达时保持幂等。
   * 行锁确保并发请求按数据库中的最新窗口判断，避免一次双击意外增加两个窗口。
   */
  async extendResultWindow(
    ownerUserId: string,
    workflowRunId: string,
    searchId: string,
    targetLimit: number,
  ): Promise<SourcingWindowResponse> {
    if (
      !Number.isInteger(targetLimit)
      || targetLimit < SOURCING_RESULT_WINDOW_STEP
      || targetLimit % SOURCING_RESULT_WINDOW_STEP !== 0
    ) {
      throw new BadRequestException('Sourcing result limit must be a positive multiple of 100')
    }

    return this.dataSource.transaction(async (manager) => {
      const searchRepository = manager.getRepository(SourcingSearchEntity)
      const search = await searchRepository.findOne({
        where: { id: searchId, ownerUserId, workflowRunId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!search) throw new NotFoundException('Sourcing search not found')
      if (search.totalRecords === null) {
        throw new BadRequestException('Load the first sourcing page before extending results')
      }

      const currentLimit = Number.isInteger(search.resultLimit) && search.resultLimit >= 100
        ? search.resultLimit
        : SOURCING_RESULT_WINDOW_STEP
      search.resultLimit = currentLimit
      if (targetLimit <= currentLimit || Number(search.totalRecords) <= currentLimit) {
        return { searchId, ...this.resultWindow(search) }
      }
      if (targetLimit !== currentLimit + SOURCING_RESULT_WINDOW_STEP) {
        throw new BadRequestException('Only the next 100 sourcing results can be opened')
      }

      search.resultLimit = targetLimit
      await searchRepository.save(search)
      return { searchId, ...this.resultWindow(search) }
    })
  }

  /**
   * 保留1688第一页返回的原始总量，只把当前获准浏览的结果窗口暴露给前端分页。
   * 历史测试夹具或迁移前对象没有resultLimit时按100条兼容，数据库迁移后实体始终有值。
   */
  private resultWindow(search: SourcingSearchEntity): SourcingResultWindow {
    const providerTotalRecords = search.totalRecords === null
      ? null
      : Number(search.totalRecords)
    const resultLimit = Number.isInteger(search.resultLimit) && search.resultLimit >= 100
      ? search.resultLimit
      : SOURCING_RESULT_WINDOW_STEP
    if (providerTotalRecords === null || !Number.isFinite(providerTotalRecords)) {
      return {
        totalRecords: null,
        totalPages: null,
        providerTotalRecords: null,
        resultLimit,
        canExpand: false,
      }
    }

    const totalRecords = Math.min(Math.max(0, providerTotalRecords), resultLimit)
    const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / search.pageSize)
    return {
      totalRecords,
      totalPages,
      providerTotalRecords,
      resultLimit,
      canExpand: providerTotalRecords > resultLimit,
    }
  }

  private mapOffer(offer: SourcingOfferEntity): SourcingOfferResponse {
    const capabilities = offer.supplier?.capabilities ?? {}
    const identities = Array.isArray(capabilities.identities)
      ? capabilities.identities.filter((value): value is string => typeof value === 'string')
      : []
    return {
      id: offer.id,
      providerOfferId: offer.offerId,
      sourcingScore: offer.sourcingScore,
      imageUrl: offer.imageUrl,
      chineseTitle: offer.titleZh,
      foreignTitle: offer.titleEn,
      title: offer.title,
      offerUrl: offer.offerUrl,
      currency: offer.currency,
      priceMin: offer.priceMin,
      priceMax: offer.priceMax,
      moq: offer.minimumOrderQuantity,
      unit: offer.quantityUnit,
      salesVolume: offer.salesVolume,
      repurchaseRate: offer.repurchaseRate,
      supplier: offer.supplier
        ? {
            companyName: offer.supplier.companyName,
            shopName: offer.supplier.shopName,
            shopUrl: offer.supplier.shopUrl,
            score: offer.supplier.supplierRating,
            identities,
            badges: offer.tags,
          }
        : null,
      recommendationReasons: offer.sourcingScoreReasons.map((reason) => reason.label),
    }
  }

  private apiStatus(status: SourcingSearchEntity['status']): SourcingSearchResponse['status'] {
    if (status === 'succeeded') return 'completed'
    if (status === 'pending') return 'running'
    if (status === 'cancelled') return 'failed'
    return status
  }
}
