import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, MoreThanOrEqual, Not, Repository, DataSource } from 'typeorm'
import {
  SourcingOfferEntity,
  SourcingSearchEntity,
  SourcingSearchPageEntity,
  SourcingSupplierEntity,
} from './entities'
import { SOURCING_PROVIDER } from './sourcing.types'

const SOURCING_PAGE_CACHE_TTL_MS = 6 * 60 * 60 * 1000

/**
 * 将近期同条件成功分页复制到当前搜索，避免重复调用1688分页和详情接口。
 * 缓存仅在当前用户范围内查找，来源历史记录始终保持只读。
 */
@Injectable()
export class SourcingPageCacheService {
  private readonly logger = new Logger(SourcingPageCacheService.name)

  constructor(
    @InjectRepository(SourcingSearchPageEntity)
    private readonly pageRepository: Repository<SourcingSearchPageEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async restore(
    ownerUserId: string,
    currentSearch: SourcingSearchEntity,
    pageNumber: number,
  ): Promise<SourcingSearchPageEntity | null> {
    const cacheFingerprint = currentSearch.cacheFingerprint
    if (!cacheFingerprint || pageNumber <= 1) return null
    try {
      return await this.dataSource.transaction(async (manager) => {
        const searchRepository = manager.getRepository(SourcingSearchEntity)
        const pageRepository = manager.getRepository(SourcingSearchPageEntity)
        const offerRepository = manager.getRepository(SourcingOfferEntity)
        const supplierRepository = manager.getRepository(SourcingSupplierEntity)
        const existing = await pageRepository.findOne({
          where: { ownerUserId, searchId: currentSearch.id, pageNumber },
        })
        if (existing) return existing

        const cutoff = new Date(Date.now() - SOURCING_PAGE_CACHE_TTL_MS)
        const sourcePage = await pageRepository.findOne({
          where: {
            ownerUserId,
            pageNumber,
            pageSize: currentSearch.pageSize,
            status: 'succeeded',
            completedAt: MoreThanOrEqual(cutoff),
            search: {
              id: Not(currentSearch.id),
              ownerUserId,
              provider: SOURCING_PROVIDER,
              cacheFingerprint,
            },
          },
          relations: { search: true },
          order: { completedAt: 'DESC' },
        })
        if (!this.isEligibleSource(sourcePage, currentSearch, ownerUserId, pageNumber, cutoff)) {
          return null
        }

        const sourceOffers = await offerRepository.find({
          where: {
            ownerUserId,
            searchId: sourcePage.searchId,
            pageNumber,
          },
          relations: { supplier: true },
          order: { rankInPage: 'ASC' },
        })
        if (
          sourceOffers.length !== sourcePage.resultCount
          || sourceOffers.some((offer) => !this.supplierName(offer.supplier))
        ) {
          return null
        }

        const existingOffers = await this.findExistingOffers(
          offerRepository,
          ownerUserId,
          currentSearch.id,
          sourceOffers,
        )
        const existingOfferIds = new Set(existingOffers.map((offer) => offer.offerId))
        const existingFingerprints = new Set(
          existingOffers
            .map((offer) => offer.productFingerprint)
            .filter((value): value is string => Boolean(value)),
        )
        const sourceSuppliers = this.uniqueSourceSuppliers(sourceOffers)
        const supplierKeys = sourceSuppliers.map((supplier) => supplier.supplierKey)
        const existingSuppliers = supplierKeys.length
          ? await supplierRepository.find({
              where: {
                ownerUserId,
                searchId: currentSearch.id,
                provider: SOURCING_PROVIDER,
                supplierKey: In(supplierKeys),
              },
            })
          : []
        const targetSuppliers = new Map(
          existingSuppliers.map((supplier) => [supplier.supplierKey, supplier]),
        )
        const missingSuppliers = sourceSuppliers
          .filter((supplier) => !targetSuppliers.has(supplier.supplierKey))
          .map((supplier) => supplierRepository.create(
            this.cloneSupplier(supplier, currentSearch, ownerUserId),
          ))
        if (missingSuppliers.length) {
          const savedSuppliers = await supplierRepository.save(missingSuppliers)
          for (const supplier of savedSuppliers) {
            targetSuppliers.set(supplier.supplierKey, supplier)
          }
        }

        const pageOfferIds = new Set<string>()
        const pageFingerprints = new Set<string>()
        const targetOffers: SourcingOfferEntity[] = []
        for (const sourceOffer of sourceOffers) {
          const fingerprint = sourceOffer.productFingerprint
          if (
            existingOfferIds.has(sourceOffer.offerId)
            || pageOfferIds.has(sourceOffer.offerId)
            || (fingerprint && (
              existingFingerprints.has(fingerprint) || pageFingerprints.has(fingerprint)
            ))
          ) {
            continue
          }
          const targetSupplier = sourceOffer.supplier
            ? targetSuppliers.get(sourceOffer.supplier.supplierKey) || null
            : null
          targetOffers.push(offerRepository.create(this.cloneOffer(
            sourceOffer,
            targetSupplier,
            sourcePage.id,
            currentSearch,
            ownerUserId,
          )))
          pageOfferIds.add(sourceOffer.offerId)
          if (fingerprint) pageFingerprints.add(fingerprint)
        }
        if (targetOffers.length) await offerRepository.save(targetOffers)

        const now = new Date()
        const restoredPage = await pageRepository.save(pageRepository.create({
          searchId: currentSearch.id,
          ownerUserId,
          pageNumber,
          pageSize: currentSearch.pageSize,
          status: 'succeeded',
          attempts: 0,
          maxAttempts: 3,
          availableAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          providerRequestId: null,
          providerTraceId: null,
          resultCount: targetOffers.length,
          cacheHit: true,
          cacheSourcePageId: sourcePage.id,
          errorCode: null,
          errorMessage: null,
          startedAt: now,
          completedAt: now,
        }))
        const [loadedPageCount, failedPageCount] = await Promise.all([
          pageRepository.count({
            where: { ownerUserId, searchId: currentSearch.id, status: 'succeeded' },
          }),
          pageRepository.count({
            where: { ownerUserId, searchId: currentSearch.id, status: 'failed' },
          }),
        ])
        currentSearch.loadedPageCount = loadedPageCount
        currentSearch.status = failedPageCount > 0 ? 'partial' : 'succeeded'
        currentSearch.completedAt = now
        currentSearch.errorCode = null
        currentSearch.errorMessage = null
        await searchRepository.save(currentSearch)
        this.logger.log(
          `1688 sourcing page cache hit search=${currentSearch.id} page=${pageNumber}`
          + ` sourcePage=${sourcePage.id} offers=${targetOffers.length}`,
        )
        return restoredPage
      })
    } catch (error) {
      const concurrentPage = await this.pageRepository.findOne({
        where: { ownerUserId, searchId: currentSearch.id, pageNumber },
      })
      if (concurrentPage) return concurrentPage
      this.logger.warn(
        `1688 sourcing page cache fallback search=${currentSearch.id} page=${pageNumber}`
        + ` reason=${error instanceof Error ? error.message : 'unknown'}`,
      )
      return null
    }
  }

  private isEligibleSource(
    sourcePage: SourcingSearchPageEntity | null,
    currentSearch: SourcingSearchEntity,
    ownerUserId: string,
    pageNumber: number,
    cutoff: Date,
  ): sourcePage is SourcingSearchPageEntity {
    return Boolean(
      sourcePage
      && sourcePage.search
      && sourcePage.searchId !== currentSearch.id
      && sourcePage.ownerUserId === ownerUserId
      && sourcePage.search.ownerUserId === ownerUserId
      && sourcePage.search.provider === SOURCING_PROVIDER
      && sourcePage.search.cacheFingerprint === currentSearch.cacheFingerprint
      && sourcePage.pageNumber === pageNumber
      && sourcePage.pageSize === currentSearch.pageSize
      && sourcePage.status === 'succeeded'
      && sourcePage.completedAt
      && sourcePage.completedAt >= cutoff,
    )
  }

  private async findExistingOffers(
    offerRepository: Repository<SourcingOfferEntity>,
    ownerUserId: string,
    searchId: string,
    sourceOffers: SourcingOfferEntity[],
  ): Promise<SourcingOfferEntity[]> {
    const offerIds = [...new Set(sourceOffers.map((offer) => offer.offerId))]
    const fingerprints = [...new Set(sourceOffers
      .map((offer) => offer.productFingerprint)
      .filter((value): value is string => Boolean(value)))]
    const where = []
    if (offerIds.length) where.push({
      ownerUserId,
      searchId,
      provider: SOURCING_PROVIDER,
      offerId: In(offerIds),
    })
    if (fingerprints.length) where.push({
      ownerUserId,
      searchId,
      provider: SOURCING_PROVIDER,
      productFingerprint: In(fingerprints),
    })
    return where.length ? offerRepository.find({ where }) : []
  }

  private uniqueSourceSuppliers(sourceOffers: SourcingOfferEntity[]): SourcingSupplierEntity[] {
    const suppliers = new Map<string, SourcingSupplierEntity>()
    for (const offer of sourceOffers) {
      if (offer.supplier && !suppliers.has(offer.supplier.supplierKey)) {
        suppliers.set(offer.supplier.supplierKey, offer.supplier)
      }
    }
    return [...suppliers.values()]
  }

  private supplierName(supplier: SourcingSupplierEntity | null): string | null {
    return supplier?.companyName?.trim() || supplier?.shopName?.trim() || null
  }

  private cloneSupplier(
    source: SourcingSupplierEntity,
    search: SourcingSearchEntity,
    ownerUserId: string,
  ): Partial<SourcingSupplierEntity> {
    return {
      searchId: search.id,
      ownerUserId,
      workflowRunId: search.workflowRunId,
      provider: SOURCING_PROVIDER,
      supplierKey: source.supplierKey,
      memberId: source.memberId,
      openId: source.openId,
      companyName: source.companyName,
      shopName: source.shopName,
      shopUrl: source.shopUrl,
      supplierRating: source.supplierRating,
      yearsInBusiness: source.yearsInBusiness,
      capabilities: source.capabilities,
    }
  }

  private cloneOffer(
    source: SourcingOfferEntity,
    supplier: SourcingSupplierEntity | null,
    sourcePageId: string,
    search: SourcingSearchEntity,
    ownerUserId: string,
  ): Partial<SourcingOfferEntity> {
    return {
      searchId: search.id,
      supplierId: supplier?.id || null,
      ownerUserId,
      workflowRunId: search.workflowRunId,
      provider: SOURCING_PROVIDER,
      offerId: source.offerId,
      productFingerprint: source.productFingerprint,
      offerUrl: source.offerUrl,
      imageUrl: source.imageUrl,
      title: source.title,
      titleZh: source.titleZh,
      titleEn: source.titleEn,
      categoryId: source.categoryId,
      categoryName: source.categoryName,
      minimumOrderQuantity: source.minimumOrderQuantity,
      quantityUnit: source.quantityUnit,
      priceMin: source.priceMin,
      priceMax: source.priceMax,
      currency: source.currency,
      priceTiers: source.priceTiers,
      salesVolume: source.salesVolume,
      repurchaseRate: source.repurchaseRate,
      pageNumber: source.pageNumber,
      rankInPage: source.rankInPage,
      absoluteRank: source.absoluteRank,
      detailStatus: source.detailStatus,
      detailRetrievedAt: source.detailRetrievedAt,
      scoreVersion: source.scoreVersion,
      scoreDimensions: source.scoreDimensions,
      tags: source.tags,
      sourcingScore: source.sourcingScore,
      sourcingScoreReasons: source.sourcingScoreReasons,
      rawSnapshot: {
        cacheSourcePageId: sourcePageId,
        cacheSourceOfferId: source.id,
      },
    }
  }
}
