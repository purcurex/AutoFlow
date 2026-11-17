export type ProductDisplayKind = { sku?: string; isVirtual?: boolean | null }

/** FOP's legacy virtual SKU remains identifiable when carrier metadata is absent. */
export function isVirtualProduct(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const item = value as ProductDisplayKind
  return item.isVirtual === true || typeof item.sku === 'string' && item.sku.trim() === 'HZ000020-001'
}

/** Stable presentation order; never mutate the source array or discard virtual lines. */
export function physicalProductsFirst<T extends ProductDisplayKind>(items: readonly T[]): T[] {
  return [...items.filter(item => !isVirtualProduct(item)), ...items.filter(isVirtualProduct)]
}
