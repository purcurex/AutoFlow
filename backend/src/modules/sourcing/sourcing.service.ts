import { readBusinessOwners } from '../users/business-data-access'
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'crypto'
import { DataSource, Repository } from 'typeorm'
import {
  Alibaba1688Exception,
  Alibaba1688Service,
  type Alibaba1688StableProductDetail,
  type Alibaba1688StableSearchResult,
} from '../alibaba1688'
import { WorkflowRunEntity } from '../autoflow/entities'
import { StartSourcingDto } from './dto/start-sourcing.dto'
import {
  SourcingOfferEntity,
  SourcingSearchEntity,
  SourcingSupplierEntity,
} from './entities'
import {
  calculateSourcingScore,
  type SourcingScoreInput,
} from './sourcing-scoring'
import type {
  SourcingOfferResponse,
  SourcingSearchResponse,
  SourcingSummaryResponse,
} from './sourcing-response.types'
import { SOURCING_PROVIDER, type SourcingScoreReason } from './sourcing.types'

interface PreparedSearch {
  workflow: WorkflowRunEntity
  search: SourcingSearchEntity | null
  reuseExisting: boolean
}

interface OfferHydration {
  detail: Alibaba1688StableProductDetail | null
  providerOffer: Alibaba1688StableSearchResult['offers'][number]
  rank: number
}

const SCORE_LABELS: Record<string, string> = {
  high_product_relevance: 'High product relevance',
  usable_price_range: 'Usable procurement price',
  dropshipping_friendly_moq: 'Dropshipping-friendly MOQ',
  reliable_supplier_signals: 'Reliable supplier signals',
  fast_dispatch_signal: 'Fast dispatch signal',
  customization_supported: 'Customization supported',
}

@Injectable()
export class SourcingService {
  private readonly logger = new Logger(SourcingService.name)

  constructor(
    @InjectRepository(WorkflowRunEntity)
    private readonly workflowRepository: Repository<WorkflowRunEntity>,
    @InjectRepository(SourcingSearchEntity)
    private readonly searchRepository: Repository<SourcingSearchEntity>,
    @InjectRepository(SourcingOfferEntity)
    private readonly offerRepository: Repository<SourcingOfferEntity>,
    private readonly alibaba1688Service: Alibaba1688Service,
    private readonly dataSource: DataSource,
  ) {}

  async getSummary(ownerUserId: string, workflowRunId: string): Promise<SourcingSummaryResponse> {
    const owners = await readBusinessOwners(this.dataSource, ownerUserId)
    const workflow = await this.workflowRepository.findOne({ where: { id: workflowRunId, ownerUserId: owners.filter } })
    if (!workflow) throw new NotFoundException('Workflow not found')
    return this.buildSummary(workflow.ownerUserId, workflowRunId)
  }

  async startSearch(
    ownerUserId: string,
    workflowRunId: string,
    options: StartSourcingDto = {},
  ): Promise<SourcingSummaryResponse> {
    if (
      options.priceMin !== undefined
      && options.priceMax !== undefined
      && options.priceMin > options.priceMax
    ) {
      throw new BadRequestException('priceMin cannot be greater than priceMax')
    }
    const readiness = this.alibaba1688Service.getReadiness()
    if (!readiness.ready) {
      await this.requireWorkflow(ownerUserId, workflowRunId)
      return this.buildSummary(ownerUserId, workflowRunId)
    }

    const prepared = await this.prepareSearch(ownerUserId, workflowRunId, options)
    if (prepared.reuseExisting || !prepared.search) {
      return this.buildSummary(ownerUserId, workflowRunId)
    }

    const search = prepared.search
    try {
      search.status = 'running'
      search.startedAt = new Date()
      await this.searchRepository.save(search)

      const result = prepared.workflow.seedType === 'keyword'
        ? await this.alibaba1688Service.searchByKeyword({
            keyword: prepared.workflow.seedValue,
            beginPage: 1,
            pageSize: options.pageSize,
            priceStart: this.optionalPrice(options.priceMin),
            priceEnd: this.optionalPrice(options.priceMax),
            country: 'en',
            keywordTranslate: false,
          })
        : await this.alibaba1688Service.searchByImage({
            imageAddress: prepared.workflow.seedValue,
            beginPage: 1,
            pageSize: options.pageSize,
            priceStart: this.optionalPrice(options.priceMin),
            priceEnd: this.optionalPrice(options.priceMax),
            country: 'en',
          })

      search.providerRequestId = result.metadata.requestId
      await this.persistResults(prepared.workflow, search, result.normalized, options)
      search.status = 'succeeded'
      search.completedAt = new Date()
      await this.searchRepository.save(search)
    } catch (error) {
      const failure = error instanceof Alibaba1688Exception
        ? error.normalized
        : {
            code: 'PROVIDER_REJECTED',
            message: error instanceof Error ? error.message : 'Alibaba 1688 sourcing failed',
          }
      search.status = 'failed'
      search.errorCode = failure.code
      search.errorMessage = failure.message.slice(0, 2000)
      search.completedAt = new Date()
      await this.searchRepository.save(search)
      this.logger.warn(
        `1688 sourcing failed workflow=${workflowRunId} code=${failure.code}`,
      )
    }

    return this.buildSummary(ownerUserId, workflowRunId)
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

  private async prepareSearch(
    ownerUserId: string,
    workflowRunId: string,
    options: StartSourcingDto,
  ): Promise<PreparedSearch> {
    return this.dataSource.transaction(async (manager) => {
      const workflowRepository = manager.getRepository(WorkflowRunEntity)
      const searchRepository = manager.getRepository(SourcingSearchEntity)
      const workflow = await workflowRepository
        .createQueryBuilder('workflow')
        .setLock('pessimistic_write')
        .where('workflow.id = :workflowRunId', { workflowRunId })
        .andWhere('workflow.ownerUserId = :ownerUserId', { ownerUserId })
        .getOne()
      if (!workflow) throw new NotFoundException('Workflow not found')

      const latest = await searchRepository.findOne({
        where: { ownerUserId, workflowRunId },
        order: { createdAt: 'DESC' },
      })
      if (latest?.status === 'running' || latest?.status === 'pending') {
        return { workflow, search: latest, reuseExisting: true }
      }
      if (!options.force && latest?.status === 'succeeded') {
        return { workflow, search: latest, reuseExisting: true }
      }

      const search = searchRepository.create({
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
        keyword: workflow.seedType === 'keyword' ? workflow.seedValue : null,
        imageUrl: workflow.seedType === 'image' ? workflow.seedValue : null,
        requestPayload: {
          seedType: workflow.seedType,
          pageSize: options.pageSize ?? null,
          priceMin: options.priceMin ?? null,
          priceMax: options.priceMax ?? null,
        },
        errorCode: null,
        errorMessage: null,
        requestedAt: new Date(),
        startedAt: null,
        completedAt: null,
      })
      return {
        workflow,
        search: await searchRepository.save(search),
        reuseExisting: false,
      }
    })
  }

  private async persistResults(
    workflow: WorkflowRunEntity,
    search: SourcingSearchEntity,
    normalized: Alibaba1688StableSearchResult,
    options: StartSourcingDto,
  ): Promise<void> {
    const maxResults = Math.min(normalized.offers.length, options.pageSize ?? 20, 20)
    const offers = normalized.offers.slice(0, maxResults)
    const hydrated: OfferHydration[] = []

    const detailLimit = Math.min(offers.length, 5)
    for (let offset = 0; offset < offers.length; offset += 5) {
      const batch = offers.slice(offset, offset + 5)
      const details = await Promise.allSettled(
        batch.map((offer, index) =>
          offset + index < detailLimit && offer.offerId
            ? this.alibaba1688Service.getProductDetail({ offerId: offer.offerId, country: 'en' })
            : Promise.resolve(null),
        ),
      )
      batch.forEach((providerOffer, index) => {
        const detailResult = details[index]
        hydrated.push({
          providerOffer,
          rank: offset + index + 1,
          detail: detailResult?.status === 'fulfilled' && detailResult.value
            ? detailResult.value.normalized
            : null,
        })
      })
    }

    await this.dataSource.transaction(async (manager) => {
      const supplierRepository = manager.getRepository(SourcingSupplierEntity)
      const offerRepository = manager.getRepository(SourcingOfferEntity)
      const suppliers = new Map<string, SourcingSupplierEntity>()
      const seenOfferIds = new Set<string>()

      for (const item of hydrated) {
        const source = item.providerOffer
        if (!source.offerId || seenOfferIds.has(source.offerId)) continue
        seenOfferIds.add(source.offerId)
        const detail = item.detail
        const seller = detail?.seller ?? source.seller
        const supplierKey = seller.openId
          || seller.companyName
          || `offer:${source.offerId}`
        const identities = Array.from(new Set([
          ...seller.identities,
          ...source.offerIdentities,
        ]))
        const capabilities = {
          identities,
          tradeMedalLevel: seller.tradeMedalLevel,
          logisticsExperienceScore: seller.logisticsExperienceScore,
          repeatPurchasePercent: seller.repeatPurchasePercent,
          onePieceDropshipping: source.onePieceDropshipping,
          selectedSupply: source.selectedSupply,
          sellingPoints: detail?.sellingPoints ?? [],
        }
        const normalizedSupplierKey = supplierKey.slice(0, 255)
        const supplierRating = this.ratingValue(seller.compositeServiceScore)
          ?? this.ratingValue(source.tradeScore)
        let supplier = suppliers.get(normalizedSupplierKey)
        if (!supplier) {
          supplier = await supplierRepository.save(supplierRepository.create({
            searchId: search.id,
            ownerUserId: workflow.ownerUserId,
            workflowRunId: workflow.id,
            provider: SOURCING_PROVIDER,
            supplierKey: normalizedSupplierKey,
            memberId: null,
            openId: seller.openId,
            companyName: seller.companyName,
            shopName: seller.companyName,
            shopUrl: seller.shopUrl,
            supplierRating,
            yearsInBusiness: null,
            capabilities,
          }))
          suppliers.set(normalizedSupplierKey, supplier)
        }

        const prices = [
          source.price.promotionAmount,
          source.price.selectedSupplyAmount,
          source.price.consignAmount,
          source.price.amount,
          ...(detail?.skus.flatMap((sku) => [sku.consignPrice, sku.price]) ?? []),
        ]
          .map((value) => this.decimalValue(value))
          .filter((value): value is number => value !== null)
        const priceMin = prices.length > 0 ? Math.min(...prices) : null
        const priceMax = prices.length > 0 ? Math.max(...prices) : null
        const supportsCustomization = this.supportsCustomization(identities, detail?.sellingPoints)
        const scoreInput: SourcingScoreInput = {
          query: workflow.seedType === 'keyword' ? workflow.seedValue : '',
          title: [
            detail?.title,
            detail?.translatedTitle,
            source.title,
            source.translatedTitle,
          ].filter(Boolean).join(' '),
          providerRank: item.rank,
          priceRanges: prices.map((price) => ({ price })),
          targetPriceMin: options.priceMin,
          targetPriceMax: options.priceMax,
          minimumOrderQuantity: detail?.minOrderQuantity ?? source.minOrderQuantity,
          sellerCompositeScore: supplierRating,
          sellerTradeScore: this.ratingValue(source.tradeScore),
          repeatPurchasePercent: this.percentValue(
            seller.repeatPurchasePercent ?? source.repurchaseRate,
          ),
          deliveryReadinessPercent: this.ratingValue(
            seller.logisticsExperienceScore,
          ),
          supportsCustomization,
          isVerifiedSupplier: identities.length > 0,
        }
        const score = calculateSourcingScore(scoreInput)
        const scoreReasons: SourcingScoreReason[] = score.reasons.map((code) => ({
          code,
          label: SCORE_LABELS[code] || code,
          score: this.reasonScore(code, score.dimensions),
        }))

        await offerRepository.save(offerRepository.create({
          searchId: search.id,
          supplierId: supplier.id,
          ownerUserId: workflow.ownerUserId,
          workflowRunId: workflow.id,
          provider: SOURCING_PROVIDER,
          offerId: source.offerId,
          offerUrl: detail?.offerUrl
            || source.offerUrl
            || `https://detail.1688.com/offer/${source.offerId}.html`,
          imageUrl: detail?.imageUrls[0] || source.imageUrl,
          title: detail?.title || source.title || source.translatedTitle || `1688 Offer ${source.offerId}`,
          titleZh: detail?.title || source.title,
          titleEn: detail?.translatedTitle || source.translatedTitle,
          categoryId: detail?.categoryId ?? null,
          categoryName: detail?.categoryName ?? null,
          minimumOrderQuantity: this.optionalDecimal(
            detail?.minOrderQuantity ?? source.minOrderQuantity,
          ),
          quantityUnit: null,
          priceMin: this.optionalDecimal(priceMin),
          priceMax: this.optionalDecimal(priceMax),
          currency: 'CNY',
          priceTiers: prices.map((price) => ({
            minimumQuantity: detail?.minOrderQuantity ?? source.minOrderQuantity ?? 1,
            unitPrice: String(price),
            currency: 'CNY',
          })),
          salesVolume: source.monthSold === null ? null : String(source.monthSold),
          repurchaseRate: this.percentValue(
            source.repurchaseRate ?? seller.repeatPurchasePercent,
          ),
          tags: identities,
          sourcingScore: score.score,
          sourcingScoreReasons: scoreReasons,
          rawSnapshot: {
            sourceTag: normalized.sourceTag,
            affectsContactConfidence: normalized.affectsContactConfidence,
            offer: source,
            detail,
            scoreDimensions: score.dimensions,
          },
        }))
      }
    })
  }

  private async buildSummary(
    ownerUserId: string,
    workflowRunId: string,
  ): Promise<SourcingSummaryResponse> {
    const readiness = this.alibaba1688Service.getReadiness()
    const latestSearch = await this.searchRepository.findOne({
      where: { ownerUserId, workflowRunId },
      order: { createdAt: 'DESC' },
    })
    const offers = latestSearch
      ? await this.offerRepository.find({
          where: { ownerUserId, workflowRunId, searchId: latestSearch.id },
          relations: { supplier: true },
          order: { sourcingScore: 'DESC' },
        })
      : []

    const status = !readiness.ready
      ? 'not_configured'
      : latestSearch
        ? this.apiStatus(latestSearch.status)
        : 'idle'
    return {
      workflowId: workflowRunId,
      provider: SOURCING_PROVIDER,
      providerConfigured: readiness.ready,
      status,
      latestSearch: latestSearch ? this.mapSearch(latestSearch) : null,
      offers: offers.map((offer) => this.mapOffer(offer)),
    }
  }

  private mapSearch(search: SourcingSearchEntity): SourcingSearchResponse {
    return {
      id: search.id,
      status: this.apiStatus(search.status),
      searchMode: search.searchMode,
      query: search.keyword ?? search.imageUrl,
      failureCode: search.errorCode,
      failureMessage: search.errorMessage,
      startedAt: search.startedAt?.toISOString() ?? null,
      completedAt: search.completedAt?.toISOString() ?? null,
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

  private optionalPrice(value: number | undefined): string | undefined {
    return value === undefined ? undefined : String(value)
  }

  private decimalValue(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number.parseFloat(String(value).replace('%', ''))
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }

  private percentValue(value: string | number | null | undefined): number | null {
    const parsed = this.decimalValue(value)
    if (parsed === null) return null
    return Math.min(100, parsed <= 1 ? parsed * 100 : parsed)
  }

  private ratingValue(value: string | number | null | undefined): number | null {
    const parsed = this.decimalValue(value)
    if (parsed === null) return null
    if (parsed <= 1) return parsed * 100
    if (parsed <= 5) return parsed * 20
    return Math.min(100, parsed)
  }

  private optionalDecimal(value: string | number | null | undefined): string | null {
    const parsed = this.decimalValue(value)
    return parsed === null ? null : String(parsed)
  }

  private supportsCustomization(
    identities: string[],
    sellingPoints: string[] | undefined,
  ): boolean {
    return [...identities, ...(sellingPoints ?? [])]
      .some((value) => /custom|oem|odm|定制|贴牌/i.test(value))
  }

  private reasonScore(
    code: string,
    dimensions: ReturnType<typeof calculateSourcingScore>['dimensions'],
  ): number {
    const mapping: Record<string, number> = {
      high_product_relevance: dimensions.relevance,
      usable_price_range: dimensions.pricing,
      dropshipping_friendly_moq: dimensions.minimumOrderQuantity,
      reliable_supplier_signals: dimensions.supplierReliability,
      fast_dispatch_signal: dimensions.delivery,
      customization_supported: dimensions.capabilities,
    }
    return mapping[code] ?? 0
  }
}
