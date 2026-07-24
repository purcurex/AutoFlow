import {
  SandboxFopCrmHandoffAdapter,
  SandboxFopLogisticsCatalogAdapter,
  SandboxFopLogisticsRateAdapter,
  SandboxFopProductCostAdapter,
} from './fop-sandbox.adapters'

describe('FOP sandbox contract reconciliation', () => {
  it('preserves product line, tiers, currency, source, and request identity', async () => {
    const result = await new SandboxFopProductCostAdapter().getProductCosts({
      idempotencyKey: 'quote-1-v1-product',
      correlationId: 'corr-1',
      currency: 'USD',
      pricingContext: { pricePolicyReference: 'standard-margin' },
      items: [{
        lineId: 'line-1',
        productReference: 'SKU-001',
        unit: 'piece',
        quantityTiers: [{ minQuantity: 1, maxQuantity: 99 }, { minQuantity: 100 }],
      }],
    })
    expect(result).toMatchObject({
      sourceVersion: 'sandbox-fixture-v1',
      pricingPolicyVersion: 'sandbox-pricing-policy-v1',
      currency: 'USD',
      items: [{ lineId: 'line-1', productReference: 'SKU-001' }],
    })
    expect(result.items[0].tiers).toHaveLength(2)
    expect(result.items[0].tiers.every((tier) => /^\d+\.\d{2}$/.test(tier.unitCost))).toBe(true)
    expect(result.items[0].tiers[0]).toMatchObject({
      pricePolicyReference: 'standard-margin',
      grossMarginRate: '0.2000',
      approvalStatus: 'not_required',
    })
    expect(result.items[0].tiers[0].suggestedCustomerUnitPrice).toMatch(/^\d+\.\d{2}$/)
    expect(result.warnings).toHaveLength(1)
  })

  it('returns one traceable channel set per requested destination', async () => {
    const result = await new SandboxFopLogisticsRateAdapter().getShippingRates({
      idempotencyKey: 'quote-1-v1-shipping',
      correlationId: 'corr-1',
      currency: 'USD',
      originReference: 'CN-WH-01',
      destinationCountries: ['US', 'GB'],
      packages: [{ quantity: 2, weight: 1.5, weightUnit: 'kg', length: 20, width: 15, height: 10, dimensionUnit: 'cm' }],
      productContext: [{ productReference: 'SKU-001', quantity: 2, unit: 'piece' }],
      selectedChannels: [
        {
          customChannelCode: 'SANDBOX-ECONOMY',
          customChannelName: 'Sandbox Economy',
          actualChannelCode: 'SANDBOX-POST',
          actualChannelName: 'Sandbox Postal Packet',
          logisticsProfitMarginRate: 20,
        },
        {
          customChannelCode: 'SANDBOX-EXPRESS',
          customChannelName: 'Sandbox Express',
          actualChannelCode: 'SANDBOX-EXPRESS-A',
          actualChannelName: 'Sandbox Express A',
          logisticsProfitMarginRate: 25,
        },
      ],
    })
    expect(result.sourceVersion).toBe('sandbox-fixture-v1')
    expect(result.destinations.map((item) => item.countryCode)).toEqual(['US', 'GB'])
    expect(result.destinations.every((item) => item.status === 'available')).toBe(true)
    expect(result.destinations.every((item) => item.options[0].chargeableWeight === 3)).toBe(true)
    expect(result.destinations.every((item) => item.options.length === 2)).toBe(true)
    expect(result.destinations[0].options[0]).toMatchObject({
      customChannelCode: 'SANDBOX-ECONOMY',
      channelCode: 'SANDBOX-POST',
      logisticsProfitMarginRate: 20,
    })
    expect(Number(result.destinations[0].options[0].customerFreightAmount))
      .toBeGreaterThan(Number(result.destinations[0].options[0].freightAmount))
    expect(result.warnings).toHaveLength(1)
  })

  it('supports two-level custom and actual logistics channel selection', async () => {
    const adapter = new SandboxFopLogisticsCatalogAdapter()
    const groups = await adapter.getCustomChannels()
    const channels = await adapter.getActualChannels(groups.channels[0].code)

    expect(groups.channels.map((item) => item.code)).toEqual([
      'SANDBOX-ECONOMY',
      'SANDBOX-EXPRESS',
    ])
    expect(channels.customChannelCode).toBe('SANDBOX-ECONOMY')
    expect(channels.channels.every((item) => item.customChannelCode === channels.customChannelCode)).toBe(true)
  })

  it('returns deterministic synthetic handoff identifiers', async () => {
    const result = await new SandboxFopCrmHandoffAdapter().handoffProspect({
      idempotencyKey: 'lead-1-handoff',
      correlationId: 'corr-1',
      autoFlowLeadId: '12345678-1111-2222-3333-444444444444',
      handoffReason: 'Qualified prospect',
    })
    expect(result).toMatchObject({ fopLeadId: 'sandbox-lead-12345678', syncStatus: 'succeeded', conflicts: [] })
  })
})
