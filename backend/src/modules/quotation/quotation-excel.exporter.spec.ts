import * as ExcelJS from 'exceljs'
import type { QuotationEntity } from './entities/quotation.entity'
import type { QuotationVersionEntity } from './entities/quotation-version.entity'
import { QuotationExcelExporter } from './quotation-excel.exporter'

describe('QuotationExcelExporter', () => {
  it('creates a styled, versioned quotation workbook from the persisted matrix', async () => {
    const quotation = {
      id: '9a81cd60-a9e7-4267-9db8-b593332afe85',
      title: 'Pet Hair Remover Quotation',
      createdAt: new Date('2026-07-24T08:00:00.000Z'),
    } as QuotationEntity
    const version = {
      version: 3,
      createdAt: new Date('2026-07-24T09:00:00.000Z'),
      sourceVersion: 'fop-cost-v2 | fop-rate-v5',
      requestSnapshot: {
        currency: 'USD',
        products: [{
          lineId: 'line-1',
          productReference: 'SKU-PET-001',
          unit: 'piece',
          productProfitMarginRate: 20,
          quantityTiers: [{
            minQuantity: 1,
            maxQuantity: 99,
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
          customChannelName: 'Economy Line',
          actualChannelCode: '4PX-US-STD',
          actualChannelName: '4PX US Standard',
          carrierName: '4PX',
          logisticsProfitMarginRate: 20,
        }],
      },
      resultSnapshot: {
        combinedMatrix: [{
          lineId: 'line-1',
          productReference: 'SKU-PET-001',
          minQuantity: 1,
          maxQuantity: 99,
          countryCode: 'US',
          customChannelCode: 'ECONOMY',
          actualChannelCode: '4PX-US-STD',
          productProfitMarginRate: 20,
          logisticsProfitMarginRate: 20,
          purchaseCost: '8.00',
          customerProductUnitPrice: '10.00',
          baseFreightAmount: '8.00',
          customerFreightAmount: '10.00',
          combinedAmount: '20.00',
          currency: 'USD',
        }],
      },
    } as QuotationVersionEntity

    const buffer = await new QuotationExcelExporter().export(quotation, version)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as never)
    const worksheet = workbook.getWorksheet('Quotation')!

    expect(buffer.length).toBeGreaterThan(10_000)
    expect(worksheet.getCell('B1').value).toContain('AUTOFLOW QUOTATION')
    expect(worksheet.getCell('A2').value).toContain('Prices are presented by quantity tier')
    expect(worksheet.getCell('F3').value).toBe('采购成本')
    expect(worksheet.getCell('A4').isMerged).toBe(false)
    expect(worksheet.getCell('B4').value).toBe('Pet Hair Remover Quotation')
    expect(worksheet.getCell('C4').value).toBe('SKU-PET-001')
    expect(worksheet.getCell('J4').value).toBe('Economy Line')
    expect(worksheet.getCell('L4').value).toBe('4PX')
    expect(worksheet.getCell('M4').value).toBe('US')
    expect(worksheet.getCell('P4').value).toBe(20)
    expect(worksheet.getCell('P4').numFmt).toBe('#,##0.00')
    expect(worksheet.getCell('H4').numFmt).toBe('0.00%')
    expect(worksheet.pageSetup.orientation).toBe('landscape')
    expect(worksheet.pageSetup.paperSize).toBe(8)
    expect(worksheet.pageSetup.fitToWidth).toBe(1)
    expect(worksheet.getImages()).toHaveLength(1)
  })

  it('exports a saved draft before FOP results exist', async () => {
    const quotation = {
      id: '43dd6b94-1cf2-4a88-9c9b-2bcac1cd9bc1',
      title: 'Manual Draft',
      createdAt: new Date(),
    } as QuotationEntity
    const version = {
      version: 1,
      createdAt: new Date(),
      sourceVersion: null,
      resultSnapshot: null,
      requestSnapshot: {
        currency: 'USD',
        products: [{
          lineId: 'line-1',
          productReference: 'SKU-001',
          unit: 'piece',
          productProfitMarginRate: 20,
          quantityTiers: [{ minQuantity: 1, maxQuantity: 1, customerUnitPrice: '12.50' }],
        }],
        destinationCountries: ['CA'],
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
          customChannelCode: 'FAST',
          customChannelName: 'Fast Line',
          actualChannelCode: 'DHL-CA',
          actualChannelName: 'DHL Canada',
          logisticsProfitMarginRate: 15,
        }],
      },
    } as QuotationVersionEntity

    const buffer = await new QuotationExcelExporter().export(quotation, version)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as never)
    const worksheet = workbook.getWorksheet('Quotation')!

    expect(worksheet.getCell('M4').value).toBe('CA')
    expect(worksheet.getCell('N4').value).toBe(12.5)
    expect(worksheet.getCell('O4').value).toBeNull()
    expect(worksheet.getCell('P4').value).toBeNull()
  })
})
