import { compareFulfillmentOrders, canSortFulfillmentQueue } from './fop-order-sort'
import type { FopOrder } from './fop-data.types'
import { buildFulfillmentWorkbook } from './fop-order-export'
import * as ExcelJS from 'exceljs'
const fixture: FopOrder = {
  shippingCountryCode: 'gb', id: 'o1', orderNumber: '0000123456789012345678', shopifyOrderNumber: '00002', customerName: '=HYPERLINK("https://invalid")', storeName: '店铺',
  items: [{ sku: '00001', name: '商品 A', variant: '红色', quantity: 2, imageUrl: 'https://example.test/product.jpg' }, { sku: '00002', name: '商品 B', variant: '蓝色', quantity: 3, imageUrl: null }],
  amount: 12.34, currency: 'USD', paymentStatus: 'paid', reviewStatus: 'pending', procurementStatus: 'pending', allocationStatus: 'pending', dispatchStatus: 'pending', shippingStatus: 'pending',
  warehouse: '杭州仓', carrier: '云途YT', trackingNumber: null, salesperson: '曹可莹（Ruth）', owner: { id: 'owner', name: '曹可莹（Ruth）' }, department: { id: 'd1', name: '业务一部' },
  createdAt: '2026-10-25T16:00:00Z', paidAt: '2026-10-25T16:30:00Z', cancelled: false, exception: null,
  fulfillmentProgress: { allocationCreated: true, shopifySync: 'pending', supplierShipment: 'pending', stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'pending' },
}
const order = (id: string, reviewedAt?: string | null): FopOrder => ({ ...fixture, id, orderNumber: id, reviewedAt })
it('sorts actual approval instants across time zones, keeps invalid/missing last and breaks ties by receipt then ID', () => {
  const rows = [order('missing'), order('invalid', '2026-10-01T00:00:00'), order('later', '2026-10-02T01:00:00Z'), order('early', '2026-10-02T08:00:00+08:00')]
  expect([...rows].sort((a,b) => compareFulfillmentOrders(a,b,{ queue: 'procurement', sortBy: 'reviewedAt', sortOrder: 'asc' })).map(r => r.id)).toEqual(['early','later','invalid','missing'])
  expect([...rows].sort((a,b) => compareFulfillmentOrders(a,b,{ queue: 'procurement', sortBy: 'reviewedAt', sortOrder: 'desc' })).map(r => r.id)).toEqual(['later','early','invalid','missing'])
  expect(canSortFulfillmentQueue('procurement','reviewedAt')).toBe(true)
  expect(canSortFulfillmentQueue('review','reviewedAt')).toBe(false)
})
it('exports approval date in UTC+8 and never substitutes creation time', async () => {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await buildFulfillmentWorkbook([order('one','2026-10-02T01:00:00Z'),order('two')], { queue:'procurement', mode:'filtered',sortBy:'reviewedAt' },'mock') as never)
  const ws=book.getWorksheet('订单清单')!
  const headers=ws.getRow(1).values as string[]
  const col=headers.indexOf('订单审核时间（UTC+8）')
  expect(col).toBeGreaterThan(0)
  expect(headers.join()).not.toContain('创建日期')
  expect(ws.getRow(2).getCell(col).value).toContain('09:00')
  expect(ws.getRow(3).getCell(col).value).toBe('—')
})
