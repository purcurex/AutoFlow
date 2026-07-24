import { ServiceUnavailableException } from '@nestjs/common'
import {
  FopCrmHandoffPort,
  FopLogisticsCatalogPort,
  FopLogisticsRatePort,
  FopProductCostPort,
  type ProductCostRequest,
  type ProductCostResult,
  type FopActualLogisticsChannelResult,
  type FopCustomLogisticsChannelResult,
  type ProspectHandoffRequest,
  type ProspectHandoffResult,
  type ShippingRateRequest,
  type ShippingRateResult,
} from './fop-integration.types'

export class SandboxFopProductCostAdapter extends FopProductCostPort {
  async getProductCosts(request: ProductCostRequest): Promise<ProductCostResult> {
    return {
      provider: 'fop',
      externalRequestId: `sandbox-product-${request.idempotencyKey}`,
      sourceVersion: 'sandbox-fixture-v1',
      pricingPolicyVersion: 'sandbox-pricing-policy-v1',
      effectiveAt: '2026-01-01T00:00:00.000Z',
      currency: request.currency,
      items: request.items.map((item) => ({
        lineId: item.lineId,
        productReference: item.productReference,
        tiers: item.quantityTiers.map((tier, index) => {
          const unitCost = 8.5 - Math.min(index, 5) * 0.5
          const profitMarginRate = item.productProfitMarginRate ?? 20
          const customerUnitPrice = unitCost / (1 - profitMarginRate / 100)
          return {
            ...tier,
            unitCost: unitCost.toFixed(2),
            suggestedCustomerUnitPrice: customerUnitPrice.toFixed(2),
            costComponents: [{ code: 'purchase_cost', name: 'Synthetic purchase cost', amount: unitCost.toFixed(2) }],
            grossMarginRate: (profitMarginRate / 100).toFixed(4),
            appliedProfitMarginRate: profitMarginRate,
            customerUnitPrice: customerUnitPrice.toFixed(2),
            pricePolicyReference: request.pricingContext?.pricePolicyReference || 'sandbox-standard-margin',
            approvalStatus: 'not_required' as const,
          }
        }),
      })),
      warnings: ['Synthetic sandbox pricing. Do not use for customer commitments.'],
    }
  }
}

export class SandboxFopLogisticsCatalogAdapter extends FopLogisticsCatalogPort {
  async getCustomChannels(): Promise<FopCustomLogisticsChannelResult> {
    return {
      provider: 'fop',
      sourceVersion: 'sandbox-fixture-v1',
      effectiveAt: '2026-01-01T00:00:00.000Z',
      channels: [
        { code: 'SANDBOX-ECONOMY', name: 'Sandbox Economy', enabled: true, sortOrder: 10 },
        { code: 'SANDBOX-EXPRESS', name: 'Sandbox Express', enabled: true, sortOrder: 20 },
      ],
      warnings: ['Synthetic sandbox channel catalog. Do not use for customer commitments.'],
    }
  }

  async getActualChannels(customChannelCode: string): Promise<FopActualLogisticsChannelResult> {
    const channelMap: Record<string, FopActualLogisticsChannelResult['channels']> = {
      'SANDBOX-ECONOMY': [
        {
          customChannelCode,
          code: 'SANDBOX-POST',
          name: 'Sandbox Postal Packet',
          enabled: true,
          carrierName: 'Sandbox Post',
          serviceLevel: 'economy',
          supportedCountries: ['US', 'GB', 'DE', 'FR', 'CA', 'AU'],
        },
        {
          customChannelCode,
          code: 'SANDBOX-LINE',
          name: 'Sandbox Dedicated Line',
          enabled: true,
          carrierName: 'Sandbox Logistics',
          serviceLevel: 'standard',
          supportedCountries: ['US', 'GB', 'DE', 'FR'],
        },
      ],
      'SANDBOX-EXPRESS': [{
        customChannelCode,
        code: 'SANDBOX-EXPRESS-A',
        name: 'Sandbox Express A',
        enabled: true,
        carrierName: 'Sandbox Express',
        serviceLevel: 'express',
        supportedCountries: ['US', 'GB', 'DE', 'FR', 'CA', 'AU'],
      }],
    }
    return {
      provider: 'fop',
      sourceVersion: 'sandbox-fixture-v1',
      effectiveAt: '2026-01-01T00:00:00.000Z',
      customChannelCode,
      channels: channelMap[customChannelCode] || [],
      warnings: ['Synthetic sandbox channel catalog. Do not use for customer commitments.'],
    }
  }
}

export class SandboxFopLogisticsRateAdapter extends FopLogisticsRatePort {
  async getShippingRates(request: ShippingRateRequest): Promise<ShippingRateResult> {
    const totalWeight = request.packages.reduce((sum, item) => sum + item.quantity * item.weight, 0)
    return {
      provider: 'fop',
      externalRequestId: `sandbox-shipping-${request.idempotencyKey}`,
      sourceVersion: 'sandbox-fixture-v1',
      effectiveAt: '2026-01-01T00:00:00.000Z',
      currency: request.currency,
      destinations: request.destinationCountries.map((countryCode, countryIndex) => ({
        countryCode,
        status: 'available',
        options: request.selectedChannels.map((channel, channelIndex) => {
          const freightAmount = 6 + totalWeight * 4 + countryIndex + channelIndex
          const customerFreightAmount = freightAmount / (1 - channel.logisticsProfitMarginRate / 100)
          return {
            customChannelCode: channel.customChannelCode,
            customChannelName: channel.customChannelName,
            channelCode: channel.actualChannelCode,
            channelName: channel.actualChannelName,
            chargeableWeight: totalWeight,
            freightAmount: freightAmount.toFixed(2),
            logisticsProfitMarginRate: channel.logisticsProfitMarginRate,
            customerFreightAmount: customerFreightAmount.toFixed(2),
            returnedFees: [],
            minTransitDays: 7,
            maxTransitDays: 12,
            restrictions: [],
          }
        }),
      })),
      warnings: ['Synthetic sandbox freight. Do not use for customer commitments.'],
    }
  }
}

export class SandboxFopCrmHandoffAdapter extends FopCrmHandoffPort {
  async handoffProspect(request: ProspectHandoffRequest): Promise<ProspectHandoffResult> {
    return {
      fopLeadId: `sandbox-lead-${request.autoFlowLeadId.slice(0, 8)}`,
      syncStatus: 'succeeded',
      conflicts: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
  }
}

export class UnavailableFopProductCostAdapter extends FopProductCostPort {
  async getProductCosts(_request: ProductCostRequest): Promise<ProductCostResult> {
    throw new ServiceUnavailableException('FOP product-cost capability is unavailable')
  }
}

export class UnavailableFopLogisticsRateAdapter extends FopLogisticsRatePort {
  async getShippingRates(_request: ShippingRateRequest): Promise<ShippingRateResult> {
    throw new ServiceUnavailableException('FOP logistics-rate capability is unavailable')
  }
}

export class UnavailableFopLogisticsCatalogAdapter extends FopLogisticsCatalogPort {
  async getCustomChannels(): Promise<FopCustomLogisticsChannelResult> {
    throw new ServiceUnavailableException('FOP logistics-channel catalog is unavailable')
  }

  async getActualChannels(_customChannelCode: string): Promise<FopActualLogisticsChannelResult> {
    throw new ServiceUnavailableException('FOP logistics-channel catalog is unavailable')
  }
}

export class UnavailableFopCrmHandoffAdapter extends FopCrmHandoffPort {
  async handoffProspect(_request: ProspectHandoffRequest): Promise<ProspectHandoffResult> {
    throw new ServiceUnavailableException('FOP CRM handoff capability is unavailable')
  }
}
