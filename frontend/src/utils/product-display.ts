export type ProductDisplayKind = { sku?: string; isVirtual?: boolean | null; isGift?: boolean | null }

/** FOP's legacy virtual SKU remains identifiable when carrier metadata is absent. */
export function isVirtualProduct(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const item = value as ProductDisplayKind
  return item.isVirtual === true || typeof item.sku === 'string' && item.sku.trim() === 'HZ000020-001'
}

/** Stable presentation order; never mutate the source array or discard virtual lines. */
export function physicalProductsFirst<T extends ProductDisplayKind>(items: readonly T[]): T[] {
  const rank=(item:T)=>isVirtualProduct(item)?2:item.isGift===true?1:0
  return items.map((item,index)=>({item,index})).sort((a,b)=>rank(a.item)-rank(b.item)||a.index-b.index).map(({item})=>item)
}

/** FOP SKU name (中文配货名); missing values remain blank, never use attributes as a name. */
export function skuPickingName(item: { name?: string | null }): string {
  const value = item.name?.trim()
  return value && value !== '—' ? value : ''
}
