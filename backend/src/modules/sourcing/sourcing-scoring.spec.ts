import { calculateSourcingScore } from './sourcing-scoring'

describe('calculateSourcingScore', () => {
  it('scores a relevant dropshipping-friendly offer independently from lead confidence', () => {
    const result = calculateSourcingScore({
      query: 'portable pet hair remover',
      title: 'Portable reusable pet hair remover roller',
      priceRanges: [
        { minimumQuantity: 1, price: 2.8 },
        { minimumQuantity: 100, price: 2.2 },
      ],
      targetPriceMin: 2,
      targetPriceMax: 4,
      minimumOrderQuantity: 1,
      sellerCompositeScore: 92,
      sellerTradeScore: 88,
      sellerYears: 6,
      repeatPurchasePercent: 48,
      deliveryReadinessPercent: 91,
      supportsCustomization: true,
      isVerifiedSupplier: true,
    })

    expect(result.score).toBeGreaterThanOrEqual(80)
    expect(result.dimensions.relevance).toBe(35)
    expect(result.reasons).toContain('dropshipping_friendly_moq')
  })

  it('falls back to provider rank for image searches without a textual match', () => {
    const result = calculateSourcingScore({
      query: '',
      title: 'Unknown offer title',
      providerRank: 1,
      priceRanges: [{ price: 10 }],
      minimumOrderQuantity: 500,
    })

    expect(result.dimensions.relevance).toBe(35)
    expect(result.dimensions.minimumOrderQuantity).toBe(2)
  })

  it('does not award reliability, delivery, or price points when evidence is absent', () => {
    const result = calculateSourcingScore({
      query: 'wireless charger',
      title: 'Generic product',
    })

    expect(result.dimensions.pricing).toBe(0)
    expect(result.dimensions.supplierReliability).toBe(0)
    expect(result.dimensions.delivery).toBe(0)
    expect(result.score).toBe(0)
  })
})
