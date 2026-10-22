jest.mock('../users/business-data-access', () => ({ readBusinessOwners: jest.fn(async (_dataSource, id) => ({ ids: [id], filter: id })) }))
import type { DataSource, Repository } from 'typeorm'
import type { LeadEntity } from '../autoflow/entities'
import type {
  FopLogisticsRatePort,
  FopProductCostPort,
} from '../fop-integration/fop-integration.types'
import type { QuotationEntity } from './entities/quotation.entity'
import type { QuotationVersionEntity } from './entities/quotation-version.entity'
import { QuotationService } from './quotation.service'
import { QuotationExcelExporter } from './quotation-excel.exporter'
import type { FopDataService } from '../fop-data/fop-data.service'

describe('QuotationService FOP pricing orchestration', () => {
  it('passes selected actual channels and persists product and logistics gross margins', async () => {
    const quotation = {
      id: 'quote-1',
      ownerUserId: 'owner-1',
      currentVersion: 1,
    } as QuotationEntity
    const version = {
      quotationId: quotation.id,
      version: 1,
      productCostStatus: 'not_requested',
      logisticsRateStatus: 'not_requested',
      requestSnapshot: {
        currency: 'USD',
        products: [{
          lineId: 'line-1',
          productReference: 'SKU-001',
          unit: 'piece',
          productProfitMarginRate: 20,
          quantityTiers: [{
            minQuantity: 1,
            maxQuantity: 1,
            purchaseCost: '8.00',
            customerUnitPrice: '10.00',
          }],
        }],
        destinationCountries: ['US'],
        packages: [{
          quantity: 1,
          weight: 1,
          weightUnit: 'kg',
          length: 20,
          width: 15,
          height: 10,
          dimensionUnit: 'cm',
        }],
        logisticsChannels: [{
          customChannelCode: 'ECONOMY',
          customChannelName: 'Economy',
          actualChannelCode: '4PX-US-STD',
          actualChannelName: '4PX US Standard',
          logisticsProfitMarginRate: 20,
        }],
      },
    } as QuotationVersionEntity
    const quotationRepository = {
      findOne: jest.fn().mockResolvedValue(quotation),
    } as unknown as Repository<QuotationEntity>
    const versionRepository = {
      findOne: jest.fn().mockResolvedValue(version),
      find: jest.fn().mockImplementation(async () => [version]),
      save: jest.fn().mockImplementation(async (value) => value),
    } as unknown as Repository<QuotationVersionEntity>
    const productCostPort = {
      getProductCosts: jest.fn().mockResolvedValue({
        provider: 'fop',
        externalRequestId: 'cost-1',
        sourceVersion: 'cost-v1',
        pricingPolicyVersion: 'policy-v1',
        effectiveAt: '2026-07-24T00:00:00.000Z',
        currency: 'USD',
        items: [{
          lineId: 'line-1',
          productReference: 'SKU-001',
          tiers: [{
            minQuantity: 1,
            maxQuantity: 1,
            unitCost: '8.00',
            suggestedCustomerUnitPrice: '9.00',
            costComponents: [],
            grossMarginRate: '0.1000',
            approvalStatus: 'not_required',
          }],
        }],
        warnings: [],
      }),
    } as unknown as FopProductCostPort
    const logisticsRatePort = {
      getShippingRates: jest.fn().mockResolvedValue({
        provider: 'fop',
        externalRequestId: 'rate-1',
        sourceVersion: 'rate-v1',
        effectiveAt: '2026-07-24T00:00:00.000Z',
        currency: 'USD',
        destinations: [{
          countryCode: 'US',
          status: 'available',
          options: [{
            customChannelCode: 'ECONOMY',
            customChannelName: 'Economy',
            channelCode: '4PX-US-STD',
            channelName: '4PX US Standard',
            chargeableWeight: 1,
            freightAmount: '8.00',
          }],
        }],
        warnings: [],
      }),
    } as unknown as FopLogisticsRatePort
    const service = new QuotationService(
      quotationRepository,
      versionRepository,
      {} as Repository<LeadEntity>,
      {} as DataSource,
      productCostPort,
      logisticsRatePort,
      new QuotationExcelExporter(),
      { requireResourcePermission: jest.fn().mockResolvedValue(undefined) } as unknown as FopDataService,
    )

    const result = await service.requestFopQuote('owner-1', quotation.id)
    const productRequest = (productCostPort.getProductCosts as jest.Mock).mock.calls[0][0]
    const logisticsRequest = (logisticsRatePort.getShippingRates as jest.Mock).mock.calls[0][0]
    const snapshot = version.resultSnapshot!
    const productResult = snapshot.productCost as unknown as {
      items: Array<{ tiers: Array<{ customerUnitPrice: string }> }>
    }
    const logisticsResult = snapshot.logisticsRates as unknown as {
      destinations: Array<{ options: Array<{ customerFreightAmount: string }> }>
    }

    expect(productRequest.items[0].productProfitMarginRate).toBe(20)
    expect(logisticsRequest.selectedChannels[0]).toMatchObject({
      actualChannelCode: '4PX-US-STD',
      logisticsProfitMarginRate: 20,
    })
    expect(productResult.items[0].tiers[0].customerUnitPrice).toBe('10.00')
    expect(logisticsResult.destinations[0].options[0].customerFreightAmount).toBe('10.00')
    expect(snapshot.combinedMatrix?.[0]).toMatchObject({
      customerProductUnitPrice: '10.00',
      customerFreightAmount: '10.00',
      combinedAmount: '20.00',
    })
    expect(result.versions[0].productCostStatus).toBe('succeeded')
    expect(result.versions[0].logisticsRateStatus).toBe('succeeded')
  })
})
