import { ChainInput, chainKinds, chainText } from './collected-business-chain'
import { supplementOutboundLineFacts } from '../fop-data/collected-outbound-supplement'
type Row=Record<string,any>
const timestamp=(v:any):string=>{const s=v instanceof Date?v.toISOString():v;if(typeof s!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(s)||!Number.isFinite(Date.parse(s)))throw Error('capture_timestamp_required');return s}
/** Choose whole records; independently verified field repairs retain their own provenance. */
export function collectedChainInputs(batch:Row,orders:Row[],entities:Row[],analytics:Row[]){
 const inputs=new Map<string,ChainInput>(),conflicts=new Map<string,number>(),orderOriginals=new Map<string,Row>();let receiptLinks:Record<string,string>={}
 const put=(v:ChainInput)=>{if(!chainKinds[v.kind]||!chainText(v.raw.id))return;const key=v.kind+':'+v.raw.id,prior=inputs.get(key);if(!prior||v.raw.timestampProjection?.version===1&&prior.raw.timestampProjection?.version!==1||v.raw.timestampProjection?.version===prior.raw.timestampProjection?.version&&Date.parse(v.capturedAt)>Date.parse(prior.capturedAt))inputs.set(key,v)}
 for(const o of orders){const {native_allocation,native_procurement,...original}=o.raw
  orderOriginals.set(original.id,original)
  put({kind:'fulfillment',raw:original,capturedAt:timestamp(original.timestampProjection?.capturedAt??batch.source_as_of),display:o.display})
  // shipping retains the native allocation-family timestamp even after a later standalone allocation capture.
  for(const [raw,key]of [[native_allocation,'shipping'],[native_procurement,'procurement']]as const){const at=batch.metadata?.entityCaptures?.[key]?.capturedAt;if(raw&&at&&original.timestampProjection?.version!==1)put({kind:'fulfillment',raw,capturedAt:timestamp(at),display:o.display})}
 }
 for(const e of entities){if(e.entity_type==='native_links'&&e.source_id==='receiptLinks'){receiptLinks={...e.raw.values};for(const key of e.raw.conflicts??[])delete receiptLinks[key];continue}
  const at=timestamp(e.captured_at);if(e.raw.versions){conflicts.set(e.entity_type+':'+e.source_id,Date.parse(at));continue}
  put({kind:e.entity_type,raw:e.raw,capturedAt:at,display:e.display})
 }
 for(const a of analytics){if(a.company_id!==batch.company_id)throw Error('cross_company_analytics');put({kind:a.entity_type,raw:a.raw,capturedAt:timestamp(a.captured_at)})}
 let unresolvedConflicts=0
 for(const[key,at]of conflicts){const selected=inputs.get(key);if(!selected||selected.raw.timestampProjection?.version!==1&&Date.parse(selected.capturedAt)<=at){inputs.delete(key);unresolvedConflicts++}}
 // A later legacy allocation/procurement snapshot may win whole-record selection
 // while lacking an explicitly repaired field. Revalidate document membership,
 // company, owner, source time, entry ID, SKU and quantity before carrying it over.
 for(const order of orders){
  const capture=order.display?.lineOutboundCapture,selected=inputs.get('fulfillment:'+order.raw.id)
  if(!capture||!selected||selected.raw===orderOriginals.get(order.raw.id)||!['queryOrderList','queryOrderDetail'].includes(capture.source))continue
  if(capture.sourceId!==order.raw.id||capture.companyId!==batch.company_id)throw Error('outbound_capture_scope_mismatch')
  if(Date.parse(timestamp(capture.capturedAt))<Date.parse(selected.capturedAt))continue
  const raw=selected.raw,source={...order.raw,org_id:batch.company_id,
   hzkj_operator_id:order.raw.hzkj_operator_id??order.raw.hzkj_operator?.id??null,modifytime:capture.sourceModifiedAt}
  const owner=raw.hzkj_operator_id??raw.hzkj_operator?.id??null
  const prior={source_id:raw.id,order_number:raw.billno,owner_employee_id:owner==='0'?null:owner,
   raw,display:{...selected.display,id:raw.id}}
  const repaired=supplementOutboundLineFacts(prior,source,{companyId:batch.company_id,capturedAt:capture.capturedAt,operation:capture.source})
  inputs.set('fulfillment:'+raw.id,{...selected,raw:repaired.raw,display:{...selected.display,lineOutboundCapture:capture}})
 }
 return {ordered:[...inputs.values()].sort((a,b)=>(a.kind+':'+a.raw.id).localeCompare(b.kind+':'+b.raw.id)),receiptLinks,unresolvedConflicts}
}
