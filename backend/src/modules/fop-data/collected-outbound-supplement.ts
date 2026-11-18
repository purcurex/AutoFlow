import { orderBusinessStatus, withOrderBusinessStatus } from './order-business-status'
import Decimal from 'decimal.js'
type Row=Record<string,any>
const own=(row:Row,key:string)=>Object.prototype.hasOwnProperty.call(row,key)
const field='hzkj_delivery_status'
export const lineOutboundFields=['hzkj_outbound_status','hzkj_outbound_qty'] as const
const time=(value:unknown)=>typeof value==='string'?Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value)?value:value.replace(' ','T')+'+08:00'):NaN

/** Missing keys cannot erase a previous captured fact. Explicit null remains unknown. */
export function assertOutboundFieldCoverage(incoming:Row,previous:Row={}) {
 if(own(previous,field)&&!own(incoming,field))throw Error('timestamp_projection_missing_outbound_status')
 if(own(incoming,field)&&![null,'','0','1','2'].includes(incoming[field]))throw Error('timestamp_projection_invalid_outbound_status')
 const previousLines=new Map<string,Row>((previous.hzkj_orders_billentry??[]).map((line:Row)=>[String(line.id),line]))
 for(const line of incoming.hzkj_orders_billentry??[])for(const key of lineOutboundFields){
  const prior=previousLines.get(String(line.id))
  if(prior&&own(prior,key)&&!own(line,key))throw Error('timestamp_projection_missing_line_outbound_fact')
  if(!own(line,key))continue
  const value=line[key]
  if(key==='hzkj_outbound_status'?![null,'','0','1'].includes(value):value!==null&&value!==''&&(!['string','number'].includes(typeof value)||!/^\d{1,15}(?:\.\d{1,6})?$/.test(String(value))))throw Error('timestamp_projection_invalid_line_outbound_fact')
 }
}

/** Same-order, same-entry field repair. Missing fields are never interpreted as zero. */
export function supplementOutboundLineFacts(prior:Row,source:Row,context:{companyId:string;capturedAt:string;operation?:'queryOrderList'|'queryOrderDetail'}):Row {
 // Reuse parent/company/ownership/time and unchanged order-membership checks.
 const header=supplementOutboundStatus(prior,source,context)
 if(time(prior.display?.lineOutboundCapture?.capturedAt)>time(context.capturedAt))throw Error('outbound_stale_capture')
 if(!own(source,'hzkj_orders_billentry')||(source.hzkj_orders_billentry!==null&&!Array.isArray(source.hzkj_orders_billentry)))throw Error('outbound_entries_missing')
 const incoming=new Map<string,Row>()
 for(const line of source.hzkj_orders_billentry??[]){
  if(typeof line.id!=='string'||!line.id||incoming.has(line.id))throw Error('outbound_invalid_line_identity')
  for(const key of lineOutboundFields)if(!own(line,key))throw Error('outbound_line_field_missing')
  incoming.set(line.id,line)
 }
 const previous:Row[]=prior.raw.hzkj_orders_billentry??[]
 if(incoming.size!==previous.length)throw Error('outbound_incomplete_document')
 const lines=previous.map(line=>{
  const next=incoming.get(String(line.id))
  const reference=(v:any)=>v==null||v===''||String(v)==='0'?null:String(v)
  if(!next||reference(next.hzkj_local_sku_id??next.hzkj_local_sku?.id)!==reference(line.hzkj_local_sku?.id??line.hzkj_local_sku_id))throw Error('outbound_line_changed')
  try{if(!new Decimal(next.hzkj_qty).eq(new Decimal(line.hzkj_qty)))throw Error()}catch{throw Error('outbound_line_quantity_changed')}
  return {...line,...Object.fromEntries(lineOutboundFields.map(key=>[key,next[key]]))}
 })
 // A concurrent full sync may already contain newer facts even when the source
 // modification timestamp has second-level precision or was not updated.
 if(time(prior.raw.timestampProjection?.capturedAt)>time(context.capturedAt)&&previous.some(line=>lineOutboundFields.some(key=>own(line,key)))){
  const same=prior.raw[field]===source[field]&&previous.every((line,index)=>lineOutboundFields.every(key=>own(line,key)&&line[key]===lines[index][key]))
  if(same)return prior
  throw Error('outbound_stale_capture')
 }
 const raw={...header.raw,hzkj_orders_billentry:lines}
 const display=withOrderBusinessStatus({...prior.display,sourceOutboundStatus:header.display.sourceOutboundStatus},raw,context.companyId,{persistedExceptions:true})
 const issues=(display.nativeAssociationIssues??[]).filter((issue:string)=>issue!=='current_source_outbound_status_unknown')
 if(display.businessStatus.outbound==='unknown')issues.push('current_source_outbound_status_unknown')
 return {...header,raw,display:{...display,nativeAssociationIssues:issues,lineOutboundCapture:{...header.display.outboundCapture,fields:[field,...lineOutboundFields]}}}
}

/** A field-only repair from a verified company scan; do not replace unrelated source facts. */
export function supplementOutboundStatus(prior:Row,source:Row,context:{companyId:string;capturedAt:string;operation?:'queryOrderList'|'queryOrderDetail'}):Row {
 if(!own(source,field))throw Error('outbound_field_missing')
 assertOutboundFieldCoverage(source)
 if(source.id!==prior.source_id||source.billno!==prior.order_number||prior.raw?.id!==source.id||prior.raw?.billno!==source.billno)throw Error('outbound_source_identity_mismatch')
 if(prior.raw?.hzkj_org?.id!==context.companyId||[source.org_id,source.hzkj_org_id,source.org?.id,source.hzkj_org?.id].some(id=>id!=null&&id!==context.companyId))throw Error('outbound_company_mismatch')
 const sourceOwner=source.hzkj_operator_id==='0'?null:source.hzkj_operator_id??null
 if(sourceOwner!==(prior.owner_employee_id??null))throw Error('outbound_owner_changed')
 // The independently captured outbound fact does not replace bill audit status.
 // Payment/order membership must still match the local pending-outbound predicate.
 for(const key of ['hzkj_orderstatus','hzkj_receipt_status'])if(own(prior.raw,key)&&prior.raw[key]!==source[key])throw Error('outbound_parent_state_changed')
 const modified=time(source.modifytime),previous=time(prior.raw.modifytime),captured=time(context.capturedAt)
 if(!Number.isFinite(modified)||!Number.isFinite(captured)||modified>captured||Number.isFinite(previous)&&modified<previous||time(prior.display?.outboundCapture?.capturedAt)>captured)throw Error('outbound_stale_capture')
 const raw={...prior.raw,[field]:source[field]},businessStatus=orderBusinessStatus(raw)
 const issues=(prior.display.nativeAssociationIssues??[]).filter((issue:string)=>issue!=='current_source_outbound_status_unknown')
 if(businessStatus.outbound==='unknown')issues.push('current_source_outbound_status_unknown')
 const value=source[field]||null
 return {...prior,raw,raw_delivery_status:value,display:{...prior.display,sourceOutboundStatus:value,businessStatus,nativeAssociationIssues:issues,
  outboundCapture:{source:context.operation??'queryOrderList',sourceId:source.id,companyId:context.companyId,capturedAt:context.capturedAt,sourceModifiedAt:source.modifytime}}}
}
