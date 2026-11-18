import { collectedProductLines,physicalProductsFirst } from './collected-product-display'
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

it('uses captured SKU attributes including explicit empty values without replacing product names or joining ambiguous codes', async()=>{
 const db={query:jest.fn().mockResolvedValue([
 {source_id:'1',sku:'SKU',carrier:null,variant:'颜色:蓝色;尺寸:L',variantProvided:true},
 {source_id:'2',sku:'EMPTY',carrier:null,variant:null,variantProvided:true},
 {source_id:'3',sku:'DUP',carrier:null,variant:'甲',variantProvided:true},
 {source_id:'4',sku:'DUP',carrier:null,variant:'乙',variantProvided:true},
 ])}
 const [lines]=await collectedProductLines(db,'b',[[{productId:'1',sku:'SKU',name:'English',variant:'old'},{sku:'EMPTY',variant:'old'},{sku:'DUP',variant:'original'},{productId:'missing',sku:'SKU',variant:'original'}]])
 expect(lines.map(x=>x.variant)).toEqual(['颜色:蓝色;尺寸:L','','original','original'])
 expect(lines[0].name).toBe('English')
})

it('keeps explicit gift ordering consistent with frontend and export, without name or price inference',()=>{
 const rows=[{sku:'HZ000020-001'},{sku:'gift',isGift:true},{sku:'main',name:'赠品',amount:0},{sku:'main2'}]
 expect(physicalProductsFirst(rows).map(r=>r.sku)).toEqual(['main','main2','gift','HZ000020-001']);expect(rows[0].sku).toBe('HZ000020-001')
})

it('uses the captured Chinese picking name, preserves attributes, and clears explicit blank names', async()=>{
 const db={query:jest.fn().mockResolvedValue([
  {source_id:'1',sku:'SKU',carrier:null,pickingName:'蓝色L码上衣',nameProvided:true},
  {source_id:'2',sku:'EMPTY',carrier:null,pickingName:null,nameProvided:true},
 ])}
 const [lines]=await collectedProductLines(db,'b',[[{productId:'1',sku:'SKU',name:'English',variant:'颜色:蓝色'},{sku:'EMPTY',name:'Old'},{productId:'missing',sku:'SKU',name:'Original'}]])
 expect(lines.map(x=>x.name)).toEqual(['蓝色L码上衣','','Original'])
 expect(lines[0].variant).toBe('颜色:蓝色')
})
