import Decimal from 'decimal.js'
import { normalizeCollectedStock } from './collected-stock-normalizer'
type Row=Record<string,any>
const number=(value:unknown)=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Math.abs(Number(value))<=Number.MAX_SAFE_INTEGER?Number(value):null
/** Offline projection of the same stock document. Never performs remote reads. */
export function projectCollectedStockNative(fact:Row,tenantId:string,companyId:string,existing?:Row):Row|null {
 const raw=fact.raw,f=fact.facts
 if(fact.entity_type!=='stock'||fact.company_id!==companyId||String(raw?.org_id)!==companyId||String(raw?.id)!==fact.source_id||raw?.billno!==fact.document_number)throw Error('stock_native_identity_mismatch')
 if(existing&&(existing.source_id!==fact.source_id||existing.display.stockNumber!==fact.document_number))throw Error('stock_native_existing_identity_mismatch')
 if(!Number.isFinite(Date.parse(fact.captured_at)))throw Error('stock_native_capture_required')
 if(existing&&Date.parse(existing.captured_at)>Date.parse(fact.captured_at))return null
 const old=existing?.display??{}
 // FOP AmountField hzkj_order_amount binds hzkj_settlecurrency (default USD), not base hzkj_currency.
 const value=raw.hzkj_order_amount
 const parsed=(typeof value==='string'||typeof value==='number')&&/^-?\d+(?:\.\d+)?$/.test(String(value))?number(value):null
 const amount=parsed!==null&&new Decimal(String(parsed)).eq(String(value))?parsed:null
 const code=raw.hzkj_settlecurrency_number??raw.hzkj_settlecurrency?.number
 const currency=typeof code==='string'&&/^[A-Z]{3}$/.test(code)?code:code==null||code===''?'USD':null
 const row=normalizeCollectedStock({...old,id:fact.source_id,tenantId,stockNumber:fact.document_number,
  rawOrderStatus:raw.hzkj_orderstatus??null,rawBillStatus:raw.billstatus??null,
  // Owner scope uses the importer-verified stable employee id, never a display name.
  owner:fact.owner_employee_id?{id:fact.owner_employee_id,name:f.sourceOwner?.name??old.owner?.name??null}:null,
  department:old.department??null,customerId:f.customer?.id??null,customerCode:f.customer?.number??null,customerName:f.customer?.name??null,
  stockType:({'1':'full_payment','2':'deposit'} as Row)[raw.hzkj_stock_type]??null,
  purchaseStatus:({'0':'unpurchased','1':'partial','2':'in_progress','3':'received','4':'shipped'} as Row)[raw.hzkj_purchase_status]??'unknown',
  createdAt:fact.created_at?new Date(fact.created_at).toISOString():null,paidAt:fact.paid_at?new Date(fact.paid_at).toISOString():null,
  warehouse: f.warehouse?.name??null,warehouseCode:old.warehouseCode??f.warehouse?.number??null,
  amount,currency,
  amountBasis:'hzkj_order_amount',currencyBasis:code?'source_hzkj_settlecurrency':'stock_metadata_default_usd',
  items:old.items??(Array.isArray(raw.hzkj_orders_billentry)?f.lines.map((line:Row)=>({sku:line.sku?.number??'',name:line.sku?.name??'',quantity:number(line.quantities?.quantity),variant:'',imageUrl:null})):undefined),
 },{tenantId})
 row.nativeStockSource={entity:'hzkj_stock_order_new',sourceId:fact.source_id,capturedAt:new Date(fact.captured_at).toISOString()}
 return row
}
