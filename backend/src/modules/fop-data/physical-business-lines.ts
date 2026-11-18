type Row = Record<string, any>
const text = (v: unknown) => v == null ? '' : String(v).trim()
/** Product identity only. Never infer virtuality from its name, purchase, inventory or shipment state. */
export function isVirtualProduct(line: Row, product?: Row): boolean {
 const sku = line.hzkj_local_sku ?? line.hzkj_material ?? line.hzkj_sku ?? {}
 const number = text(sku.number ?? line.hzkj_local_sku_number ?? line['hzkj_local_sku.number'] ?? line.sku)
 const productMatches = product && (!number || !text(product.number) || text(product.number) === number)
 const carrier = sku.hzkj_good?.hzkj_good_carrier ?? sku['hzkj_good.hzkj_good_carrier']
  ?? line.hzkj_local_sku_hzkj_good_hzkj_good_carrier ?? line['hzkj_local_sku.hzkj_good.hzkj_good_carrier']
 return line.isVirtual === true || number === 'HZ000020-001' || text(carrier) === '2'
  || !!(productMatches && text(product.hzkj_good?.hzkj_good_carrier) === '2')
}
export function physicalBusinessLines<T extends Row>(entries: readonly T[]): T[] {
 const candidates = entries.filter(l => !isVirtualProduct(l) && l.requiresPhysicalOutbound !== false)
 // A virtual child cannot turn a real item into an excluded combination parent.
 const parents = new Set(candidates.map(l => text(l.pid)).filter(id => id && id !== '0'))
 return candidates.filter(l => !parents.has(text(l.id)))
}
/** Enrich a calculation copy from the same-batch catalogue; the source document is never rewritten. */
export function withVirtualProductFacts(raw: Row, lookup?: (id: string) => Row | undefined): Row {
 return {...raw, hzkj_orders_billentry: (raw.hzkj_orders_billentry ?? []).map((line: Row) => ({...line,
  isVirtual: isVirtualProduct(line, lookup?.(text(line.hzkj_local_sku?.id ?? line.hzkj_local_sku_id))),
 }))}
}
/** A virtual-only linked purchase cannot create physical payment, shipment or refund tasks. Unknown links remain unknown. */
export function physicalPurchaseGroups<T extends {raw:Row;display:Row}>(parent:Row, groups:readonly T[]):T[] {
 const entries:Row[]=parent.hzkj_orders_billentry??[]
 const physical = new Set(physicalBusinessLines(entries))
 const excluded = new Set(entries.filter(l=>!physical.has(l)).map(l=>text(l.id)))
 return groups.filter(g=>{
  const lines:Row[]=(g.display.rows??[]).filter((r:Row)=>r.orderId===parent.id).flatMap((r:Row)=>r.lines??[])
  return !lines.length || lines.some(l=>!isVirtualProduct(l)&&!excluded.has(text(l.fulfillmentLineId)))
 })
}
