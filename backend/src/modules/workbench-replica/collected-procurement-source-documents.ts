import { purchaseReference, purchaseMatchesSourceSku } from '../fop-data/collected-purchase-association'

type Row = Record<string, any>
type Query = { query: (sql: string, params?: any[]) => Promise<Row[]> }
type Document = { id: string; number: string }
type Source = 'full_payment' | 'deposit' | 'direct'
type Group = { source: Source; documents: Document[]; unresolved: boolean }
const text = purchaseReference
const positive = (value: unknown) => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0
// Legacy captured fulfillment/purchase payloads omit org. Their verified batch supplies scope;
// an explicit conflicting source company must still be rejected.
const inCompany = (raw: Row, companyId: string) => (text(raw.org_id ?? raw.org?.id) ?? companyId) === companyId
const unique = (docs: Document[]) => [...new Map(docs.map(doc => [doc.id, doc])).values()].sort((a, b) => a.number.localeCompare(b.number))

export function procurementDocumentGroups(order: Row, source: Row, stocks: Row[], purchases: Row[], companyId: string): Group[] {
  const activePurchases = purchases.filter(p => inCompany(p, companyId) && p.hzkj_cancelstatus !== 'B' && text(p.id) && text(p.billno))
  const purchaseDocuments = (parent: Row): Document[] => unique(activePurchases.filter(p => (p.hzkj_billentry ?? []).some((line: Row) => purchaseMatchesSourceSku(line, parent, source.skuId))).map(p => ({ id: p.id, number: p.billno })))
  const records: Row[] = (source.records ?? []).filter((r: Row) => r.orderNumber === order.billno && r.skuId === source.skuId && ['0', '1'].includes(r.status) && positive(r.quantity))
  const groups: Group[] = []
  if (positive(source.fullPaymentQuantity)) {
    const full = [...new Map(records.filter(r => r.stockType === '1').map(r => [r.stockId, r])).values()]
    const documents: Document[] = []
    let unresolved = !full.length
    for (const r of full) {
      const parents = stocks.filter(s => text(s.org_id ?? s.org?.id) === companyId && s.billno === r.stockNumber)
      const parent = parents.length === 1 && text(parents[0].id) === r.stockId && parents[0].hzkj_stock_type === '1' ? parents[0] : null
      const found = parent ? purchaseDocuments(parent) : []
      documents.push(...found)
      unresolved ||= !found.length
    }
    groups.push({ source: 'full_payment', documents: unique(documents), unresolved })
  }
  if (positive(source.depositQuantity)) {
    const deposit = records.filter(r => r.stockType === '2')
    groups.push({ source: 'deposit', documents: unique(deposit.filter(r => text(r.stockNumber) && text(r.stockId)).map(r => ({ id: r.stockId, number: r.stockNumber }))), unresolved: !deposit.length || deposit.some(r => !text(r.stockNumber) || !text(r.stockId)) })
  }
  if (positive(source.directQuantity)) {
    const documents = inCompany(order, companyId) ? purchaseDocuments(order) : []
    groups.push({ source: 'direct', documents, unresolved: !documents.length })
  }
  return groups
}

/** Input rows have already passed list authorization. Only related document identities leave this function. */
export async function withProcurementSourceDocuments(q: Query, batch: { id: string; company_id: string }, orders: Row[], rawOrders: Row[]): Promise<Row[]> {
  const sourceOrders = orders.filter(order => order.items?.some((item: Row) => item.procurementSource))
  if (!sourceOrders.length) return orders
  const rawById = new Map(rawOrders.map(raw => [text(raw.id), raw]))
  const stockNumbers = [...new Set<string>(sourceOrders.flatMap(order => order.items.flatMap((item: Row) => (item.procurementSource?.records ?? []).filter((r: Row) => r.stockType === '1' && positive(r.quantity) && text(r.stockNumber)).map((r: Row) => r.stockNumber))))]
  const orderNumbers = sourceOrders.filter(order => order.items.some((item: Row) => positive(item.procurementSource?.directQuantity))).map(order => rawById.get(order.id)?.billno).filter(Boolean)
  const numbers = [...new Set([...stockNumbers, ...orderNumbers])]
  const [stockFacts, purchaseRows] = await Promise.all([
    stockNumbers.length ? q.query(`SELECT raw FROM hz_fop_collected_analytics_facts WHERE batch_id=$1 AND company_id=$2 AND entity_type='stock' AND document_number=ANY($3::text[])`, [batch.id, batch.company_id, stockNumbers]) : [],
    numbers.length ? q.query(`SELECT raw FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='purchase' AND COALESCE(raw->>'org_id',raw->'org'->>'id',$2)=$2 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw->'hzkj_billentry')='array' THEN raw->'hzkj_billentry' ELSE '[]'::jsonb END) line WHERE line->>'hzkj_salbillnumber'=ANY($3::text[]) OR line->>'hzkj_srcbillnumber'=ANY($3::text[]))`, [batch.id, batch.company_id, numbers]) : [],
  ])
  return orders.map(order => ({ ...order, items: order.items.map((item: Row) => item.procurementSource ? { ...item, procurementSource: { ...item.procurementSource, documentGroups: procurementDocumentGroups(rawById.get(order.id) ?? {}, item.procurementSource, stockFacts.map(s => s.raw), purchaseRows.map(p => p.raw), batch.company_id) } } : item) }))
}
