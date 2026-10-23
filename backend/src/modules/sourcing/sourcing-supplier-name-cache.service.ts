import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, MoreThanOrEqual, Repository } from 'typeorm'
import type { Alibaba1688StableOffer } from '../alibaba1688'
import { SourcingOfferEntity, SourcingSupplierEntity } from './entities'
import { SOURCING_PROVIDER } from './sourcing.types'

const SUPPLIER_NAME_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface CachedSupplierIdentity {
  openId: string | null
  companyName: string
  shopUrl: string | null
}

/** 批量复用当前用户近期已验证的供应商名称，避免逐商品重复查询详情。 */
@Injectable()
export class SourcingSupplierNameCacheService {
  private readonly logger = new Logger(SourcingSupplierNameCacheService.name)

  constructor(
    @InjectRepository(SourcingOfferEntity)
    private readonly offerRepository: Repository<SourcingOfferEntity>,
    @InjectRepository(SourcingSupplierEntity)
    private readonly supplierRepository: Repository<SourcingSupplierEntity>,
  ) {}

  async findRecent(
    ownerUserId: string,
    offers: Alibaba1688StableOffer[],
  ): Promise<Map<string, CachedSupplierIdentity>> {
    const offerIds = [...new Set(offers
      .map((offer) => offer.offerId)
      .filter((value): value is string => Boolean(value)))]
    const openIds = [...new Set(offers
      .map((offer) => offer.seller.openId)
      .filter((value): value is string => Boolean(value)))]
    if (!offerIds.length && !openIds.length) return new Map()

    const cutoff = new Date(Date.now() - SUPPLIER_NAME_CACHE_TTL_MS)
    try {
      const [historicalOffers, historicalSuppliers] = await Promise.all([
        offerIds.length
          ? this.offerRepository.find({
              where: {
                ownerUserId,
                provider: SOURCING_PROVIDER,
                offerId: In(offerIds),
                retrievedAt: MoreThanOrEqual(cutoff),
              },
              relations: { supplier: true },
              order: { retrievedAt: 'DESC' },
            })
          : [],
        openIds.length
          ? this.supplierRepository.find({
              where: {
                ownerUserId,
                provider: SOURCING_PROVIDER,
                openId: In(openIds),
                updatedAt: MoreThanOrEqual(cutoff),
              },
              order: { updatedAt: 'DESC' },
            })
          : [],
      ])
      const result = new Map<string, CachedSupplierIdentity>()
      for (const offer of historicalOffers) {
        if (
          offer.ownerUserId !== ownerUserId
          || offer.provider !== SOURCING_PROVIDER
          || !offer.retrievedAt
          || offer.retrievedAt < cutoff
        ) {
          continue
        }
        const identity = this.identity(offer.supplier, ownerUserId)
        if (!identity) continue
        this.setIfAbsent(result, `offer:${offer.offerId}`, identity)
        if (identity.openId) this.setIfAbsent(result, `open:${identity.openId}`, identity)
      }
      for (const supplier of historicalSuppliers) {
        if (
          supplier.ownerUserId !== ownerUserId
          || supplier.provider !== SOURCING_PROVIDER
          || !supplier.updatedAt
          || supplier.updatedAt < cutoff
        ) {
          continue
        }
        const identity = this.identity(supplier, ownerUserId)
        if (identity?.openId) this.setIfAbsent(result, `open:${identity.openId}`, identity)
      }
      return result
    } catch (error) {
      this.logger.warn(
        `1688 supplier name cache fallback owner=${ownerUserId}`
        + ` reason=${error instanceof Error ? error.message : 'unknown'}`,
      )
      return new Map()
    }
  }

  private identity(
    supplier: SourcingSupplierEntity | null,
    ownerUserId: string,
  ): CachedSupplierIdentity | null {
    if (!supplier || supplier.ownerUserId !== ownerUserId) return null
    const companyName = supplier.companyName?.trim() || supplier.shopName?.trim()
    if (!companyName) return null
    return {
      openId: supplier.openId,
      companyName,
      shopUrl: supplier.shopUrl,
    }
  }

  private setIfAbsent(
    cache: Map<string, CachedSupplierIdentity>,
    key: string,
    identity: CachedSupplierIdentity,
  ): void {
    if (!cache.has(key)) cache.set(key, identity)
  }
}
