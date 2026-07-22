import {
  SandboxFopCrmHandoffAdapter,
  SandboxFopLogisticsRateAdapter,
  SandboxFopProductCostAdapter,
} from './fop-sandbox.adapters'

describe('FOP sandbox contract reconciliation', () => {
  it('preserves product line, tiers, currency, source, and request identity', async () => {
    const result = await new SandboxFopProductCostAdapter().getProductCosts({
      idempotencyKey: 'quote-1-v1-product',
      correlationId: 'corr-1',
      currency: 'USD',
      items: [{
        lineId: 'line-1',
        productReference: 'SKU-001',
        unit: 'piece',
        quantityTiers: [{ minQuantity: 1, maxQuantity: 99 }, { minQuantity: 100 }],
      }],
    })
    expect(result).toMatchObject({
      sourceVersion: 'sandbox-fixture-v1',
      currency: 'USD',
      items: [{ lineId: 'line-1', productReference: 'SKU-001' }],
    })
    expect(result.items[0].tiers).toHaveLength(2)
    expect(result.items[0].tiers.every((tier) => /^\d+\.\d{2}$/.test(tier.unitCost))).toBe(true)
  })

  it('returns one traceable channel set per requested destination', async () => {
    const result = await new SandboxFopLogisticsRateAdapter().getShippingRates({
      idempotencyKey: 'quote-1-v1-shipping',
      correlationId: 'corr-1',
      currency: 'USD',
      destinationCountries: ['US', 'GB'],
      packages: [{ quantity: 2, weight: 1.5, weightUnit: 'kg', length: 20, width: 15, height: 10, dimensionUnit: 'cm' }],
    })
    expect(result.sourceVersion).toBe('sandbox-fixture-v1')
    expect(result.destinations.map((item) => item.countryCode)).toEqual(['US', 'GB'])
    expect(result.destinations.every((item) => item.options[0].chargeableWeight === 3)).toBe(true)
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
