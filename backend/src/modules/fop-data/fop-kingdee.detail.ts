import { FopPermissionDeniedError, type FopOrder } from './fop-data.types'

type Row = Record<string, unknown>
function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid fulfillment detail')
  return value as Row
}
function text(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string' || value.length > 2000) throw new Error('Invalid fulfillment recipient')
  return value.trim() || null
}

/** Detail is enrichment of an already authorized order, never an order discovery/permission source. */
export function applyKingdeeOrderDetail(order: FopOrder, original: Row, value: unknown): void {
  const page = object(value)
  if (page.pageNo !== 1 || page.pageSize !== 1 || page.lastPage !== true
    || ![1, '1'].includes(page.totalCount as number | string) || !Array.isArray(page.rows) || page.rows.length !== 1) {
    throw new Error('Missing or ambiguous fulfillment detail')
  }
  const detail = object(page.rows[0])
  if (detail.id !== order.id || detail.billno !== order.orderNumber || !order.customerId || !order.owner?.id
    || detail.hzkj_customer_id !== order.customerId || detail.hzkj_operator_id !== order.owner.id
    || detail.hzkj_billtype_number !== 'hzkj_orders_BT'
    || detail.billstatus !== original.billStatus || detail.hzkj_orderstatus !== original.orderStatus) {
    throw new FopPermissionDeniedError('Fulfillment detail scope or state changed')
  }
  // Source APIs currently lack a shared revision. Where present, require the same revision;
  // this data is display-only and must never serve as approval/version evidence.
  if (original.modifiedAt != null && detail.modifytime !== original.modifiedAt) throw new Error('Fulfillment detail version changed')
  const country = text(detail.hzkj_country_twocountrycode)
  if (country && !/^[A-Z]{2}$/.test(country)) throw new Error('Invalid fulfillment destination')
  order.shippingCountryCode = country
  order.shippingRecipient = {
    name: [text(detail.hzkj_customer_first_name), text(detail.hzkj_customer_last_name)].filter(Boolean).join(' ') || null,
    phone: text(detail.hzkj_phone), email: text(detail.hzkj_email), city: text(detail.hzkj_city),
    postalCode: text(detail.hzkj_post_code), addressLine1: text(detail.hzkj_address1), addressLine2: text(detail.hzkj_address2),
    // hzkj_state is absent from the published schema. Administrative division is not a substitute.
    state: null,
  }

  // Shopify line pictures can be deleted independently of the FOP SKU archive.
  // Only an exact source-line and SKU match can supply the archive picture.
  if (Array.isArray(detail.hzkj_orders_billentry)) {
    const entries = detail.hzkj_orders_billentry as Row[]
    for (const line of order.items) {
      const matching = entries.filter(entry => entry && entry.id === line.id && entry.hzkj_local_sku_number === line.sku)
      if (matching.length !== 1) continue
      const picture = matching[0].hzkj_local_sku_hzkj_picturefield
      if (typeof picture !== 'string' || !picture.trim() || picture.length > 2000) continue
      try {
        const url = new URL(picture.trim())
        if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) line.imageUrl = url.href
      } catch { /* Keep the source picture when the optional archive URL is invalid. */ }
    }
  }
}
