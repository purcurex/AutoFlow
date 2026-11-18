type Raw = Record<string, any>
const empty = (value: unknown) => value === null || typeof value === 'string' && !value.trim()
/** Display-only label from three explicit facts on the same fulfillment order. */
export function sourceOrderNumber(raw: Raw, fallback = '') {
 const provided = Object.prototype.hasOwnProperty.call(raw, 'hzkj_source_number')
 const native = provided ? typeof raw.hzkj_source_number === 'string' ? raw.hzkj_source_number.trim() : '' : fallback
 const manual = provided && empty(raw.hzkj_source_number)
  && typeof raw.hzkj_eplatform?.name === 'string' && raw.hzkj_eplatform.name.trim() === 'Offline Store'
  && Object.prototype.hasOwnProperty.call(raw, 'hzkj_sourceid') && empty(raw.hzkj_sourceid)
 return { shopifyOrderNumber: manual ? '手工订单' : native, sourceOrderNumberIsManual: manual }
}
export function withSourceOrderNumber<T extends Raw>(display: T, raw: Raw | undefined): T {
 return raw && raw.id === display.id ? { ...display, ...sourceOrderNumber(raw, display.shopifyOrderNumber) } : display
}
