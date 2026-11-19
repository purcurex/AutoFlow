import { procurementDocumentGroups, withProcurementSourceDocuments } from './collected-procurement-source-documents'

const order = { id: 'o1', billno: 'TO1', org_id: 'company', hzkj_orders_billentry: [{ id: 'ol1', seq: 1, hzkj_local_sku: { id: 'sku1' } }, { id: 'ol2', seq: 2, hzkj_local_sku: { id: 'sku2' } }] }
const stock = { id: 's1', billno: 'IO1', org_id: 'company', hzkj_stock_type: '1', hzkj_orders_billentry: [{ id: 'sl1', seq: 1, hzkj_local_sku_id: 'sku1' }, { id: 'sl2', seq: 2, hzkj_local_sku_id: 'sku2' }] }
const record = { orderNumber: 'TO1', skuId: 'sku1', stockId: 's1', stockNumber: 'IO1', stockType: '1', status: '1', quantity: '2' }
const source = { skuId: 'sku1', fullPaymentQuantity: '2', depositQuantity: '1', directQuantity: '3', records: [record, { ...record, stockId: 's2', stockNumber: 'IO2', stockType: '2', status: '0', quantity: '1' }] }
const purchase = (id: string, parent: string, line: string, seq = '1') => ({ id, billno: 'CG' + id, org_id: 'company', hzkj_cancelstatus: 'A', hzkj_billentry: [{ hzkj_salbillnumber: parent, hzkj_salbillentryid: line, hzkj_salbillentryseq: seq }] })
const groups = (purchases: any[], s: any = source, stocks = [stock]) => procurementDocumentGroups(order, s, stocks, purchases, 'company')

describe('local procurement source document identities', () => {
  it('separates stock downstream purchases, deposit stock orders and direct purchases for a mixed SKU', () => {
    expect(groups([purchase('full', 'IO1', 'sl1'), purchase('direct', 'TO1', 'ol1')])).toEqual([
      { source: 'full_payment', documents: [{ id: 'full', number: 'CGfull' }], unresolved: false },
      { source: 'deposit', documents: [{ id: 's2', number: 'IO2' }], unresolved: false },
      { source: 'direct', documents: [{ id: 'direct', number: 'CGdirect' }], unresolved: false },
    ])
  })
  it('uses the explicit sales sequence when an obsolete optional line id does not resolve', () => {
    expect(groups([purchase('full', 'IO1', 'legacy-id')])[0].documents).toEqual([{ id: 'full', number: 'CGfull' }])
  })
  it('uses the verified batch company for legacy payloads that omit company and skips zero sales sequences', () => {
    const legacy = { ...purchase('direct', 'TO1', '0', '0'), org_id: undefined }
    legacy.hzkj_billentry[0] = { ...legacy.hzkj_billentry[0], hzkj_srcbillentryseq: '1' } as any
    const result = procurementDocumentGroups({ ...order, org_id: undefined }, source, [stock], [legacy], 'company')
    expect(result.find(g => g.source === 'direct')?.documents).toEqual([{ id: 'direct', number: 'CGdirect' }])
  })
  it.each([
    purchase('wrong-sku', 'IO1', 'sl2', '2'), purchase('conflict', 'IO1', 'sl1', '2'),
    purchase('unlinked', 'IO1', 'missing', ''), purchase('wrong-order', 'IO3', 'sl1'),
    { ...purchase('cancelled', 'IO1', 'sl1'), hzkj_cancelstatus: 'B' },
    { ...purchase('cross-company', 'IO1', 'sl1'), org_id: 'other' },
    { ...purchase('virtual', 'IO1', 'sl1'), hzkj_billentry: [{ ...purchase('v', 'IO1', 'sl1').hzkj_billentry[0], isVirtual: true }] },
    { ...purchase('sku-conflict', 'IO1', 'sl1'), hzkj_billentry: [{ ...purchase('v', 'IO1', 'sl1').hzkj_billentry[0], hzkj_local_sku_id: 'sku2' }] },
  ])('does not guess links for $id', p => {
    expect(groups([p])[0]).toEqual({ source: 'full_payment', documents: [], unresolved: true })
  })
  it('accepts an explicit same-parent purchase SKU without a line id but never a SKU alone across parents', () => {
    const p = { ...purchase('sku', 'IO1', ''), hzkj_billentry: [{ hzkj_salbillnumber: 'IO1', hzkj_local_sku_id: 'sku1' }] }
    expect(groups([p])[0].documents).toHaveLength(1)
    expect(groups([{ ...p, hzkj_billentry: [{ ...p.hzkj_billentry[0], hzkj_salbillnumber: 'IO3' }] }])[0].documents).toHaveLength(0)
  })
  it('requires unique stock identity and excludes conflicting or unrelated consumption records', () => {
    const p = [purchase('full', 'IO1', 'sl1')]
    expect(groups(p, source, [stock, { ...stock, id: 'other' }])[0].unresolved).toBe(true)
    expect(groups(p, { ...source, records: [{ ...record, orderNumber: 'TO-other' }] })[0].documents).toEqual([])
    expect(groups(p, { ...source, records: [{ ...record, skuId: 'sku2' }] })[0].documents).toEqual([])
  })
  it('deduplicates split purchases and duplicate consumption rows, omits zero sources, retains partial linkage', () => {
    const s = { ...source, records: [record, { ...record, status: '0' }, { ...record, stockId: 's3', stockNumber: 'IO3' }], depositQuantity: '0', directQuantity: '0' }
    const p = purchase('1', 'IO1', 'sl1')
    expect(groups([p, { ...p, hzkj_billentry: [...p.hzkj_billentry, ...p.hzkj_billentry] }, purchase('2', 'IO1', 'sl1')], s)).toEqual([{ source: 'full_payment', documents: [{ id: '1', number: 'CG1' }, { id: '2', number: 'CG2' }], unresolved: true }])
  })
  it('bulk reads only this batch/company and authorized parent references without mutating cached input', async () => {
    const rows = [{ id: 'o1', items: [{ procurementSource: source }] }], before = JSON.stringify(rows)
    const db = { query: jest.fn(async (sql: string, params?: any[]) => {
      expect(params?.slice(0, 2)).toEqual(['batch', 'company'])
      if (sql.includes('analytics_facts')) { expect(params?.[2]).toEqual(['IO1']); return [{ raw: stock }] }
      expect(params?.[2]).toEqual(['IO1', 'TO1']); return [{ raw: purchase('full', 'IO1', 'sl1') }, { raw: purchase('direct', 'TO1', 'ol1') }]
    }) }
    const result = await withProcurementSourceDocuments(db, { id: 'batch', company_id: 'company' }, rows, [order])
    expect(db.query).toHaveBeenCalledTimes(2)
    expect(result[0].items[0].procurementSource.documentGroups.map((g: any) => g.documents[0].number)).toEqual(['CGfull', 'IO2', 'CGdirect'])
    expect(JSON.stringify(rows)).toBe(before)
  })
  it('skips queries when no source rows exist and leaves missing links explicit', async () => {
    const db = { query: jest.fn(async () => []) }
    const batch = { id: 'batch', company_id: 'company' }
    await withProcurementSourceDocuments(db, batch, [{ id: 'o1', items: [] }], [order]); expect(db.query).not.toHaveBeenCalled()
    const result = await withProcurementSourceDocuments(db, batch, [{ id: 'o1', items: [{ procurementSource: source }] }], [order])
    expect(result[0].items[0].procurementSource.documentGroups[0]).toEqual({ source: 'full_payment', documents: [], unresolved: true })
  })
})
