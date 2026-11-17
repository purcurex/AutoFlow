import { ChainInput, chainKinds, chainText } from './collected-business-chain'
type Row=Record<string,any>
const timestamp=(v:any):string=>{const s=v instanceof Date?v.toISOString():v;if(typeof s!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(s)||!Number.isFinite(Date.parse(s)))throw Error('capture_timestamp_required');return s}
/** Choose whole captured records, never combine fields from different source versions. */
export function collectedChainInputs(batch:Row,orders:Row[],entities:Row[],analytics:Row[]){
 const inputs=new Map<string,ChainInput>(),conflicts=new Map<string,number>();let receiptLinks:Record<string,string>={}
 const put=(v:ChainInput)=>{if(!chainKinds[v.kind]||!chainText(v.raw.id))return;const key=v.kind+':'+v.raw.id,prior=inputs.get(key);if(!prior||v.raw.timestampProjection?.version===1&&prior.raw.timestampProjection?.version!==1||v.raw.timestampProjection?.version===prior.raw.timestampProjection?.version&&Date.parse(v.capturedAt)>Date.parse(prior.capturedAt))inputs.set(key,v)}
 for(const o of orders){const {native_allocation,native_procurement,...original}=o.raw
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
 return {ordered:[...inputs.values()].sort((a,b)=>(a.kind+':'+a.raw.id).localeCompare(b.kind+':'+b.raw.id)),receiptLinks,unresolvedConflicts}
}
