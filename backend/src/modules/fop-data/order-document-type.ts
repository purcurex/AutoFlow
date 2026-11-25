type Row = Record<string, any>
const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null
/** FOP bill-type reference; never infer sample orders from number, amount or SKU. */
export function orderDocumentType(raw: Row) {
  const ref = raw.hzkj_billtype
  const name = ref?.name
  return {
    orderTypeCode: text(ref?.number) ?? text(raw.hzkj_billtype_number),
    orderTypeName: text(name) ?? text(name?.zh_CN) ?? text(raw.hzkj_billtype_name),
  }
}
