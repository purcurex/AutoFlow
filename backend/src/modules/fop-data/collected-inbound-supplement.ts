type Row=Record<string,any>
const fields=['hzkj_entrypurc_status','hzkj_purcqty','hzkj_instock_qty'] as const
const reference=(value:unknown)=>value==null||value===''||String(value)==='0'?null:String(value)
const own=(row:Row,key:string)=>Object.prototype.hasOwnProperty.call(row,key)
const time=(value:unknown)=>typeof value==='string'?Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value)?value:value.replace(' ','T')+'+08:00'):NaN
export function assertInboundFieldCoverage(incoming:Row,previous:Row={}) {
 const prior=new Map<string,Row>((previous.hzkj_orders_billentry??[]).map((line:Row)=>[line.id,line]))
 for(const line of incoming.hzkj_orders_billentry??[])for(const key of fields){
  if(prior.has(line.id)&&own(prior.get(line.id)!,key)&&!own(line,key))throw Error('timestamp_projection_missing_inbound_fact')
 }
}
/** Patch explicit current fields by same-document entry ID; never synthesize quantity or join by SKU. */
export function supplementInboundFacts(prior:Row,source:Row,context:{companyId:string;capturedAt:string}):Row {
 if(source.id!==prior.source_id||source.billno!==prior.order_number||prior.raw?.id!==source.id||prior.raw?.billno!==source.billno)throw Error('inbound_identity_mismatch')
 if(prior.raw?.hzkj_org?.id!==context.companyId||source.org_id!=null&&source.org_id!==context.companyId)throw Error('inbound_company_mismatch')
 const owner=source.hzkj_operator_id==='0'?null:source.hzkj_operator_id??null
 if(owner!==(prior.owner_employee_id??null))throw Error('inbound_owner_changed')
 const modified=time(source.modifytime),previous=time(prior.raw.modifytime),captured=time(context.capturedAt)
 if(!Number.isFinite(modified)||!Number.isFinite(captured)||modified>captured||Number.isFinite(previous)&&modified<previous||time(prior.display?.inboundCapture?.capturedAt)>captured)throw Error('inbound_stale_capture')
 if(!own(source,'hzkj_purchase_status')||!own(source,'hzkj_orders_billentry')||(source.hzkj_orders_billentry!==null&&!Array.isArray(source.hzkj_orders_billentry))||(source.hzkj_orders_billentry??[]).length!==(prior.raw.hzkj_orders_billentry??[]).length)throw Error('inbound_incomplete_document')
 const incoming=new Map<string,Row>()
 for(const line of source.hzkj_orders_billentry??[]){
  if(typeof line.id!=='string'||!line.id||incoming.has(line.id))throw Error('inbound_invalid_line_identity')
  for(const field of fields){
   if(!own(line,field))throw Error('inbound_field_missing')
   const value=line[field]
   if(value!=null&&value!==''&&(field==='hzkj_entrypurc_status'?typeof value!=='string'||value.length>32:!/^\d{1,15}(?:\.\d{1,6})?$/.test(String(value))))throw Error('inbound_invalid_field')
  }
  incoming.set(line.id,line)
 }
 const lines=(prior.raw.hzkj_orders_billentry??[]).map((line:Row)=>{
  const next=incoming.get(line.id)
  if(!next||next.hzkj_local_sku_id!=null&&reference(next.hzkj_local_sku_id)!==reference(line.hzkj_local_sku?.id)||String(next.hzkj_qty)!==String(line.hzkj_qty))throw Error('inbound_line_changed')
  return {...line,...Object.fromEntries(fields.map(key=>[key,next[key]]))}
 })
 const raw={...prior.raw,hzkj_purchase_status:source.hzkj_purchase_status,hzkj_orders_billentry:lines,...(own(source,'hzkj_purchase_status_title')?{hzkj_purchase_status_title:source.hzkj_purchase_status_title}:{})}
 return {...prior,raw,display:{...prior.display,sourcePurchaseStatus:source.hzkj_purchase_status||null,inboundCapture:{source:'queryOrderList',sourceId:source.id,companyId:context.companyId,capturedAt:context.capturedAt,sourceModifiedAt:source.modifytime}}}
}
