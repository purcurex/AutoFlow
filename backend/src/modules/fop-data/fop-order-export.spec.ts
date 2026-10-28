import * as ExcelJS from 'exceljs'
import { logisticsInfoText } from './logistics-info'
import { buildFulfillmentWorkbook } from './fop-order-export'
import type { FopOrder } from './fop-data.types'

const order: FopOrder = {
  shippingCountryCode: 'gb', id: 'o1', orderNumber: '0000123456789012345678', shopifyOrderNumber: '00002', customerName: '=HYPERLINK("https://invalid")', storeName: '店铺',
  items: [{ sku: '00001', name: '商品 A', variant: '红色', quantity: 2, imageUrl: 'https://example.test/product.jpg' }, { sku: '00002', name: '商品 B', variant: '蓝色', quantity: 3, imageUrl: null }],
  amount: 12.34, currency: 'USD', paymentStatus: 'paid', reviewStatus: 'pending', procurementStatus: 'pending', allocationStatus: 'pending', dispatchStatus: 'pending', shippingStatus: 'pending',
  warehouse: '杭州仓', carrier: '云途YT', trackingNumber: null, salesperson: '曹可莹（Ruth）', owner: { id: 'owner', name: '曹可莹（Ruth）' }, department: { id: 'd1', name: '业务一部' },
  createdAt: '2026-10-25T16:00:00Z', paidAt: '2026-10-25T16:30:00Z', cancelled: false, exception: null,
  fulfillmentProgress: { allocationCreated: true, shopifySync: 'pending', supplierShipment: 'pending', stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'pending' },
}
async function read(orders: FopOrder[], queue: 'unpaid' | 'review' | 'exceptions' | 'procurement' | 'procurement_shipping' | 'allocation' | 'allocation_review' | 'shipping' | 'dispatch' = 'review') {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await buildFulfillmentWorkbook(orders, { queue, mode: 'filtered' }, 'mock') as unknown as ExcelJS.Buffer)
  return workbook
}
const headers = (sheet: ExcelJS.Worksheet) => sheet.getRow(1).values as string[]
const value = (sheet: ExcelJS.Worksheet, row: number, header: string) => sheet.getRow(row).getCell(headers(sheet).indexOf(header))

describe('fulfillment Excel export', () => {
  it('exports WMS push time in UTC+8 without order-created or payment-date fallback', async () => {
    const rows = ['2026-10-28T04:30:00Z', null, '2026-10-28T12:30:00', '2026-02-30T00:00:00Z'].map((wmsCreatedAt, i) => ({ ...order, id: String(i), wmsCreatedAt }))
    const ws = (await read(rows, 'shipping')).getWorksheet('订单清单')!
    expect(headers(ws)).toContain('WMS创建时间（UTC+8）')
    expect(headers(ws)).not.toContain('创建日期（UTC+8）')
    expect([2, 3, 4, 5].map(row => value(ws, row, 'WMS创建时间（UTC+8）').value)).toEqual(['2026-10-28 12:30:00', '—', '—', '—'])
  })
  it('exports the ready time and two-line salesperson cell without a separate department column', async () => {
    const ready = { ...order, allocationReadyAt: '2026-10-27T12:30:00+08:00' }
    const ws = (await read([ready, order], 'allocation_review')).getWorksheet('订单清单')!
    expect(headers(ws)).toContain('齐套时间（UTC+8）')
    expect(headers(ws)).not.toContain('业务部门')
    expect(value(ws, 2, '齐套时间（UTC+8）').value).toBe('2026-10-27 12:30:00')
    expect(value(ws, 3, '齐套时间（UTC+8）').value).toBe('—')
    expect(value(ws, 2, '业务员').value).toBe('曹可莹（Ruth）\n业务一部')
  })

  it('exports actual procurement payment time only for the purchased shipment queue without fallback', async () => {
    const rows = [{ ...order, procurementPaidAt: '2026-10-27T00:30:00-04:00' }, { ...order, id: 'missing' }]
    const ws = (await read(rows, 'procurement_shipping')).getWorksheet('订单清单')!
    expect(headers(ws)).toContain('采购付款时间（UTC+8）')
    expect(headers(ws)).not.toContain('创建日期（UTC+8）')
    expect(value(ws, 2, '采购付款时间（UTC+8）').value).toBe('2026-10-27 12:30:00')
    expect(value(ws, 3, '采购付款时间（UTC+8）').value).toBe('—')
    const pending = (await read(rows, 'procurement')).getWorksheet('订单清单')!
    expect(headers(pending)).toContain('订单审核时间（UTC+8）')
  })
  it('does not infer Shopify selection from empty or malformed typed data', async () => {
    const groups = [{ carrierName: 'YT', trackingNumbers: [] }]
    const ws = (await read([{ ...order, carrier: 'Legacy Carrier', trackingNumber: '000123', logisticsInfo: groups }], 'dispatch')).getWorksheet('订单清单')!
    expect(value(ws, 2, '物流信息').value).toBe('YT\n—')
    expect(logisticsInfoText([{ carrierName: 'YT', shopifyTracking: { type: 'invalid', number: 'bad' } }], 'Legacy Carrier', '000123')).toBe('YT\n—')
    expect(logisticsInfoText([{ carrierName: 'YT', shopifyTracking: { type: 'first_mile', number: 'JSEJX2881622244YQ' } }], 'Legacy Carrier', '000123')).toBe('YT\nTC: JSEJX2881622244YQ')
  })
  it('exports only the Shopify-selected number in each carrier group', async () => {
    const row: FopOrder = { ...order, logisticsInfo: [
      { carrierName: '云途YT', shopifyTracking: { type: 'full', number: 'YT123' } },
      { carrierName: '4PX', shopifyTracking: { type: 'last_mile', number: '9400' } },
    ] }
    const legacy = { ...order, carrier: 'Legacy', trackingNumber: '0000123' }
    const ws = (await read([row, legacy], 'dispatch')).getWorksheet('订单清单')!
    expect(headers(ws)).toContain('物流信息')
    expect(headers(ws)).not.toContain('物流商')
    expect(headers(ws)).not.toContain('物流单号')
    expect(value(ws, 2, '物流信息').value).toBe('云途YT\nQC: YT123\n\n4PX\nWC: 9400')
    expect(value(ws, 3, '物流信息').value).toBe('Legacy\n—')
    expect(headers((await read([row], 'shipping')).getWorksheet('订单清单')!)).toContain('物流商')
  })

  it('exports only unpaid custom channel names and uses consistent business labels', async () => {
    const row = { ...order, paymentStatus: 'unpaid' as const, paidAt: null, customLogisticsChannelName: 'Priority Shipping' }
    const book = await read([row, order], 'unpaid')
    const ws = book.getWorksheet('订单清单')!
    expect(headers(ws)[headers(ws).indexOf('发货仓库') + 1]).toBe('自定义物流渠道')
    expect(value(ws, 2, '自定义物流渠道').value).toBe('Priority Shipping')
    expect(value(ws, 3, '自定义物流渠道').value).toBe('—')
    expect(headers(ws)).not.toContain('业务部门')
    const info = book.getWorksheet('导出说明')!
    expect(info.getColumn(1).values).toEqual(expect.arrayContaining(['发货仓库', '业务部门']))
    expect(headers((await read([row], 'review')).getWorksheet('订单清单')!)).not.toContain('自定义物流渠道')
  })

  it('exports actual channels together in one review column with empty legacy values', async () => {
    const row = { ...order, logisticsChannels: [{ name: '云途标准专线', code: 'YT-STD' }, { name: '云途带电专线', code: 'YT-BAT' }] }
    const ws = (await read([row, order])).getWorksheet('订单清单')!
    expect(headers(ws)[headers(ws).indexOf('发货仓库') + 1]).toBe('物流渠道')
    expect(value(ws, 2, '物流渠道').value).toBe('云途标准专线（YT-STD）\n云途带电专线（YT-BAT）')
    expect(value(ws, 3, '物流渠道').value).toBe('—')
    expect(headers((await read([row], 'procurement')).getWorksheet('订单清单')!)).not.toContain('物流渠道')
  })
  it.each(['unpaid', 'review', 'exceptions', 'dispatch', 'allocation'] as const)('exports consumer payment completion time for %s instead of creation time', async queue => {
    const unpaid = { ...order, paymentStatus: 'unpaid' as const, paidAt: null, consumerPaidAt: '2026-10-01T17:30:00-04:00' }
    const ws = (await read([unpaid, { ...unpaid, id: 'missing', consumerPaidAt: undefined }], queue)).getWorksheet('订单清单')!
    expect(headers(ws)).toContain('C端下单时间（UTC+8）')
    expect(headers(ws)).not.toContain('创建日期（UTC+8）')
    expect(value(ws, 2, 'C端下单时间（UTC+8）').value).toBe('2026-10-02 05:30:00')
    expect(value(ws, 3, 'C端下单时间（UTC+8）').value).toBe('—')
    expect(value(ws, 2, '收款日期（UTC+8）').value).toBe('—')
    expect(headers((await read([order], 'procurement')).getWorksheet('订单清单')!)).toContain('订单审核时间（UTC+8）')
  })
  it('preserves supplier shipment facts for unpaid purchases even after shipment', async () => {
    const shipped = { ...order, procurementProgress: { purchaseOrder: 'ordered', supplierPayment: 'unpaid' } as const, fulfillmentProgress: { ...order.fulfillmentProgress, supplierShipment: 'shipped' as const } }
    const sheet = (await read([shipped], 'procurement')).getWorksheet('订单清单')!
    expect(headers(sheet)).not.toContain('供应商发货状态')
    expect(value(sheet, 2, '采购进度').value).toBe('待支付采购款')
  })
  it('preserves IDs and literal text, separates SKU rows, and totals each currency without double counting', async () => {
    const workbook = await read([order, { ...order, id: 'o2', orderNumber: '00003', items: [order.items[0]], currency: 'CNY', amount: 10 }])
    const sheet = workbook.getWorksheet('订单清单')!
    const items = workbook.getWorksheet('商品明细')!
    expect(sheet.getCell('B1').value).toBe('商品信息')
    expect(value(sheet, 2, 'Customer').value).toBe('GB')
    expect(headers(sheet)).not.toContain('本地 SKU / 规格')
    expect(value(sheet, 2, '商品信息').value).toContain('商品 A\nSKU · 00001 × 2\n红色')
    expect(value(sheet, 2, '商品信息').value).toContain('商品 B\nSKU · 00002 × 3\n蓝色')
    expect(sheet.getCell('A2').value).toBe(order.orderNumber)
    expect(value(sheet, 2, '客户名称').type).toBe(ExcelJS.ValueType.String)
    expect(value(sheet, 2, '客户名称').value).toBe(order.customerName)
    expect(value(sheet, 2, '收款日期（UTC+8）').value).toBe('2026-10-26 00:30:00')
    expect(value(sheet, 2, '订单金额').value).toBe(12.34)
    expect(headers(sheet)).not.toContain('数量')
    expect(headers(sheet).indexOf('订单金额')).toBe(headers(sheet).indexOf('Shopify 单号') + 1)
    expect(headers(sheet).indexOf('客户名称')).toBe(headers(sheet).indexOf('店铺') - 1)
    expect(headers(sheet)).not.toContain('组织')
    expect(headers(sheet)).not.toContain('业务部门')
    expect(value(sheet, 2, '业务员').value).toBe('曹可莹（Ruth）\n业务一部')
    expect(sheet.getCell('A4').value).toBe('合计 · 2 笔订单')
    expect(value(sheet, 4, '商品信息').value).toBe('合计 7 件')
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
    const purchase = (await read([{ ...order, procurementProgress: { purchaseOrder: 'ordered', supplierPayment: 'unpaid', alibabaOrder: 'not_pushed', logisticsGate: 'pending_logistics' } }], 'procurement')).getWorksheet('订单清单')!
    expect(value(purchase, 2, '采购进度').value).toBe('待制作发运单')
    const allocation = (await read([{ ...order, allocationDocument: { id: 'ao1', number: 'AO261028000404' }, dispatchDocuments: [{ id: 'd1', number: 'FY01', status: 'submitted' }, { id: 'd2', number: 'FY02', status: 'approved' }] }], 'allocation_review')).getWorksheet('订单清单')!
    expect(value(allocation, 2, '发运单状态').value).toBe('未完成')
    expect(value(allocation, 2, '配货单号').value).toBe('AO261028000404')
    expect(value(allocation, 2, '发运单编号').value).toBe('FY01\nFY02')
    expect(headers(allocation)).not.toContain('支付状态')
    expect(headers(allocation).slice(headers(allocation).indexOf('发运单状态'), headers(allocation).indexOf('发运单状态') + 3)).toEqual(['发运单状态', '客户名称', '店铺'])
    expect(headers(allocation)).not.toContain('配货状态')
    expect(headers(allocation)).not.toContain('配货单状态')
    const ready = (await read([{ ...order, fulfillmentProgress: { ...order.fulfillmentProgress, stockReadiness: 'ready', allocationReview: 'unknown' } }], 'allocation_review')).getWorksheet('订单清单')!
    expect(headers(ready)).not.toContain('配货状态')
    expect(value(ready, 2, '发运单状态').value).toBe('未完成')
    const warehouse = (await read([{ ...order, fulfillmentProgress: { ...order.fulfillmentProgress, stockReadiness: 'ready', allocationReview: 'approved' } }], 'shipping')).getWorksheet('订单清单')!
    expect(headers(warehouse)).not.toContain('出库状态')
    expect(headers(warehouse).slice(headers(warehouse).indexOf('出库进度'), headers(warehouse).indexOf('出库进度') + 3)).toEqual(['出库进度', '客户名称', '店铺'])
    expect(value(warehouse, 2, '出库进度').value).toBe('待出库')
    expect(value(warehouse, 3, '商品信息').value).toBe('合计 5 件')
    expect(value(warehouse, 4, '订单金额').value).toBe(12.34)
  })
  it('rejects oversized exports rather than silently truncating', async () => {
    await expect(read(Array(10001).fill(order))).rejects.toMatchObject({ status: 413 })
    await expect(read([{ ...order, items: Array(50001).fill(order.items[0]) }])).rejects.toMatchObject({ status: 413 })
  })
})
