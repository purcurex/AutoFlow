import { collectedProductLines } from './collected-product-display'
import { scopedPurchaseGroup } from '../fop-data/collected-native-facts'

it('selects a physical group preview before truncation without altering totals or per-order line identities', () => {
  const group = scopedPurchaseGroup({ id: 'g', rows: [{ orderId: 'o', orderNumber: 'TO1', lines: [
    { sku: 'HZ000020-001', purchaseLineId: '11', quantity: 1, shippedQuantity: 0 },
    { sku: 'REAL', purchaseLineId: '12', quantity: 2, shippedQuantity: 0 },
    { sku: 'REAL-2', purchaseLineId: '13', quantity: 3, shippedQuantity: 0 },
  ] }] }, null)
  expect(group.previewLines.map((line: any) => line.sku)).toEqual(['REAL'])
  expect(group.quantity).toBe(6)
  expect(group.detailLineCount).toBe(3)
  expect(group.rows[0].lines.map((line: any) => line.purchaseLineId)).toEqual(['11','12','13'])
})

it('uses captured carrier metadata from the same batch and moves virtual lines last without changing quantities or input', async () => {
  const db = { query: jest.fn().mockResolvedValue([{ source_id: 'v', sku: 'SERVICE', carrier: '2' }, { source_id: 'p', sku: 'SKU', carrier: '0' }]) }
  const input = [[{ productId: 'v', sku: 'SERVICE', quantity: 1 }, { productId: 'p', sku: 'SKU', quantity: 2 }]]
  const result = await collectedProductLines(db, 'batch', input)
  expect(result).toEqual([[{ productId: 'p', sku: 'SKU', quantity: 2, isVirtual: false }, { productId: 'v', sku: 'SERVICE', quantity: 1, isVirtual: true }]])
  expect(input[0][0].sku).toBe('SERVICE')
  expect(db.query).toHaveBeenCalledTimes(1)
  expect(db.query.mock.calls[0][1]).toEqual(['batch', ['v', 'p'], ['SERVICE', 'SKU']])
})

it('keeps unverified kinds unknown and never guesses virtuality from names or a conflicting identity', async () => {
  const db = { query: jest.fn().mockResolvedValue([{ source_id: 'v', sku: 'SERVICE', carrier: '2' }, { source_id: 'p', sku: 'SERVICE', carrier: '0' }]) }
  const [result] = await collectedProductLines(db, 'batch', [[
    { sku: 'SERVICE', name: 'Virtual' }, { productId: 'missing', sku: 'SERVICE' }, { productId: 'v', sku: 'MISMATCH' }, { sku: 'UNKNOWN', name: '虚拟商品' }, { sku: 'HZ000020-001' },
  ]])
  expect(result.map(x => x.isVirtual)).toEqual([null, null, null, null, true])
})

it('does not query the catalogue for an empty list', async () => {
  const db = { query: jest.fn() }
  expect(await collectedProductLines(db, 'batch', [[]])).toEqual([[]])
  expect(db.query).not.toHaveBeenCalled()
})
