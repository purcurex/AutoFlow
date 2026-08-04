import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'
import {
  Alibaba1688Service,
  type Alibaba1688CallResult,
  type Alibaba1688ImageProviderResponse,
  type Alibaba1688KeywordProviderResponse,
  type Alibaba1688StableOffer,
  type Alibaba1688StableProductDetail,
  type Alibaba1688StableSearchResult,
} from '../alibaba1688'
import { WorkflowRunEntity } from '../autoflow/entities'
import {
  SourcingOfferEntity,
  SourcingSearchEntity,
  SourcingSearchPageEntity,
  SourcingSupplierEntity,
} from './entities'
import { decimalMinMax, decimalOrNull } from './sourcing-decimal'
import { SourcingImageResolverService } from './sourcing-image-resolver.service'
import { calculateSourcingScore } from './sourcing-scoring'
import { sanitizeSourcingSnapshot } from './sourcing-snapshot'
import { SOURCING_PROVIDER, type SourcingScoreReason } from './sourcing.types'

export interface ClaimedSourcingPage {
  id: string
  searchId: string
  workflowRunId: string
  ownerUserId: string
  pageNumber: number
  pageSize: number
  attempts: number
  maxAttempts: number
  leaseOwner: string
}

interface HydratedOffer {
  offer: Alibaba1688StableOffer
  rawOffer: unknown
  detail: Alibaba1688StableProductDetail | null
  rawDetail: unknown
  detailStatus: 'not_requested' | 'succeeded' | 'failed'
}

const SCORE_LABELS: Record<string, string> = {
  high_product_relevance: 'High product relevance',
  usable_price_range: 'Usable procurement price',
  dropshipping_friendly_moq: 'Dropshipping-friendly MOQ',
  reliable_supplier_signals: 'Reliable supplier signals',
  fast_dispatch_signal: 'Fast dispatch signal',
  customization_supported: 'Customization supported',
}

/** 执行一个已获得租约的1688分页，并在单个数据库事务内保存整页结果。 */
@Injectable()
export class SourcingPageExecutorService {
  private readonly logger = new Logger(SourcingPageExecutorService.name)

  constructor(
    @InjectRepository(SourcingSearchEntity)
    private readonly searchRepository: Repository<SourcingSearchEntity>,
    @InjectRepository(WorkflowRunEntity)
    private readonly workflowRepository: Repository<WorkflowRunEntity>,
    private readonly alibaba1688Service: Alibaba1688Service,
    private readonly imageResolver: SourcingImageResolverService,
    private readonly dataSource: DataSource,
  ) {}

  async executePage(page: ClaimedSourcingPage): Promise<void> {
    const [search, workflow] = await Promise.all([
      this.searchRepository.findOne({
        where: {
          id: page.searchId,
          ownerUserId: page.ownerUserId,
          workflowRunId: page.workflowRunId,
        },
      }),
      this.workflowRepository.findOne({
        where: { id: page.workflowRunId, ownerUserId: page.ownerUserId },
      }),
    ])
    if (!search || !workflow) throw new NotFoundException('Sourcing page scope is invalid')
    if (search.pageSize !== page.pageSize) throw new Error('Sourcing page size is inconsistent')

    let imageId = search.imageId
    if (search.searchMode === 'image' && !imageId) {
      const image = await this.imageResolver.resolve(workflow)
      const uploaded = await this.alibaba1688Service.uploadImage({
        imageBase64: image.bytes.toString('base64'),
      })
      imageId = uploaded.normalized.imageId
      await this.searchRepository.update(
        { id: search.id, ownerUserId: page.ownerUserId },
        {
          imageId,
          imageUploadRequestId: uploaded.metadata.requestId,
          imageUploadTraceId: uploaded.metadata.traceId,
        },
      )
      search.imageId = imageId
    }

    const priceMin = this.requestText(search, 'priceMin')
    const priceMax = this.requestText(search, 'priceMax')
    let result: Alibaba1688CallResult<
      Alibaba1688KeywordProviderResponse | Alibaba1688ImageProviderResponse,
      Alibaba1688StableSearchResult
    >
    if (search.searchMode === 'keyword') {
      result = await this.alibaba1688Service.searchByKeyword({
        keyword: search.keyword || workflow.seedValue,
        beginPage: page.pageNumber,
        pageSize: page.pageSize,
        priceStart: priceMin || undefined,
        priceEnd: priceMax || undefined,
        country: search.languageCode,
        keywordTranslate: false,
      })
    } else {
      if (!imageId) throw new Error('Alibaba 1688 image upload did not return imageId')
      result = await this.alibaba1688Service.searchByImage({
        imageId,
        beginPage: page.pageNumber,
        pageSize: page.pageSize,
        country: search.languageCode,
      })
    }

    const rawOffers = this.rawOffers(result.provider)
    const detailResults = await Promise.allSettled(
      result.normalized.offers.slice(0, 5).map((offer) =>
        offer.offerId
          ? this.alibaba1688Service.getProductDetail({
              offerId: offer.offerId,
              country: search.languageCode,
            })
          : Promise.reject(new Error('Offer ID is missing')),
      ),
    )
    const hydrated: HydratedOffer[] = result.normalized.offers
      .slice(0, page.pageSize)
      .map((offer, index) => {
        const detailResult = detailResults[index]
        return {
          offer,
          rawOffer: rawOffers[index] || null,
          detail: detailResult?.status === 'fulfilled'
            ? detailResult.value.normalized
            : null,
          rawDetail: detailResult?.status === 'fulfilled'
            ? detailResult.value.provider
            : null,
          detailStatus: index >= 5
            ? 'not_requested'
            : detailResult?.status === 'fulfilled' ? 'succeeded' : 'failed',
        }
      })

    await this.persistPage(page, search, workflow, result, hydrated)
  }

  private async persistPage(
    page: ClaimedSourcingPage,
    search: SourcingSearchEntity,
    workflow: WorkflowRunEntity,
    result: Alibaba1688CallResult<
      Alibaba1688KeywordProviderResponse | Alibaba1688ImageProviderResponse,
      Alibaba1688StableSearchResult
    >,
    hydrated: HydratedOffer[],
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const searchRepository = manager.getRepository(SourcingSearchEntity)
      const pageRepository = manager.getRepository(SourcingSearchPageEntity)
      const offerRepository = manager.getRepository(SourcingOfferEntity)
      const supplierRepository = manager.getRepository(SourcingSupplierEntity)
      await offerRepository.delete({
        ownerUserId: page.ownerUserId,
        searchId: page.searchId,
        pageNumber: page.pageNumber,
      })

      let persistedCount = 0
      for (let index = 0; index < hydrated.length; index += 1) {
        const item = hydrated[index]
        const source = item.offer
        if (!source.offerId) continue
        const duplicate = await offerRepository.findOne({
          where: { searchId: search.id, provider: SOURCING_PROVIDER, offerId: source.offerId },
        })
        if (duplicate) continue

        const detail = item.detail
        const seller = detail?.seller || source.seller
        const supplierKey = (seller.openId || seller.companyName || `offer:${source.offerId}`)
          .slice(0, 255)
        let supplier = await supplierRepository.findOne({
          where: { searchId: search.id, provider: SOURCING_PROVIDER, supplierKey },
        })
        const identities = [...new Set([...seller.identities, ...source.offerIdentities])]
        const supplierRating = this.ratingValue(
          seller.compositeServiceScore || source.tradeScore,
        )
        if (!supplier) {
          supplier = await supplierRepository.save(supplierRepository.create({
            searchId: search.id,
            ownerUserId: page.ownerUserId,
            workflowRunId: page.workflowRunId,
            provider: SOURCING_PROVIDER,
            supplierKey,
            memberId: null,
            openId: seller.openId,
            companyName: seller.companyName,
            shopName: seller.companyName,
            shopUrl: seller.shopUrl,
            supplierRating: decimalOrNull(supplierRating),
            yearsInBusiness: null,
            capabilities: {
              identities,
              tradeMedalLevel: seller.tradeMedalLevel,
              logisticsExperienceScore: seller.logisticsExperienceScore,
              repeatPurchasePercent: seller.repeatPurchasePercent,
              onePieceDropshipping: source.onePieceDropshipping,
              selectedSupply: source.selectedSupply,
              sellingPoints: detail?.sellingPoints || [],
            },
          }))
        }

        const prices = [
          source.price.promotionAmount,
          source.price.selectedSupplyAmount,
          source.price.consignAmount,
          source.price.amount,
          ...(detail?.skus.flatMap((sku) => [sku.consignPrice, sku.price]) || []),
        ].map((value) => decimalOrNull(value)).filter((value): value is string => value !== null)
        const priceRange = decimalMinMax(prices)
        const minimumOrderQuantity = decimalOrNull(
          detail?.minOrderQuantity ?? source.minOrderQuantity,
        )
        const score = calculateSourcingScore({
          query: workflow.seedType === 'keyword' ? workflow.seedValue : '',
          title: [detail?.title, detail?.translatedTitle, source.title, source.translatedTitle]
            .filter(Boolean).join(' '),
          providerRank: index + 1,
          priceRanges: prices.map((price) => ({ price })),
          targetPriceMin: this.requestText(search, 'priceMin'),
          targetPriceMax: this.requestText(search, 'priceMax'),
          minimumOrderQuantity,
          sellerCompositeScore: supplierRating,
          sellerTradeScore: this.ratingValue(source.tradeScore),
          repeatPurchasePercent: this.percentValue(
            seller.repeatPurchasePercent || source.repurchaseRate,
          ),
          deliveryReadinessPercent: this.ratingValue(seller.logisticsExperienceScore),
          supportsCustomization: [...identities, ...(detail?.sellingPoints || [])]
            .some((value) => /custom|oem|odm|定制|贴牌/i.test(value)),
          isVerifiedSupplier: identities.length > 0,
        })
        const scoreReasons: SourcingScoreReason[] = score.reasons.map((code) => ({
          code,
          label: SCORE_LABELS[code] || code,
          score: this.reasonScore(code, score.dimensions),
        }))
        const rankInPage = index + 1
        await offerRepository.save(offerRepository.create({
          searchId: search.id,
          supplierId: supplier.id,
          ownerUserId: page.ownerUserId,
          workflowRunId: page.workflowRunId,
          provider: SOURCING_PROVIDER,
          offerId: source.offerId,
          offerUrl: detail?.offerUrl || source.offerUrl
            || `https://detail.1688.com/offer/${source.offerId}.html`,
          imageUrl: detail?.imageUrls[0] || source.imageUrl,
          title: detail?.title || source.title || source.translatedTitle
            || `1688 Offer ${source.offerId}`,
          titleZh: detail?.title || source.title,
          titleEn: detail?.translatedTitle || source.translatedTitle,
          categoryId: detail?.categoryId || null,
          categoryName: detail?.categoryName || null,
          minimumOrderQuantity,
          quantityUnit: null,
          priceMin: priceRange.minimum,
          priceMax: priceRange.maximum,
          currency: 'CNY',
          priceTiers: prices.map((price) => ({
            minimumQuantity: minimumOrderQuantity || '1.0000',
            unitPrice: price,
            currency: 'CNY',
          })),
          salesVolume: source.monthSold === null ? null : String(source.monthSold),
          repurchaseRate: decimalOrNull(this.percentValue(
            source.repurchaseRate || seller.repeatPurchasePercent,
          )),
          pageNumber: page.pageNumber,
          rankInPage,
          absoluteRank: (page.pageNumber - 1) * page.pageSize + rankInPage,
          detailStatus: item.detailStatus,
          detailRetrievedAt: item.detailStatus === 'succeeded' ? new Date() : null,
          scoreVersion: 'v1',
          scoreDimensions: { ...score.dimensions },
          tags: identities,
          sourcingScore: score.score,
          sourcingScoreReasons: scoreReasons,
          rawSnapshot: sanitizeSourcingSnapshot({
            searchOffer: item.rawOffer || source,
            productDetail: item.rawDetail || detail,
          }),
        }))
        persistedCount += 1
      }

      const now = new Date()
      const completion = await pageRepository.update(
        { id: page.id, status: 'running', leaseOwner: page.leaseOwner },
        {
          status: 'succeeded',
          providerRequestId: result.metadata.requestId,
          providerTraceId: result.metadata.traceId,
          resultCount: persistedCount,
          errorCode: null,
          errorMessage: null,
          completedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
        },
      )
      if (completion.affected !== 1) {
        throw new Error('Sourcing page lease was lost before completion')
      }

      const loadedPageCount = await pageRepository.count({
        where: { searchId: search.id, ownerUserId: page.ownerUserId, status: 'succeeded' },
      })
      if (
        page.pageNumber > 1
        && search.totalRecords !== null
        && result.normalized.totalRecords !== null
        && search.totalRecords !== String(result.normalized.totalRecords)
      ) {
        this.logger.warn(
          `1688 sourcing total changed search=${search.id} page=${page.pageNumber}`,
        )
      }
      search.totalRecords = result.normalized.totalRecords === null
        ? search.totalRecords
        : String(result.normalized.totalRecords)
      search.totalPages = result.normalized.totalPages ?? search.totalPages
      search.loadedPageCount = loadedPageCount
      search.status = search.status === 'partial' ? 'partial' : 'succeeded'
      search.providerRequestId = result.metadata.requestId
      search.startedAt ||= now
      search.completedAt = now
      search.errorCode = null
      search.errorMessage = null
      await searchRepository.save(search)
    })
  }

  private rawOffers(
    provider: Alibaba1688KeywordProviderResponse | Alibaba1688ImageProviderResponse,
  ): unknown[] {
    const data = provider.result?.result?.data
    return Array.isArray(data) ? data : []
  }

  private requestText(search: SourcingSearchEntity, key: string): string | null {
    const value = search.requestPayload?.[key]
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }

  private numericValue(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(String(value).replace('%', ''))
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }

  private percentValue(value: string | number | null | undefined): number | null {
    const parsed = this.numericValue(value)
    return parsed === null ? null : Math.min(100, parsed <= 1 ? parsed * 100 : parsed)
  }

  private ratingValue(value: string | number | null | undefined): number | null {
    const parsed = this.numericValue(value)
    if (parsed === null) return null
    if (parsed <= 1) return parsed * 100
    if (parsed <= 5) return parsed * 20
    return Math.min(100, parsed)
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
    return mapping[code] || 0
  }
}
