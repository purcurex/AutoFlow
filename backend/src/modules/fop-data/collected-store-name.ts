type Row = Record<string, any>
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
const identifier = (value: unknown) => typeof value === 'string' && /^[1-9]\d{0,30}$/.test(value)

/** Localized reference facts are kept separately from the untouched native API payload. */
export function supplementStoreName<T extends Row>(prior: T, capture: Row): T {
  if (capture.source !== 'employee-orders/page' || capture.language !== 'zh_CN' || !identifier(capture.companyId) || !identifier(capture.shopId)
    || !identifier(capture.sourceOrderId) || !text(capture.sourceOrderNumber) || !text(capture.name)
    || typeof capture.capturedAt !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(capture.capturedAt) || !Number.isFinite(Date.parse(capture.capturedAt))
    || !/^[a-f0-9]{64}$/.test(capture.responseSha256 ?? '')) throw Error('store_name_unverified_capture')
  if (prior.raw?.id !== prior.source_id || prior.raw?.billno !== prior.order_number) throw Error('store_name_order_identity_mismatch')
  if (prior.raw?.hzkj_org?.id !== capture.companyId || prior.raw?.hzkj_shop?.id !== capture.shopId
    || prior.raw.hzkj_shop_id != null && prior.raw.hzkj_shop_id !== capture.shopId) throw Error('store_name_reference_mismatch')
  const name = capture.name.trim(), nativeName = text(prior.raw.hzkj_shop.name)
  if (nativeName && nativeName !== name) throw Error('store_name_native_conflict')
  const previous = prior.display?.storeNameCapture
  if (previous && Date.parse(previous.capturedAt) > Date.parse(capture.capturedAt)) throw Error('store_name_stale_capture')
  if (text(prior.display?.storeName) && prior.display.storeName !== name && !previous) throw Error('store_name_display_conflict')
  const search = prior.search_text || '', suffix = name.toLowerCase()
  return { ...prior, display: { ...prior.display, storeName: name, storeNameZhCN: name, storeNameCapture: { ...capture, name } },
    search_text: search.includes(suffix) ? search : [search, suffix].filter(Boolean).join(' ') }
}

/** The native null-name issue must not erase a separately verified zh_CN value.
 * A changed order/company/store or a newly provided native name invalidates this fallback.
 */
export function retainCapturedStoreName<T extends Row>(incoming: T, previous?: Row): T {
  if (!previous?.display?.storeNameCapture || incoming.source_id !== previous.source_id || incoming.order_number !== previous.order_number || text(incoming.display?.storeName)) return incoming
  try { return supplementStoreName(incoming, previous.display.storeNameCapture) } catch { return incoming }
}

/** The representative order used to verify a store may belong to another account. */
export function publicStoreNameDisplay<T extends Row>(display: T): T {
  const result = { ...display }
  delete result.storeNameCapture
  return result
}
