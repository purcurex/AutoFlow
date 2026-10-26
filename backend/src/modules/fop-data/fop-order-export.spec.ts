import * as ExcelJS from 'exceljs'
import { buildFulfillmentWorkbook } from './fop-order-export'
import type { FopOrder } from './fop-data.types'

const order: FopOrder = {
  id: 'o1', orderNumber: '0000123456789012345678', shopifyOrderNumber: '00002', customerName: '=HYPERLINK("https://invalid")', storeName: '店铺',
  items: [{ sku: '00001', name: '商品 A', variant: '红色', quantity: 2, imageUrl: 'https://example.test/product.jpg' }, { sku: '00002', name: '商品 B', variant: '蓝色', quantity: 3, imageUrl: null }],
  amount: 12.34, currency: 'USD', paymentStatus: 'paid', reviewStatus: 'pending', procurementStatus: 'pending', allocationStatus: 'pending', dispatchStatus: 'pending', shippingStatus: 'pending',
  warehouse: '杭州仓', carrier: '云途YT', trackingNumber: null, salesperson: '曹可莹（Ruth）', owner: { id: 'owner', name: '曹可莹（Ruth）' }, department: { id: 'd1', name: '业务一部' },
  createdAt: '2026-10-25T16:00:00Z', paidAt: '2026-10-25T16:30:00Z', cancelled: false, exception: null,
  fulfillmentProgress: { shopifySync: 'pending', supplierShipment: 'pending', stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'pending' },
}
async function read(orders: FopOrder[], queue: 'review' | 'procurement' | 'allocation_review' = 'review') {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await buildFulfillmentWorkbook(orders, { queue, mode: 'filtered' }, 'mock') as unknown as ExcelJS.Buffer)
  return workbook
}
const headers = (sheet: ExcelJS.Worksheet) => sheet.getRow(1).values as string[]
const value = (sheet: ExcelJS.Worksheet, row: number, header: string) => sheet.getRow(row).getCell(headers(sheet).indexOf(header))

describe('fulfillment Excel export', () => {
  it('preserves IDs and literal text, separates SKU rows, and totals each currency without double counting', async () => {
    const workbook = await read([order, { ...order, id: 'o2', orderNumber: '00003', items: [order.items[0]], currency: 'CNY', amount: 10 }])
    const sheet = workbook.getWorksheet('订单清单')!
    const items = workbook.getWorksheet('商品明细')!
    expect(sheet.getCell('B1').value).toBe('商品信息')
    expect(sheet.getCell('A2').value).toBe(order.orderNumber)
    expect(value(sheet, 2, '客户名称').type).toBe(ExcelJS.ValueType.String)
    expect(value(sheet, 2, '客户名称').value).toBe(order.customerName)
    expect(value(sheet, 2, '收款日期（UTC+8）').value).toBe('2026-10-26 00:30:00')
    expect(value(sheet, 2, '订单金额').value).toBe(12.34)
    expect(value(sheet, 2, '数量').value).toBe(5)
    expect(headers(sheet)).not.toContain('组织')
    expect(headers(sheet).indexOf('所属部门')).toBe(headers(sheet).indexOf('业务员') + 1)
    expect(sheet.getCell('A4').value).toBe('合计 · 2 笔订单')
    expect(value(sheet, 4, '数量').value).toBe(7)
    expect(value(sheet, 5, '订单金额').value).toBe(12.34)
    expect(value(sheet, 6, '订单金额').value).toBe(10)
    expect(items.rowCount).toBe(5) // header + three SKUs + total
    expect(value(items, 2, 'SKU').value).toBe('00001')
    expect(headers(items)).not.toContain('订单金额')
    expect(value(items, 5, '数量').value).toBe(7)
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(sheet.autoFilter).toBeTruthy()
    expect(workbook.getWorksheet('导出说明')).toBeDefined()
  })
  it('exports procurement facts and dispatch document statuses without substituting customer payment', async () => {
    const purchase = (await read([{ ...order, procurementProgress: { purchaseOrder: 'partial', supplierPayment: 'paid' } }], 'procurement')).getWorksheet('订单清单')!
    expect(headers(purchase)).not.toContain('支付状态')
    expect(value(purchase, 2, '采购订单状态').value).toContain('部分下单')
    expect(value(purchase, 2, '采购订单状态').value).toContain('采购款：已支付')
    const allocation = (await read([{ ...order, dispatchDocuments: [{ id: 'd1', number: 'FY01', status: 'submitted' }, { id: 'd2', number: 'FY02', status: 'approved' }] }], 'allocation_review')).getWorksheet('订单清单')!
    expect(value(allocation, 2, '发运单状态').value).toBe('FY01：已提交\nFY02：已审核')
    expect(headers(allocation)).not.toContain('支付状态')
  })
  it('rejects oversized exports rather than silently truncating', async () => {
    await expect(read(Array(10001).fill(order))).rejects.toMatchObject({ status: 413 })
    await expect(read([{ ...order, items: Array(50001).fill(order.items[0]) }])).rejects.toMatchObject({ status: 413 })
  })
})
