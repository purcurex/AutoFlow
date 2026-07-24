import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateQuotationDto } from './quotation.dto'

function validPayload() {
  return {
    currency: 'USD',
    products: [{
      lineId: '8a389956-7a0e-45af-9459-a3ebbe871a34',
      productReference: 'SKU-001',
      unit: 'piece',
      productProfitMarginRate: 30,
      quantityTiers: [{
        minQuantity: 1,
        maxQuantity: 1,
        purchaseCost: '8.00',
        customerUnitPrice: '11.43',
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
  }
}

describe('quotation DTO', () => {
  it('accepts FOP purchase cost, product margin, and selected actual logistics channels', async () => {
    const errors = await validate(plainToInstance(CreateQuotationDto, validPayload()))
    expect(errors).toHaveLength(0)
  })

  it('rejects missing channels and invalid product or logistics margins', async () => {
    const payload = validPayload()
    payload.products[0].productProfitMarginRate = 100
    payload.logisticsChannels[0].logisticsProfitMarginRate = 100

    const errors = await validate(plainToInstance(CreateQuotationDto, payload))
    const properties = JSON.stringify(errors)
    expect(properties).toContain('productProfitMarginRate')
    expect(properties).toContain('logisticsProfitMarginRate')

    const withoutChannels = { ...validPayload(), logisticsChannels: [] }
    const channelErrors = await validate(plainToInstance(CreateQuotationDto, withoutChannels))
    expect(JSON.stringify(channelErrors)).toContain('logisticsChannels')
  })
})
