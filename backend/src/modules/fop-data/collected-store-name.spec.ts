import { supplementStoreName, retainCapturedStoreName, publicStoreNameDisplay } from './collected-store-name'

const row = () => ({ source_id: '101', order_number: 'TO101', search_text: '101 to101 customer sku',
  raw: { id: '101', billno: 'TO101', hzkj_org: { id: '100000' }, hzkj_shop: { id: '201', name: null }, hzkj_shop_name: null },
  display: { storeName: '', items: [{ sku: 'SKU' }], paidAt: '2026-11-17T00:00:00Z' } })
const capture = () => ({ source: 'employee-orders/page', language: 'zh_CN', companyId: '100000', shopId: '201', name: '爱德声 Edelsound',
  sourceOrderId: '102', sourceOrderNumber: 'TO102', capturedAt: '2026-11-17T10:00:00Z', responseSha256: 'a'.repeat(64) })

it('stores the verified localized name on the order without replacing native facts', () => {
  const prior = row(), before = structuredClone(prior), next = supplementStoreName(prior, capture())
  expect(prior).toEqual(before)
  expect(next.raw).toEqual(prior.raw)
  expect(next.display).toEqual({ ...prior.display, storeName: '爱德声 Edelsound', storeNameZhCN: '爱德声 Edelsound', storeNameCapture: capture() })
  expect(next.search_text).toBe(prior.search_text + ' 爱德声 edelsound')
  expect(supplementStoreName(next, capture())).toEqual(next)
})

it.each([{ shopId: '202' }, { companyId: '200000' }, { source: 'guessed' }, { language: 'en_US' }, { name: '' }, { capturedAt: 'invalid' }, { responseSha256: '' }])('rejects unverified scope/source %j', patch => {
  expect(() => supplementStoreName(row(), { ...capture(), ...patch })).toThrow()
})

it('rejects a changed order/store identity and a conflicting existing name', () => {
  for (const patch of [{ source_id: '103' }, { order_number: 'TO103' }, { raw: { ...row().raw, hzkj_shop_id: '202' } }, { raw: { ...row().raw, hzkj_shop: { id: '201', name: 'Changed' } } }]) {
    expect(() => supplementStoreName({ ...row(), ...patch }, capture())).toThrow()
  }
})

it('retains an independent localized capture when native API again returns null for the same store', () => {
  const prior = supplementStoreName(row(), capture()), incoming = { ...row(), display: { ...row().display, paidAt: 'new' } }
  const result = retainCapturedStoreName(incoming, prior)
  expect(result.display.storeName).toBe('爱德声 Edelsound')
  expect(result.display.paidAt).toBe('new')
  expect(result.raw).toEqual(incoming.raw)
})

it('does not carry names across changed stores, companies or orders, or over a new native name', () => {
  const prior = supplementStoreName(row(), capture())
  for (const incoming of [
    { ...row(), raw: { ...row().raw, hzkj_shop: { id: '202', name: null } } },
    { ...row(), raw: { ...row().raw, hzkj_org: { id: '200000' } } },
    { ...row(), source_id: '103' },
    { ...row(), display: { ...row().display, storeName: 'New native' } },
  ]) expect(retainCapturedStoreName(incoming, prior)).toEqual(incoming)
})

it('does not retain tampered capture metadata or a newer capture from an older backfill', () => {
  expect(retainCapturedStoreName(row(), { ...row(), display: { storeNameCapture: { ...capture(), language: 'en_US' } } })).toEqual(row())
  const newer = supplementStoreName(row(), { ...capture(), capturedAt: '2026-11-18T10:00:00Z' })
  expect(() => supplementStoreName(newer, capture())).toThrow('store_name_stale_capture')
})

it('keeps reference-order provenance internal when returning an order to the browser', () => {
  const prior = supplementStoreName(row(), capture()), display = publicStoreNameDisplay(prior.display)
  expect(display).not.toHaveProperty('storeNameCapture')
  expect(display.storeName).toBe('爱德声 Edelsound')
  expect(prior.display).toHaveProperty('storeNameCapture')
})
