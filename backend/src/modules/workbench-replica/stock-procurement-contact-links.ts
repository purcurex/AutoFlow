import { purchaseMatchesSourceSku, purchaseReference } from '../fop-data/collected-purchase-association'
import type { SupplierSourceReference } from '../fop-data/native-supplier-contact'
type Row=Record<string,any>
type Query={query:(sql:string,params?:any[])=>Promise<Row[]>}
export type SupplierPurchaseLink={purchase:Row;references:SupplierSourceReference[];shipmentStatus:'pending'|'partial'}
const positive=(v:unknown)=>v!=null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0

/** Local authorized root -> current consumption -> stock parent -> exact SKU purchase, never a supplier-name search. */
export async function stockProcurementContactLinks(q:Query,batch:{id:string;company_id:string},order:Row,items:Row[]):Promise<SupplierPurchaseLink[]>{
 const uses=items.flatMap(item=>{
  const s=item.procurementSource
  return (s?.records??[]).filter((r:Row)=>r.orderNumber===order.billno&&r.skuId===s.skuId&&['0','1'].includes(r.status)&&positive(r.quantity)&&r.stockPurchaseStatus==='2'&&
   (r.stockType==='1'&&positive(s.fullPaymentQuantity)||r.stockType==='2'&&positive(s.depositQuantity))).map((r:Row)=>({record:r,source:s}))
 })
 if(!uses.length)return []
 const numbers=[...new Set(uses.map(u=>purchaseReference(u.record.stockNumber)).filter(Boolean))]
 if(uses.some(u=>!purchaseReference(u.record.stockNumber)))throw Error('Stock purchase source number missing')
 const [stocks,purchases]=await Promise.all([
  q.query("SELECT raw FROM hz_fop_collected_analytics_facts WHERE batch_id=$1 AND company_id=$2 AND entity_type='stock' AND document_number=ANY($3::text[])",[batch.id,batch.company_id,numbers]),
  q.query(`SELECT raw FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='purchase' AND COALESCE(raw->>'org_id',raw->'org'->>'id',$2)=$2 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw->'hzkj_billentry')='array' THEN raw->'hzkj_billentry' ELSE '[]'::jsonb END) line WHERE line->>'hzkj_salbillnumber'=ANY($3::text[]) OR line->>'hzkj_srcbillnumber'=ANY($3::text[]))`,[batch.id,batch.company_id,numbers]),
 ])
 const links:SupplierPurchaseLink[]=[]
 for(const {record:r,source:s} of uses){
  const parents=stocks.map(row=>row.raw).filter(raw=>raw.billno===r.stockNumber&&String(raw.org_id??raw.org?.id)===batch.company_id)
  if(parents.length!==1||parents[0].id!==r.stockId||parents[0].hzkj_stock_type!==r.stockType)throw Error('Stock source identity is not verified')
  const parent=parents[0]
  const matches=purchases.map(row=>row.raw).filter(raw=>purchaseReference(raw.id)&&purchaseReference(raw.billno)&&raw.hzkj_cancelstatus!=='B'&&
   (!purchaseReference(raw.org_id??raw.org?.id)||String(raw.org_id??raw.org?.id)===batch.company_id)&&(raw.hzkj_billentry??[]).some((line:Row)=>purchaseMatchesSourceSku(line,parent,s.skuId)))
  if(!matches.length)throw Error('Stock downstream purchase linkage missing')
  for(const raw of matches)links.push({purchase:{id:raw.id,number:raw.billno,platformOrderNumber:purchaseReference(raw.hzkj_1688_order_n)},shipmentStatus:'pending',references:[{
   sourceType:r.stockType==='1'?'full_payment':'deposit',parent,skuId:s.skuId,sku:s.sku??r.skuNumber??'',
   consumption:{stockId:r.stockId,recordId:r.recordId,status:r.status,quantity:r.quantity},
  }]})
 }
 return links
}
