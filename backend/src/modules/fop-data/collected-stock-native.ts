import Decimal from 'decimal.js'
import { normalizeCollectedStock } from './collected-stock-normalizer'
import { stockOrderState, stockPurchaseState } from './stock-native-status'
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
  ...stockOrderState(raw.hzkj_orderstatus,raw.hzkj_orderstatus_title),rawBillStatus:raw.billstatus??null,
  // Owner scope uses the importer-verified stable employee id, never a display name.
  owner:fact.owner_employee_id?{id:fact.owner_employee_id,name:f.sourceOwner?.name??old.owner?.name??null}:null,
  department:old.department??null,customerId:f.customer?.id??null,customerCode:f.customer?.number??null,customerName:f.customer?.name??null,
  stockType:({'1':'full_payment','2':'deposit'} as Row)[raw.hzkj_stock_type]??null,
  ...stockPurchaseState(raw.hzkj_purchase_status,raw.hzkj_purchase_status_title),
  createdAt:fact.created_at?new Date(fact.created_at).toISOString():null,paidAt:fact.paid_at?new Date(fact.paid_at).toISOString():null,
  warehouse: f.warehouse?.name??null,warehouseCode:old.warehouseCode??f.warehouse?.number??null,
  amount,currency,
  amountBasis:'hzkj_order_amount',currencyBasis:code?'source_hzkj_settlecurrency':'stock_metadata_default_usd',
  items:Array.isArray(raw.hzkj_orders_billentry)?raw.hzkj_orders_billentry.map((line:Row)=>{
   const sku=line.hzkj_local_sku_number??line.hzkj_local_sku?.number??''
   const matches=(old.items??[]).filter((item:Row)=>item.sku===sku),prior=matches.length===1?matches[0]:{}
   // Reuse only product presentation, never prior quantities or document relationships.
   return {id:line.id,sku,name:line.hzkj_local_sku_hzkj_public_title??line.hzkj_local_sku?.hzkj_public_title??prior.name??'',quantity:number(line.hzkj_qty),variant:line.hzkj_local_sku_hzkj_sku_value??line.hzkj_local_sku?.hzkj_sku_value??'',imageUrl:line.hzkj_local_sku_hzkj_picturefield??line.hzkj_local_sku?.hzkj_picturefield??prior.imageUrl??null}
  }):undefined,
 },{tenantId})
 row.nativeStockSource={entity:'hzkj_stock_order_new',sourceId:fact.source_id,capturedAt:new Date(fact.captured_at).toISOString()}
 return row
}
