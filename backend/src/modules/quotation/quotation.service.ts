import { readBusinessOwners } from '../users/business-data-access'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'
import { LeadEntity } from '../autoflow/entities'
import {
  FopLogisticsRatePort,
  FopProductCostPort,
  type ProductCostResult,
  type ShippingRateResult,
} from '../fop-integration/fop-integration.types'
import type { CreateQuotationDto, QuoteDraftDto } from './dto/quotation.dto'
import { QuotationEntity } from './entities/quotation.entity'
import { QuotationVersionEntity } from './entities/quotation-version.entity'
import type { QuoteCombinedMatrixRow, QuoteRequestSnapshot } from './quotation.types'
import { QuotationExcelExporter } from './quotation-excel.exporter'
import { FopDataService } from '../fop-data/fop-data.service'

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
    private readonly productCostPort: FopProductCostPort,
    private readonly logisticsRatePort: FopLogisticsRatePort,
    private readonly excelExporter: QuotationExcelExporter,
    private readonly dataAccess: FopDataService,
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
    const owners = await readBusinessOwners(this.dataSource, ownerUserId)
    if (leadId) await this.requireReadableLead(ownerUserId, leadId)
    return this.quotationRepository.find({
      where: { ownerUserId: owners.filter, ...(leadId ? { leadId } : {}) },
      order: { updatedAt: 'DESC' },
    })
  }

  async get(ownerUserId: string, quotationId: string) {
    const owners = await readBusinessOwners(this.dataSource, ownerUserId)
    const quotation = await this.quotationRepository.findOne({
      where: { id: quotationId, ownerUserId: owners.filter },
    })
    if (!quotation) throw new NotFoundException('Quotation not found')
    const versions = await this.versionRepository.find({
      where: { quotationId },
      order: { version: 'DESC' },
    })
    return { ...quotation, versions }
  }

  async exportVersion(ownerUserId: string, quotationId: string, versionNumber: number): Promise<Buffer> {
    const owners = await readBusinessOwners(this.dataSource, ownerUserId)
    const quotation = await this.quotationRepository.findOne({
      where: { id: quotationId, ownerUserId: owners.filter },
    })
    if (!quotation) throw new NotFoundException('Quotation not found')
    const version = await this.versionRepository.findOne({
      where: { quotationId, version: versionNumber },
    })
    if (!version) throw new NotFoundException('Quotation version not found')
    return this.excelExporter.export(quotation, version)
  }

  async requestFopQuote(ownerUserId: string, quotationId: string) {
    const quotation = await this.quotationRepository.findOne({
      where: { id: quotationId, ownerUserId },
    })
    if (!quotation) throw new NotFoundException('Quotation not found')

    // Local ownership permits editing/reading the quote, not external FOP pricing.
    // Authorize before changing version statuses or invoking either provider port.
    await this.dataAccess.requireResourcePermission(ownerUserId)

    const version = await this.versionRepository.findOne({
      where: { quotationId, version: quotation.currentVersion },
    })
    if (!version) throw new NotFoundException('Quotation version not found')

    const snapshot = version.requestSnapshot
    if (!snapshot.logisticsChannels?.length) {
      throw new BadRequestException('At least one FOP actual logistics channel is required')
    }

    version.productCostStatus = 'pending'
    version.logisticsRateStatus = 'pending'
    version.resultSnapshot = null
    await this.versionRepository.save(version)

    const identity = `${quotation.id}-v${version.version}`
    const correlationId = `quote-${identity}`
    const [productOutcome, logisticsOutcome] = await Promise.allSettled([
      this.productCostPort.getProductCosts({
        idempotencyKey: `${identity}-product-cost`,
        correlationId,
        currency: snapshot.currency,
        items: snapshot.products.map((product) => ({
          lineId: product.lineId,
          productReference: product.productReference,
          unit: product.unit,
          productProfitMarginRate: product.productProfitMarginRate,
          quantityTiers: product.quantityTiers.map((tier) => ({
            minQuantity: tier.minQuantity,
            ...(tier.maxQuantity === undefined ? {} : { maxQuantity: tier.maxQuantity }),
          })),
        })),
      }),
      this.logisticsRatePort.getShippingRates({
        idempotencyKey: `${identity}-logistics-rate`,
        correlationId,
        currency: snapshot.currency,
        destinationCountries: snapshot.destinationCountries,
        packages: snapshot.packages,
        productContext: snapshot.products.map((product) => ({
          productReference: product.productReference,
          quantity: product.quantityTiers[0]?.minQuantity || 1,
          unit: product.unit,
        })),
        selectedChannels: snapshot.logisticsChannels,
      }),
    ])

    const productCost = productOutcome.status === 'fulfilled'
      ? this.applyProductMargins(productOutcome.value, snapshot)
      : undefined
    const logisticsRates = logisticsOutcome.status === 'fulfilled'
      ? this.applyLogisticsMargins(logisticsOutcome.value, snapshot)
      : undefined
    const providerErrors = {
      ...(productOutcome.status === 'rejected'
        ? { productCost: this.errorMessage(productOutcome.reason) }
        : {}),
      ...(logisticsOutcome.status === 'rejected'
        ? { logisticsRates: this.errorMessage(logisticsOutcome.reason) }
        : {}),
    }

    version.productCostStatus = productCost ? 'succeeded' : 'failed'
    version.logisticsRateStatus = logisticsRates ? 'succeeded' : 'failed'
    version.resultSnapshot = {
      ...(productCost ? { productCost: productCost as unknown as Record<string, unknown> } : {}),
      ...(logisticsRates ? { logisticsRates: logisticsRates as unknown as Record<string, unknown> } : {}),
      ...(Object.keys(providerErrors).length ? { providerErrors } : {}),
      combinedMatrix: this.buildCombinedMatrix(snapshot, productCost, logisticsRates),
    }
    version.sourceVersion = [productCost?.sourceVersion, logisticsRates?.sourceVersion]
      .filter(Boolean)
      .join(' | ') || null
    version.effectiveAt = this.latestDate(productCost?.effectiveAt, logisticsRates?.effectiveAt)
    version.expiresAt = this.earliestDate(productCost?.expiresAt, logisticsRates?.expiresAt)
    await this.versionRepository.save(version)

    return this.get(ownerUserId, quotationId)
  }

  private async requireReadableLead(ownerUserId: string, leadId: string): Promise<void> {
    const owners = await readBusinessOwners(this.dataSource, ownerUserId)
    if (!await this.leadRepository.exist({ where: { id: leadId, ownerUserId: owners.filter } })) throw new NotFoundException('Lead not found')
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
        productProfitMarginRate: product.productProfitMarginRate,
        quantityTiers: product.quantityTiers.map((tier) => ({
          minQuantity: tier.minQuantity,
          ...(tier.maxQuantity === undefined ? {} : { maxQuantity: tier.maxQuantity }),
          customerUnitPrice: tier.customerUnitPrice,
          ...(tier.purchaseCost === undefined ? {} : { purchaseCost: tier.purchaseCost }),
        })),
      })),
      destinationCountries: [...dto.destinationCountries],
      packages: dto.packages.map((item) => ({ ...item })),
      logisticsChannels: dto.logisticsChannels.map((channel) => ({
        customChannelCode: channel.customChannelCode.trim(),
        customChannelName: channel.customChannelName.trim(),
        actualChannelCode: channel.actualChannelCode.trim(),
        actualChannelName: channel.actualChannelName.trim(),
        ...(channel.carrierName?.trim() ? { carrierName: channel.carrierName.trim() } : {}),
        logisticsProfitMarginRate: channel.logisticsProfitMarginRate,
      })),
    }
  }

  private applyProductMargins(
    result: ProductCostResult,
    snapshot: QuoteRequestSnapshot,
  ): ProductCostResult {
    return {
      ...result,
      items: result.items.map((item) => {
        const product = snapshot.products.find((candidate) => candidate.lineId === item.lineId)
        const marginRate = product?.productProfitMarginRate ?? 0
        return {
          ...item,
          tiers: item.tiers.map((tier) => ({
            ...tier,
            appliedProfitMarginRate: marginRate,
            grossMarginRate: (marginRate / 100).toFixed(4),
            customerUnitPrice: this.amountWithMargin(tier.unitCost, marginRate),
          })),
        }
      }),
    }
  }

  private applyLogisticsMargins(
    result: ShippingRateResult,
    snapshot: QuoteRequestSnapshot,
  ): ShippingRateResult {
    return {
      ...result,
      destinations: result.destinations.map((destination) => ({
        ...destination,
        options: destination.options.map((option) => {
          const selected = snapshot.logisticsChannels.find((channel) =>
            channel.customChannelCode === option.customChannelCode
            && channel.actualChannelCode === option.channelCode)
          const marginRate = selected?.logisticsProfitMarginRate ?? 0
          return {
            ...option,
            customChannelName: selected?.customChannelName || option.customChannelName,
            channelName: selected?.actualChannelName || option.channelName,
            logisticsProfitMarginRate: marginRate,
            customerFreightAmount: this.amountWithMargin(option.freightAmount, marginRate),
          }
        }),
      })),
    }
  }

  private buildCombinedMatrix(
    snapshot: QuoteRequestSnapshot,
    productCost?: ProductCostResult,
    logisticsRates?: ShippingRateResult,
  ): QuoteCombinedMatrixRow[] {
    return snapshot.products.flatMap((product) =>
      product.quantityTiers.flatMap((tier) =>
        snapshot.destinationCountries.flatMap((countryCode) =>
          snapshot.logisticsChannels.map((channel) => {
            const costTier = productCost?.items
              .find((item) => item.lineId === product.lineId)?.tiers
              .find((item) =>
                item.minQuantity === tier.minQuantity
                && item.maxQuantity === tier.maxQuantity)
            const freight = logisticsRates?.destinations
              .find((destination) => destination.countryCode === countryCode)?.options
              .find((option) =>
                option.customChannelCode === channel.customChannelCode
                && option.channelCode === channel.actualChannelCode)
            const customerProductAmount = costTier?.customerUnitPrice || tier.customerUnitPrice
            const customerFreightAmount = freight?.customerFreightAmount
            return {
              lineId: product.lineId,
              productReference: product.productReference,
              minQuantity: tier.minQuantity,
              ...(tier.maxQuantity === undefined ? {} : { maxQuantity: tier.maxQuantity }),
              countryCode,
              customChannelCode: channel.customChannelCode,
              actualChannelCode: channel.actualChannelCode,
              productProfitMarginRate: product.productProfitMarginRate,
              logisticsProfitMarginRate: channel.logisticsProfitMarginRate,
              purchaseCost: costTier?.unitCost || tier.purchaseCost || null,
              customerProductUnitPrice: customerProductAmount,
              baseFreightAmount: freight?.freightAmount || null,
              customerFreightAmount: customerFreightAmount || null,
              combinedAmount: customerFreightAmount
                ? (Number(customerProductAmount) * tier.minQuantity + Number(customerFreightAmount)).toFixed(2)
                : null,
              currency: snapshot.currency,
            }
          }),
        ),
      ),
    )
  }

  private amountWithMargin(amount: string, marginRate: number): string {
    return (Number(amount) / (1 - marginRate / 100)).toFixed(2)
  }

  private latestDate(...values: Array<string | undefined>): Date | null {
    const timestamps = values.filter(Boolean).map((value) => new Date(value!).getTime())
    return timestamps.length ? new Date(Math.max(...timestamps)) : null
  }

  private earliestDate(...values: Array<string | undefined>): Date | null {
    const timestamps = values.filter(Boolean).map((value) => new Date(value!).getTime())
    return timestamps.length ? new Date(Math.min(...timestamps)) : null
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown FOP integration error'
  }
}
