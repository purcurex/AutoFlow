import { isVirtualProduct } from '../fop-data/physical-business-lines'
type Line = Record<string, any>
type Product = { source_id: string; sku: string | null; carrier: string | null; variant?: string | null; variantProvided?: boolean; pickingName?: string | null; nameProvided?: boolean }
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
const virtual = isVirtualProduct
export function physicalProductsFirst<T extends Line>(lines: readonly T[]): T[] {
  const rank=(line:T)=>virtual(line)?2:line.isGift===true?1:0
  return lines.map((line,index)=>({line,index})).sort((a,b)=>rank(a.line)-rank(b.line)||a.index-b.index).map(({line})=>line)
}

/** Read captured catalogue facts only. No source writes, name heuristics or remote fallback. */
export async function collectedProductLines(db: { query: (sql: string, params: any[]) => Promise<any[]> }, batchId: string, lineSets: Line[][]): Promise<Line[][]> {
  const lines = lineSets.flat()
  const ids = [...new Set(lines.map(line => text(line.productId)).filter((id): id is string => id !== null))]
  const skus = [...new Set(lines.map(line => text(line.sku)).filter((sku): sku is string => sku !== null))]
  if (!lines.length) return lineSets
  const products: Product[] = ids.length || skus.length ? await db.query(
    `SELECT source_id, raw->>'name' AS "pickingName", raw ? 'name' AS "nameProvided", raw->>'number' AS sku, raw->'hzkj_good'->>'hzkj_good_carrier' AS carrier, raw->>'hzkj_sku_value' AS variant, raw ? 'hzkj_sku_value' AS "variantProvided"
     FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='product'
     AND (source_id=ANY($2::text[]) OR raw->>'number'=ANY($3::text[]))`, [batchId, ids, skus]) : []
  const byId = new Map(products.map(product => [product.source_id, product]))
  const bySku = new Map<string, Product[]>()
  for (const product of products) if (product.sku) bySku.set(product.sku, [...bySku.get(product.sku) ?? [], product])
  return lineSets.map(set => physicalProductsFirst(set.map(line => {
    const sku = text(line.sku), id = text(line.productId), matches = sku ? bySku.get(sku) : undefined
    const candidate = id ? byId.get(id) : matches?.length === 1 ? matches[0] : undefined
    const product = candidate && (!sku || candidate.sku === sku) ? candidate : undefined
    const isVirtual = sku === 'HZ000020-001' || product?.carrier === '2' ? true :
      product && ['0', '1'].includes(product.carrier ?? '') ? false : typeof line.isVirtual === 'boolean' ? line.isVirtual : null
    return { ...line, ...(product?.nameProvided ? {name:text(product.pickingName) ?? ''} : {}), ...(product?.variantProvided ? {variant:text(product.variant) ?? ''} : {}), isVirtual }
  })))
}
