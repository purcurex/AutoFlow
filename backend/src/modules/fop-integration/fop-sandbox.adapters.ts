import { ServiceUnavailableException } from '@nestjs/common'
import {
  FopCrmHandoffPort,
  FopLogisticsRatePort,
  FopProductCostPort,
  type ProductCostRequest,
  type ProductCostResult,
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
      effectiveAt: '2026-01-01T00:00:00.000Z',
      currency: request.currency,
      items: request.items.map((item) => ({
        lineId: item.lineId,
        productReference: item.productReference,
        tiers: item.quantityTiers.map((tier, index) => ({
          ...tier,
          unitCost: (8.5 - Math.min(index, 5) * 0.5).toFixed(2),
        })),
      })),
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
        options: [{
          channelCode: 'SANDBOX-STD',
          channelName: 'Sandbox Standard',
          chargeableWeight: totalWeight,
          freightAmount: (6 + totalWeight * 4 + countryIndex).toFixed(2),
          minTransitDays: 7,
          maxTransitDays: 12,
        }],
      })),
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

export class UnavailableFopCrmHandoffAdapter extends FopCrmHandoffPort {
  async handoffProspect(_request: ProspectHandoffRequest): Promise<ProspectHandoffResult> {
    throw new ServiceUnavailableException('FOP CRM handoff capability is unavailable')
  }
}
