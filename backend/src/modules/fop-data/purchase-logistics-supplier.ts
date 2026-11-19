type Row = Record<string, any>
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null

/** FOP purchase Logistics tab. Supplier-tab master data is not the Alibaba seller. */
export function purchaseLogisticsSupplier(raw: Row) {
  const account = text(raw.hzkj_sellers_ww)
  return {
    id: account ? `1688:${account}` : text(raw.id),
    name: account,
    wangwangAccount: account,
    phone: text(raw.hzkj_sellers_phone),
    source: 'purchase_logistics' as const,
  }
}
