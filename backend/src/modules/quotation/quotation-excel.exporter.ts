import { existsSync } from 'fs'
import { join } from 'path'
import { Injectable } from '@nestjs/common'
import * as ExcelJS from 'exceljs'
import type { QuotationEntity } from './entities/quotation.entity'
import type { QuotationVersionEntity } from './entities/quotation-version.entity'
import type { QuoteCombinedMatrixRow, QuoteRequestSnapshot } from './quotation.types'

const HEADER_FILL = 'FF00A9D8'
const HEADER_TEXT = 'FFFFFFFF'
const BRAND_ORANGE = 'FFF15A0A'
const BORDER_COLOR = 'FFD6DEE8'
const INTERNAL_FILL = 'FFFFF4D6'
const TOTAL_FILL = 'FFE8EDFF'
const MUTED_FILL = 'FFF5F7FA'
const BODY_TEXT = 'FF172033'
const MUTED_TEXT = 'FF64748B'

interface ExportRow extends QuoteCombinedMatrixRow {
  productName: string
  unit: string
  customChannelName: string
  actualChannelName: string
  carrierName: string
}

@Injectable()
export class QuotationExcelExporter {
  async export(
    quotation: QuotationEntity,
    version: QuotationVersionEntity,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'AutoFlow by HyperZone'
    workbook.company = 'HyperZone'
    workbook.subject = `Quotation ${quotation.id} version ${version.version}`
    workbook.title = quotation.title
    workbook.created = version.createdAt || quotation.createdAt || new Date()
    workbook.modified = new Date()

    const worksheet = workbook.addWorksheet('Quotation', {
      properties: { defaultRowHeight: 22 },
      pageSetup: {
        orientation: 'landscape',
        paperSize: 8 as ExcelJS.PaperSize,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        margins: {
          left: 0.25,
          right: 0.25,
          top: 0.35,
          bottom: 0.35,
          header: 0.15,
          footer: 0.15,
        },
      },
      views: [{ state: 'frozen', ySplit: 3, zoomScale: 90 }],
    })

    worksheet.columns = [
      { key: 'product', width: 16 },
      { key: 'productName', width: 26 },
      { key: 'sku', width: 20 },
      { key: 'quantityTier', width: 15 },
      { key: 'unit', width: 11 },
      { key: 'purchaseCost', width: 14 },
      { key: 'baseFreight', width: 14 },
      { key: 'productMargin', width: 14 },
      { key: 'freightMargin', width: 14 },
      { key: 'customChannel', width: 20 },
      { key: 'actualChannel', width: 24 },
      { key: 'carrier', width: 16 },
      { key: 'country', width: 11 },
      { key: 'productPrice', width: 16 },
      { key: 'shipping', width: 15 },
      { key: 'totalPrice', width: 17 },
      { key: 'currency', width: 10 },
    ]

    this.writeBrandHeader(worksheet, quotation, version)
    this.writeHeaders(worksheet)

    const rows = this.buildRows(quotation, version.requestSnapshot, version.resultSnapshot?.combinedMatrix)
    this.writeRows(worksheet, rows, version.requestSnapshot.currency)
    this.writeFooter(worksheet, rows.length + 4, quotation, version)

    worksheet.autoFilter = {
      from: { row: 3, column: 2 },
      to: { row: Math.max(3, rows.length + 3), column: 17 },
    }
    worksheet.pageSetup.printArea = `A1:Q${Math.max(7, rows.length + 5)}`
    worksheet.pageSetup.printTitlesRow = '1:3'
    worksheet.headerFooter.oddFooter = '&LAutoFlow / HyperZone&CPage &P of &N&RConfidential quotation'

    const output = await workbook.xlsx.writeBuffer()
    return Buffer.from(output)
  }

  private writeBrandHeader(
    worksheet: ExcelJS.Worksheet,
    quotation: QuotationEntity,
    version: QuotationVersionEntity,
  ): void {
    worksheet.mergeCells('B1:J1')
    worksheet.mergeCells('K1:Q1')
    worksheet.getRow(1).height = 62

    const titleCell = worksheet.getCell('B1')
    titleCell.value = `AUTOFLOW QUOTATION\n${quotation.title}`
    titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: BODY_TEXT } }
    titleCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 }
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }

    const brandCell = worksheet.getCell('K1')
    brandCell.value = `HYPERZONE\nVersion ${version.version}`
    brandCell.font = { name: 'Arial', size: 13, bold: true, color: { argb: BRAND_ORANGE } }
    brandCell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true }

    const logoPath = this.resolveLogoPath()
    if (logoPath) {
      const logoId = worksheet.workbook.addImage({ filename: logoPath, extension: 'png' })
      worksheet.addImage(logoId, {
        tl: { col: 0.18, row: 0.18 },
        ext: { width: 52, height: 38 },
        editAs: 'oneCell',
      })
    }

    worksheet.mergeCells('A2:Q2')
    worksheet.getRow(2).height = 78
    const notesCell = worksheet.getCell('A2')
    notesCell.value = [
      '1. Prices are presented by quantity tier, destination, and selected logistics channel.',
      '2. Total price = product amount at the tier minimum quantity + customer shipping.',
      '3. Transit time, customs duties, taxes, and destination surcharges are excluded unless stated separately.',
      '4. Internal cost and margin columns are included for quotation review. Remove them before sharing externally.',
    ].join('\n')
    notesCell.font = { name: 'Arial', size: 10, color: { argb: BODY_TEXT } }
    notesCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 }
    notesCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MUTED_FILL } }
    notesCell.border = {
      top: { style: 'thin', color: { argb: BORDER_COLOR } },
      bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
    }
  }

  private writeHeaders(worksheet: ExcelJS.Worksheet): void {
    const headers = [
      'Product',
      '产品名称',
      'SKU',
      '数量阶梯',
      '单位',
      '采购成本',
      'FOP 运费',
      '产品毛利率',
      '物流毛利率',
      '自定义物流渠道',
      '实际物流渠道',
      'Carrier',
      'Country',
      'Product Price',
      'Shipping',
      'Total Price',
      'Currency',
    ]
    const row = worksheet.getRow(3)
    row.height = 30
    headers.forEach((header, index) => {
      const cell = row.getCell(index + 1)
      cell.value = header
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: HEADER_TEXT } }
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
      cell.border = this.thinBorder()
    })
  }

  private writeRows(
    worksheet: ExcelJS.Worksheet,
    rows: ExportRow[],
    defaultCurrency: string,
  ): void {
    if (!rows.length) {
      worksheet.mergeCells('A4:Q6')
      const emptyCell = worksheet.getCell('A4')
      emptyCell.value = 'No quotation matrix is available for this version.'
      emptyCell.font = { name: 'Arial', size: 12, color: { argb: MUTED_TEXT } }
      emptyCell.alignment = { vertical: 'middle', horizontal: 'center' }
      emptyCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MUTED_FILL } }
      return
    }

    rows.forEach((item, index) => {
      const row = worksheet.getRow(index + 4)
      row.height = 34
      const quantityTier = item.maxQuantity === undefined
        ? `${item.minQuantity}+`
        : `${item.minQuantity} - ${item.maxQuantity}`
      const values: Array<string | number | null> = [
        index === 0 ? 'Product\nimage not attached' : '',
        item.productName,
        item.productReference,
        quantityTier,
        item.unit,
        this.money(item.purchaseCost),
        this.money(item.baseFreightAmount),
        item.productProfitMarginRate / 100,
        item.logisticsProfitMarginRate / 100,
        item.customChannelName,
        item.actualChannelName,
        item.carrierName,
        item.countryCode,
        this.money(item.customerProductUnitPrice),
        this.money(item.customerFreightAmount),
        this.money(item.combinedAmount),
        item.currency || defaultCurrency,
      ]

      values.forEach((value, columnIndex) => {
        const cell = row.getCell(columnIndex + 1)
        cell.value = value
        cell.font = { name: 'Arial', size: 10, color: { argb: BODY_TEXT } }
        cell.alignment = {
          vertical: 'middle',
          horizontal: columnIndex >= 5 && columnIndex <= 8 ? 'right' : 'left',
          wrapText: true,
        }
        cell.border = this.thinBorder()
        if (columnIndex >= 5 && columnIndex <= 8) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INTERNAL_FILL } }
        }
        if (columnIndex === 15) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } }
          cell.font = { ...cell.font, bold: true }
        }
      })

      for (const columnIndex of [6, 7, 14, 15, 16]) {
        row.getCell(columnIndex).numFmt = '#,##0.00'
      }
      for (const columnIndex of [8, 9]) {
        row.getCell(columnIndex).numFmt = '0.00%'
      }
    })

    const productGroups = this.productGroups(rows)
    for (const group of productGroups) {
      if (group.endRow > group.startRow) {
        worksheet.mergeCells(group.startRow, 1, group.endRow, 1)
      }
      const productCell = worksheet.getCell(group.startRow, 1)
      productCell.value = 'Product\nimage not attached'
      productCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      productCell.font = { name: 'Arial', size: 9, italic: true, color: { argb: MUTED_TEXT } }
      productCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MUTED_FILL } }
    }
  }

  private writeFooter(
    worksheet: ExcelJS.Worksheet,
    rowNumber: number,
    quotation: QuotationEntity,
    version: QuotationVersionEntity,
  ): void {
    worksheet.mergeCells(rowNumber, 1, rowNumber, 12)
    worksheet.mergeCells(rowNumber, 13, rowNumber, 17)
    const metadata = worksheet.getCell(rowNumber, 1)
    metadata.value = `Quote ID: ${quotation.id}  |  Version: ${version.version}  |  Source: ${version.sourceVersion || 'Manual draft'}`
    metadata.font = { name: 'Arial', size: 9, color: { argb: MUTED_TEXT } }
    metadata.alignment = { vertical: 'middle', horizontal: 'left' }
    const generated = worksheet.getCell(rowNumber, 13)
    generated.value = `Generated: ${new Date().toISOString().slice(0, 10)}`
    generated.font = { name: 'Arial', size: 9, color: { argb: MUTED_TEXT } }
    generated.alignment = { vertical: 'middle', horizontal: 'right' }
  }

  private buildRows(
    quotation: QuotationEntity,
    snapshot: QuoteRequestSnapshot,
    resultRows?: QuoteCombinedMatrixRow[],
  ): ExportRow[] {
    const matrix = resultRows?.length ? resultRows : this.fallbackMatrix(snapshot)
    return matrix.map((row) => {
      const product = snapshot.products.find((item) => item.lineId === row.lineId)
      const channel = snapshot.logisticsChannels.find((item) =>
        item.customChannelCode === row.customChannelCode
        && item.actualChannelCode === row.actualChannelCode)
      return {
        ...row,
        productName: snapshot.products.length === 1
          ? quotation.title
          : product?.productReference || row.productReference,
        unit: product?.unit || '',
        customChannelName: channel?.customChannelName || row.customChannelCode,
        actualChannelName: channel?.actualChannelName || row.actualChannelCode,
        carrierName: channel?.carrierName || '',
      }
    })
  }

  private fallbackMatrix(snapshot: QuoteRequestSnapshot): QuoteCombinedMatrixRow[] {
    return snapshot.products.flatMap((product) =>
      product.quantityTiers.flatMap((tier) =>
        snapshot.destinationCountries.flatMap((countryCode) =>
          snapshot.logisticsChannels.map((channel) => ({
            lineId: product.lineId,
            productReference: product.productReference,
            minQuantity: tier.minQuantity,
            ...(tier.maxQuantity === undefined ? {} : { maxQuantity: tier.maxQuantity }),
            countryCode,
            customChannelCode: channel.customChannelCode,
            actualChannelCode: channel.actualChannelCode,
            productProfitMarginRate: product.productProfitMarginRate,
            logisticsProfitMarginRate: channel.logisticsProfitMarginRate,
            purchaseCost: tier.purchaseCost || null,
            customerProductUnitPrice: tier.customerUnitPrice,
            baseFreightAmount: null,
            customerFreightAmount: null,
            combinedAmount: null,
            currency: snapshot.currency,
          })),
        ),
      ),
    )
  }

  private productGroups(rows: ExportRow[]): Array<{ startRow: number; endRow: number }> {
    const groups: Array<{ startRow: number; endRow: number }> = []
    let startIndex = 0
    for (let index = 1; index <= rows.length; index += 1) {
      if (index === rows.length || rows[index].lineId !== rows[startIndex].lineId) {
        groups.push({ startRow: startIndex + 4, endRow: index + 3 })
        startIndex = index
      }
    }
    return groups
  }

  private money(value: string | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null
    const amount = Number(value)
    return Number.isFinite(amount) ? amount : null
  }

  private resolveLogoPath(): string | null {
    const candidates = [
      join(__dirname, 'assets', 'hyperzone-logo.png'),
      join(process.cwd(), 'src', 'modules', 'quotation', 'assets', 'hyperzone-logo.png'),
      join(process.cwd(), 'dist', 'modules', 'quotation', 'assets', 'hyperzone-logo.png'),
      join(process.cwd(), 'backend', 'src', 'modules', 'quotation', 'assets', 'hyperzone-logo.png'),
      join(process.cwd(), 'backend', 'dist', 'modules', 'quotation', 'assets', 'hyperzone-logo.png'),
    ]
    return candidates.find((candidate) => existsSync(candidate)) || null
  }

  private thinBorder(): Partial<ExcelJS.Borders> {
    const border = { style: 'thin' as const, color: { argb: BORDER_COLOR } }
    return { top: border, left: border, bottom: border, right: border }
  }
}
