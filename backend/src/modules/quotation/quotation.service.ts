import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'
import { LeadEntity } from '../autoflow/entities'
import type { CreateQuotationDto, QuoteDraftDto } from './dto/quotation.dto'
import { QuotationEntity } from './entities/quotation.entity'
import { QuotationVersionEntity } from './entities/quotation-version.entity'
import type { QuoteRequestSnapshot } from './quotation.types'

@Injectable()
export class QuotationService {
  constructor(
    @InjectRepository(QuotationEntity)
    private readonly quotationRepository: Repository<QuotationEntity>,
    @InjectRepository(QuotationVersionEntity)
    private readonly versionRepository: Repository<QuotationVersionEntity>,
    @InjectRepository(LeadEntity)
    private readonly leadRepository: Repository<LeadEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async create(ownerUserId: string, dto: CreateQuotationDto) {
    this.validateDraft(dto)
    if (dto.leadId) await this.requireLead(ownerUserId, dto.leadId)

    const quotationId = await this.dataSource.transaction(async (manager) => {
      const quotationRepository = manager.getRepository(QuotationEntity)
      const versionRepository = manager.getRepository(QuotationVersionEntity)
      const quotation = await quotationRepository.save(quotationRepository.create({
        ownerUserId,
        leadId: dto.leadId || null,
        title: dto.title?.trim() || 'Customer quotation',
        status: 'draft',
        currency: dto.currency,
        currentVersion: 1,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
      }))
      await versionRepository.save(versionRepository.create({
        quotationId: quotation.id,
        version: 1,
        createdByUserId: ownerUserId,
        requestSnapshot: this.toSnapshot(dto),
        resultSnapshot: null,
        productCostStatus: 'not_requested',
        logisticsRateStatus: 'not_requested',
        sourceVersion: null,
        effectiveAt: null,
        expiresAt: null,
      }))
      return quotation.id
    })

    return this.get(ownerUserId, quotationId)
  }

  async createVersion(ownerUserId: string, quotationId: string, dto: QuoteDraftDto) {
    this.validateDraft(dto)
    await this.dataSource.transaction(async (manager) => {
      const quotationRepository = manager.getRepository(QuotationEntity)
      const versionRepository = manager.getRepository(QuotationVersionEntity)
      const quotation = await quotationRepository.createQueryBuilder('quotation')
        .setLock('pessimistic_write')
        .where('quotation.id = :quotationId', { quotationId })
        .andWhere('quotation.ownerUserId = :ownerUserId', { ownerUserId })
        .getOne()
      if (!quotation) throw new NotFoundException('Quotation not found')
      if (quotation.status === 'cancelled') throw new BadRequestException('Cancelled quotation cannot be revised')

      const nextVersion = quotation.currentVersion + 1
      await versionRepository.save(versionRepository.create({
        quotationId,
        version: nextVersion,
        createdByUserId: ownerUserId,
        requestSnapshot: this.toSnapshot(dto),
        resultSnapshot: null,
        productCostStatus: 'not_requested',
        logisticsRateStatus: 'not_requested',
        sourceVersion: null,
        effectiveAt: null,
        expiresAt: null,
      }))
      quotation.currentVersion = nextVersion
      quotation.currency = dto.currency
      quotation.status = 'draft'
      await quotationRepository.save(quotation)
    })

    return this.get(ownerUserId, quotationId)
  }

  async list(ownerUserId: string, leadId?: string) {
    if (leadId) await this.requireLead(ownerUserId, leadId)
    return this.quotationRepository.find({
      where: { ownerUserId, ...(leadId ? { leadId } : {}) },
      order: { updatedAt: 'DESC' },
    })
  }

  async get(ownerUserId: string, quotationId: string) {
    const quotation = await this.quotationRepository.findOne({
      where: { id: quotationId, ownerUserId },
    })
    if (!quotation) throw new NotFoundException('Quotation not found')
    const versions = await this.versionRepository.find({
      where: { quotationId },
      order: { version: 'DESC' },
    })
    return { ...quotation, versions }
  }

  private async requireLead(ownerUserId: string, leadId: string): Promise<void> {
    const exists = await this.leadRepository.exist({ where: { id: leadId, ownerUserId } })
    if (!exists) throw new NotFoundException('Lead not found')
  }

  private validateDraft(dto: QuoteDraftDto): void {
    for (const product of dto.products) {
      let previousMaximum = 0
      for (let index = 0; index < product.quantityTiers.length; index += 1) {
        const tier = product.quantityTiers[index]
        if (tier.maxQuantity !== undefined && tier.maxQuantity < tier.minQuantity) {
          throw new BadRequestException(`Product ${product.productReference} tier ${index + 1} has an invalid maximum`)
        }
        if (tier.minQuantity <= previousMaximum) {
          throw new BadRequestException(`Product ${product.productReference} quantity tiers overlap`)
        }
        if (index < product.quantityTiers.length - 1 && tier.maxQuantity === undefined) {
          throw new BadRequestException(`Only the final quantity tier may omit maxQuantity`)
        }
        previousMaximum = tier.maxQuantity || tier.minQuantity
      }
    }
  }

  private toSnapshot(dto: QuoteDraftDto): QuoteRequestSnapshot {
    return {
      currency: dto.currency,
      products: dto.products.map((product) => ({
        lineId: product.lineId,
        productReference: product.productReference.trim(),
        unit: product.unit.trim(),
        quantityTiers: product.quantityTiers.map((tier) => ({
          minQuantity: tier.minQuantity,
          ...(tier.maxQuantity === undefined ? {} : { maxQuantity: tier.maxQuantity }),
          customerUnitPrice: tier.customerUnitPrice,
        })),
      })),
      destinationCountries: [...dto.destinationCountries],
      packages: dto.packages.map((item) => ({ ...item })),
    }
  }
}
