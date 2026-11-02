import * as ExcelJS from 'exceljs'
import { buildPurchaseGroupWorkbook } from './procurement-groups-export'
import type { PurchaseGroup } from './procurement-groups.types'

const now = new Date('2026-10-30T00:00:00Z')
const group: PurchaseGroup = {
  id: 'purchase:p1', kind: 'purchase', purchase: { id: 'p1', number: 'CG20261030000006', supplier: { id: 's1', name: 'Supplier' }, purchaseType: 'online', platform: '1688', platformOrderNumber: '5127833916176022434', payment: 'paid', placement: 'placed', paidAt: '2026-10-27T12:00:00Z' },
  orderCount: 1, skuCount: 1, quantity: 4, shippedQuantity: 1, pendingQuantity: 3, shipment: 'partial', earliestReceiptAt: '2026-10-26T23:00:00Z',
  rows: [{ orderId: 'o1', orderNumber: 'SO-001', shopifyOrderNumber: '#0001', customerName: '=CMD()', storeName: 'Store', ownerName: 'Wendy', departmentName: '业务一部', warehouse: '杭州仓', paidAt: '2026-10-26T23:00:00Z', lines: [{ fulfillmentLineId: 'f1', purchaseLineId: 'p1', sku: '00001', name: 'Lamp', imageUrl: null, variant: 'Blue', quantity: 4, shippedQuantity: 1 }] }],
}
const pending = (): PurchaseGroup => ({ ...group, id: 'uncreated', kind: 'uncreated', purchase: null, shippedQuantity: 0, pendingQuantity: 4, rows: group.rows.map(row => ({ ...row, lines: row.lines.map(line => ({ ...line, purchaseLineId: null, shippedQuantity: 0 })) })) })
async function read(groups: PurchaseGroup[]) {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await buildPurchaseGroupWorkbook(groups, { queue: 'procurement', mode: 'filtered', purchaseStage: 'uncreated', search: 'Lamp', sortOrder: 'desc', warehouseCode: 'HZ' }, 'mock', now) as never)
  return book
}
function cell(sheet: ExcelJS.Worksheet, row: number, header: string) {
  const col = (sheet.getRow(1).values as string[]).indexOf(header)
  expect(col).toBeGreaterThan(0)
  return sheet.getCell(row, col)
}
it('separates uncreated demand from purchase and shipment quantities in mixed exports', async () => {
  const sheet = (await read([pending(), group])).getWorksheet('采购关联明细')!
  expect(cell(sheet, 2, '待采购数量').value).toBe(4)
  for (const header of ['采购数量', '供应商已发数量', '供应商待发数量', '采购下单状态', '供应商发货状态', '发货时效']) expect(cell(sheet, 2, header).text).toBe('')
  expect(cell(sheet, 2, '采购单状态').value).toBe('待创建采购单')
  expect(cell(sheet, 3, '待采购数量').text).toBe('')
  expect(cell(sheet, 3, '采购数量').value).toBe(4)
  expect(cell(sheet, 3, '供应商已发数量').value).toBe(1)
  expect(cell(sheet, 3, '供应商待发数量').value).toBe(3)
  expect(cell(sheet, 3, '采购下单状态').value).toBe('已下单')
  expect(cell(sheet, 3, '供应商发货状态').value).toBe('供应商部分发货')
  expect(cell(sheet, 3, '发货时效').value).toBe('超过48小时')
  expect(sheet.autoFilter).toBe('A1:Z3')
})
it('preserves long identifiers, literal text, receipt time, store and variants and records export filters', async () => {
  const book = await read([group]), sheet = book.getWorksheet('采购关联明细')!
  expect(cell(sheet, 2, '平台订单号').value).toBe('5127833916176022434')
  expect(cell(sheet, 2, '平台订单号').type).toBe(ExcelJS.ValueType.String)
  expect(cell(sheet, 2, '客户').value).toBe('=CMD()')
  expect(cell(sheet, 2, '客户').type).toBe(ExcelJS.ValueType.String)
  expect(cell(sheet, 2, 'SKU').value).toBe('00001')
  expect(cell(sheet, 2, '店铺').value).toBe('Store')
  expect(cell(sheet, 2, '规格').value).toBe('Blue')
  expect(cell(sheet, 2, '收款时间（UTC+8）').value).toBe('2026-10-27 07:00:00')
  const notes = JSON.stringify(book.getWorksheet('说明')!.getSheetValues())
  for (const text of ['演示数据', '待创建采购单', 'Lamp', '降序', '杭州仓', '跨分页']) expect(notes).toContain(text)
})
it.each([[24, '正常'], [24.01, '超过24小时'], [48, '超过24小时'], [48.01, '超过48小时'], [-1, '—']])('matches shipment aging at %s hours', async (hours, expected) => {
  const sheet = (await read([{ ...group, purchase: { ...group.purchase!, paidAt: new Date(now.getTime() - Number(hours) * 3600000).toISOString() } }])).getWorksheet('采购关联明细')!
  expect(cell(sheet, 2, '发货时效').value).toBe(expected)
})
it('enforces the order cap even when over 10000 fulfillment orders share a single purchase', async () => {
  await expect(buildPurchaseGroupWorkbook([{ ...group, rows: Array.from({ length: 10001 }, (_, i) => ({ ...group.rows[0], orderId: String(i) })) }])).rejects.toMatchObject({ status: 413 })
})
