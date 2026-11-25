import { withVirtualProductFacts } from '../fop-data/physical-business-lines'
import { physicalBusinessProjection } from '../fop-data/physical-business-projection'
import { projectPurchaseOrderRows, purchaseGroupFacts, purchaseSalesReference } from '../fop-data/collected-purchase-association'
import Decimal from 'decimal.js'
import type { QueryRunner } from 'typeorm'
import { normalizeCollectedOrder } from '../fop-data/collected-order-normalizer'
import { normalizeCollectedAllocation } from '../fop-data/collected-allocation'
import { normalizeCollectedAnalyticsFact } from '../fop-data/collected-analytics-facts'
import { normalizeCollectedRma, collectedRmaParents } from '../fop-data/collected-rma'
import { actualChannelChineseName } from '../fop-data/collected-actual-channel'
import { assertInboundFieldCoverage } from '../fop-data/collected-inbound-supplement'
import { assertOutboundFieldCoverage } from '../fop-data/collected-outbound-supplement'
import { retainCapturedStoreName } from '../fop-data/collected-store-name'
import { scopedPurchaseGroup } from '../fop-data/collected-native-facts'
import { normalizeTimestampProjectionRaw, TIMESTAMP_PROJECTION_KINDS } from './timestamp-projection-normalizer'
import { collectedChainInputs } from './collected-chain-inputs'
import { buildCollectedBusinessChain } from './collected-business-chain'
import type { TimestampScope } from './timestamp-sync'
import { readStockConsumptionSnapshot } from './collected-stock-consumptions'

type Row=Record<string,any>
const kinds:Record<string,string>=TIMESTAMP_PROJECTION_KINDS
const text=(v:unknown):string|null=>typeof v==='string'&&v.trim()?v.trim():null
const json=(v:unknown)=>JSON.stringify(v)
const ref=(r:Row,key:string,part='id')=>text(r?.[key+'_'+part]??r?.[key]?.[part])
const key=(kind:string,id:string)=>kind+':'+id
const canonical=(v:any):string=>v&&typeof v==='object'?(Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'):JSON.stringify(v)
const quantity=(v:unknown):number|null=>{try{if(v===null||v===undefined||v==='')return null;const d=new Decimal(String(v)),n=d.toNumber();return d.isFinite()&&d.gte(0)&&n<=Number.MAX_SAFE_INTEGER&&new Decimal(String(n)).eq(d)?n:null}catch{return null}}
const time=(v:any)=>v instanceof Date?v.toISOString():String(v)

/** Per-record publication, not full-family import. All calls run inside the capture commit transaction. */
export async function publishTimestampProjections(q:QueryRunner,scope:TimestampScope){
 const required=['hz_fop_collected_analytics_facts','hz_fop_collected_chains','hz_fop_source_documents','hz_fop_document_relations']
 for(const name of required){const [{present}]=await q.query('SELECT to_regclass($1) IS NOT NULL AS present',[name]);if(!present)return {available:false,applied:0,blocked:[{reason:'timestamp_projection_schema_missing',table:name}],rebuildChain:false}}
 const [batch]=await q.query('SELECT * FROM hz_fop_collected_batches WHERE id=$1 FOR UPDATE',[scope.batchId])
 const tasks:Row[]=await q.query("SELECT p.entity_code,p.source_id,p.run_id,p.removed,p.current_raw,d.captured_at FROM hz_fop_timestamp_projection_tasks p JOIN hz_fop_timestamp_documents d USING(batch_id,entity_code,source_id) WHERE p.batch_id=$1 AND p.state='pending' ORDER BY CASE p.entity_code WHEN 'hzkj_orders' THEN 0 WHEN 'hzkj_alloc_bill' THEN 1 WHEN 'hzkj_deliver_bill' THEN 2 ELSE 3 END,p.source_id",[scope.batchId])
 // Empty captures with no pending work do not scan/rebuild the entire collected graph.
 if(!tasks.length&&!batch.metadata?.timestampOwnershipPending)return {available:true,applied:0,blocked:[],rebuildChain:false,remaining:0,publishedEntities:[]}
 const orderRows:Row[]=await q.query('SELECT * FROM hz_fop_collected_orders WHERE batch_id=$1',[scope.batchId])
 const entityRows:Row[]=await q.query('SELECT * FROM hz_fop_collected_entities WHERE batch_id=$1',[scope.batchId])
 const analytics:Row[]=await q.query('SELECT * FROM hz_fop_collected_analytics_facts WHERE batch_id=$1',[scope.batchId])
 const orders=new Map<string,Row>(orderRows.map(r=>[r.source_id,r])),entities=new Map<string,Row>(entityRows.map(r=>[key(r.entity_type,r.source_id),r]))
 const touchedOrders=new Set<string>(),headerIds=new Set<string>(),touchedEntities=new Set<string>(),deletedDemand=new Set<string>(),accepted:Row[]=[],blocked:Row[]=[]
 const changedOrderNumbers=new Set<string>(),changedDispatchNumbers=new Set<string>()
 const rememberNumber=(set:Set<string>,number:unknown)=>{const n=text(number);if(n)set.add(n)}
 const block=async(task:Row,reason:string)=>{blocked.push({entityCode:task.entity_code,sourceId:task.source_id,reason});await q.query("UPDATE hz_fop_timestamp_projection_tasks SET reason=$4,updated_at=now() WHERE batch_id=$1 AND entity_code=$2 AND source_id=$3",[scope.batchId,task.entity_code,task.source_id,reason])}
 for(const task of tasks){
  const kind=kinds[task.entity_code]
  if(!kind)continue
  if(task.removed){await block(task,'timestamp_projection_deletion_requires_verified_rebuild');continue}
  let raw:Row
  try{raw=normalizeTimestampProjectionRaw(task.entity_code,task.current_raw,scope.companyId,kind==='purchase'?entities.get(key(kind,task.source_id))?.raw:undefined)}catch(error){await block(task,error instanceof Error&&/^timestamp_projection_[a-z_]+$/.test(error.message)?error.message:'timestamp_projection_source_shape_incomplete');continue}
  raw.timestampProjection={...raw.timestampProjection,capturedAt:time(task.captured_at),runId:task.run_id}
  if(kind==='fulfillment'){
   try{assertOutboundFieldCoverage(raw,orders.get(task.source_id)?.raw);assertInboundFieldCoverage(raw,orders.get(task.source_id)?.raw)}catch(error){await block(task,(error as Error).message);continue}
   rememberNumber(changedOrderNumbers,orders.get(task.source_id)?.order_number)
   rememberNumber(changedOrderNumbers,raw.billno)
   const row=retainCapturedStoreName(normalizeCollectedOrder(raw,{companyId:scope.companyId}),orders.get(task.source_id))
   row.display.timestampProjection=raw.timestampProjection
   row.display.dataQuality={...row.display.dataQuality,mode:'collected',syncMode:'timestamp',reasons:['eventual_timestamp_capture','source_deletions_and_uncaptured_changes_unproven']}
   orders.set(task.source_id,{batch_id:scope.batchId,...row});touchedOrders.add(task.source_id);headerIds.add(task.source_id)
  }else{
   // An omitted relationship field is not evidence that a previously known relationship was removed.
   const relationship=kind==='allocation'?'hzkj_order_id':kind==='dispatch'?'hzkj_order_no':'hzkj_deliver_billno'
   if(kind!=='purchase'&&!Object.prototype.hasOwnProperty.call(task.current_raw,relationship)){await block(task,'timestamp_projection_missing_'+relationship);continue}
   const k=key(kind,task.source_id),prior=entities.get(k)
   if(prior?.display?.sourceOrderId)touchedOrders.add(prior.display.sourceOrderId)
   if(kind==='purchase')for(const row of prior?.display?.rows??[])if(row.orderId)touchedOrders.add(row.orderId)
   if(kind==='dispatch'){rememberNumber(changedDispatchNumbers,prior?.raw.billno);rememberNumber(changedDispatchNumbers,raw.billno)}
   entities.set(k,{batch_id:scope.batchId,entity_type:kind,source_id:task.source_id,raw,display:{},owner_employee_id:null,captured_at:time(task.captured_at)});touchedEntities.add(k)
  }
  accepted.push(task)
 }
 const byNumber=new Map<string,Row|null>()
 for(const row of orders.values())byNumber.set(row.order_number,byNumber.has(row.order_number)?null:row)
 const verifiedParent=(raw:Row,kind:string)=>{
  const parent=kind==='allocation'?orders.get(text(raw.hzkj_order_id)??''):byNumber.get(text(raw.hzkj_order_no)??'')
  if(!parent||kind==='allocation'&&text(raw.hzkj_order_no)&&raw.hzkj_order_no!==parent.order_number)return null
  const customer=ref(raw,'hzkj_customer');if(kind==='dispatch'&&customer&&customer!==parent.customer_id)return null
  return parent
 }
 for(const kind of ['allocation','dispatch'])for(const [k,e] of entities){
  if(e.entity_type!==kind)continue
  const p=verifiedParent(e.raw,kind),oldRoot=e.display?.sourceOrderId
  if(!touchedEntities.has(k)&&!headerIds.has(oldRoot)&&!headerIds.has(p?.source_id)&&!changedOrderNumbers.has(text(e.raw.hzkj_order_no)??''))continue
  if(oldRoot)touchedOrders.add(oldRoot);if(p)touchedOrders.add(p.source_id)
  let display:Row
  if(kind==='allocation'){
   try{display=normalizeCollectedAllocation(e.raw,scope.companyId)}catch{display={id:e.source_id,number:e.raw.billno,rawBillStatus:e.raw.billstatus??null,rawAllocationStatus:null,sourceOrderId:null}}
  }else{
   const raw=e.raw,track=(field:string,type:string)=>text(raw[field])?[{type,number:text(raw[field])}]:[]
   display={id:e.source_id,number:raw.billno,rawBillStatus:raw.billstatus??null,status:({A:'draft',B:'submitted',C:'approved'} as Row)[raw.billstatus]??'unknown',deliveryStatus:text(raw.hzkj_delivery_status),sourceFulfillmentStatus:raw.hzkj_fulfillment_status??null,rawInterceptStatus:raw.hzkj_ship_block_state??null,approvedAt:raw.auditdate??null,channelName:actualChannelChineseName(ref(raw,'hzkj_logistics_channel1','name')),channelCode:ref(raw,'hzkj_logistics_channel1','number'),carrierName:ref(raw,'hzkj_logistics_providers','name'),trackingNumbers:[...track('hzkj_logistics_orderno','full'),...track('hzkj_logistics_trackno','last_mile')]}
  }
  e.display={...display,sourceOrderId:p?.source_id??null,association:{state:p?'verified':'unresolved',basis:'current_local_source_reference',consistentSnapshot:false}}
  e.owner_employee_id=p?.owner_employee_id??null;touchedEntities.add(k)
  if(kind==='dispatch')rememberNumber(changedDispatchNumbers,e.raw.billno)
 }
 const dispatchByNumber=new Map<string,Row|null>()
 for(const e of entities.values())if(e.entity_type==='dispatch'&&text(e.raw.billno))dispatchByNumber.set(e.raw.billno,dispatchByNumber.has(e.raw.billno)?null:e)
 for(const[k,e]of entities){
  if(e.entity_type!=='delivery_notice')continue
  const d=dispatchByNumber.get(text(e.raw.hzkj_deliver_billno)??''),root=d?.display?.association?.state==='verified'?d.display.sourceOrderId:null
  if(!touchedEntities.has(k)&&!touchedEntities.has(key('dispatch',d?.source_id))&&!headerIds.has(e.display?.sourceOrderId)&&!changedDispatchNumbers.has(text(e.raw.hzkj_deliver_billno)??''))continue
  if(e.display?.sourceOrderId)touchedOrders.add(e.display.sourceOrderId);if(root)touchedOrders.add(root)
  e.display={id:e.source_id,number:e.raw.billno,rawBillStatus:e.raw.billstatus??null,sourceDispatchId:d?.source_id??null,sourceOrderId:root,association:{state:root?'verified':'unresolved',basis:'unique_dispatch_number'}}
  e.owner_employee_id=root?orders.get(root)?.owner_employee_id??null:null;touchedEntities.add(k)
 }
 // Rebuild arrays from current local facts, including old and new roots. Do not carry an old tracking number forward.
 const dispatchByParent=new Map<string,Row[]>(),allocationByParent=new Map<string,Row[]>()
 for(const e of entities.values()){const parent=e.display?.sourceOrderId;if(!parent||e.display?.association?.state!=='verified')continue;const target=e.entity_type==='dispatch'?dispatchByParent:e.entity_type==='allocation'?allocationByParent:null;if(target){if(!target.has(parent))target.set(parent,[]);target.get(parent)!.push(e.display)}}
 for(const id of touchedOrders){
  const o=orders.get(id);if(!o)continue
  const dispatches=dispatchByParent.get(id)??[]
  const allocations=allocationByParent.get(id)??[]
  const active=allocations.filter(a=>a.rawAllocationStatus!=='voided'),allApproved=active.length>0&&active.every(a=>a.rawBillStatus==='C'),ready=active.length>0&&active.every(a=>a.rawAllocationStatus==='completed')
  const effective=(d:Row)=>d.rawInterceptStatus!=='CANCELLED'&&d.deliveryStatus!=='CANCELLED'
  const coverage=batch.metadata?.entityCaptures?.shipping?.coverage==='full_parent_scan'||batch.metadata?.entityCaptures?.dispatch?.coverage==='full_parent_scan'
  const dispatchKnown=coverage||dispatches.length>0||Array.isArray(o.display?.dispatchDocuments)
  const logistics=(docs:Row[])=>docs.map(d=>({channelName:d.channelName,channelCode:d.channelCode,carrierName:d.carrierName,trackingNumbers:d.trackingNumbers}))
  o.display={...o.display,nativeFactsCaptured:dispatchKnown&&(allocations.length>0||['full_parent_scan','full_company_scan'].includes(batch.metadata?.entityCaptures?.allocation?.coverage)||batch.metadata?.entityCaptures?.shipping?.coverage==='full_parent_scan'),dispatchDocuments:dispatchKnown?dispatches:null,dispatchLogistics:dispatchKnown?logistics(dispatches.filter(effective)):null,warehouseLogistics:dispatchKnown?logistics(dispatches.filter(d=>effective(d)&&d.rawBillStatus==='C')):null,allocationDocuments:allocations.length?allocations:null,nativeShippingReady:active.length&&active.every(a=>a.rawAllocationStatus&&a.rawBillStatus)&&dispatchKnown?allApproved&&ready&&dispatches.some(d=>effective(d)&&d.rawBillStatus==='C'):null,nativeAssociationIssues:dispatchKnown?[]:['timestamp_relation_coverage_unknown'],fulfillmentProgress:{...o.display.fulfillmentProgress,allocationCreated:active.length?true:null,allocationReview:allApproved?'approved':active.some(a=>['A','B'].includes(a.rawBillStatus))?'pending':'unknown',stockReadiness:ready?'ready':active.some(a=>['pending','available'].includes(a.rawAllocationStatus))?'incomplete':'unknown'}}
 }
 // Build a local graph once to re-evaluate ownership of existing dependent displays and analysis rows.
 const acceptedKeys=new Set(accepted.map(t=>key(kinds[t.entity_code],t.source_id)))
 const candidateAnalytics=analytics.filter(a=>!acceptedKeys.has(key(a.entity_type,a.source_id)))
 const inputs=collectedChainInputs(batch,[...orders.values()],[...entities.values()],candidateAnalytics)
 const graph=buildCollectedBusinessChain({connectionId:'projection',companyId:'projection',sourceCompanyId:scope.companyId,datasetId:'projection'},inputs.ordered,inputs.receiptLinks)
 const docById=new Map(graph.documents.map(d=>[d.id,d])),roots=new Map<string,Set<string>>()
 for(const relation of graph.relations){if(docById.get(relation.rootId)?.kind!=='fulfillment')continue;const d=docById.get(relation.toId)!;const k=key(d.kind,d.sourceId);if(!roots.has(k))roots.set(k,new Set());roots.get(k)!.add(relation.rootSourceId)}
 const graphDocuments=new Map(graph.documents.map(d=>[key(d.kind,d.sourceId),d]))
 const relationByDocument=new Map<string,Row[]>(),issueDocuments=new Set(graph.issues.map(i=>i.documentId))
 for(const r of graph.relations){if(!relationByDocument.has(r.toId))relationByDocument.set(r.toId,[]);relationByDocument.get(r.toId)!.push(r)}
 const completeOwnership=(k:string,raw?:Row)=>{
  const d=graphDocuments.get(k);if(!d||issueDocuments.has(d.id)||raw&&d.raw!==raw&&canonical(d.raw)!==canonical(raw))return false
  const relations=relationByDocument.get(d.id)??[]
  if(!relations.length||relations.some(r=>docById.get(r.rootId)?.kind!=='fulfillment'))return false
  const entries=d.kind==='purchase'?d.raw.hzkj_billentry:d.kind==='receipt'?d.raw.entryentity:[]
  const resolved=new Set(relations.map(r=>r.toEntryId))
  return !entries||Array.isArray(entries)&&entries.every((l:Row)=>text(l.id)&&resolved.has(l.id))
 }
 const rmaParents=headerIds.size?collectedRmaParents([...orders.values()],[],scope.companyId):[]
 const rmaByNumber=new Map<string,typeof rmaParents>()
 for(const p of rmaParents){if(!rmaByNumber.has(p.order_number))rmaByNumber.set(p.order_number,[]);rmaByNumber.get(p.order_number)!.push(p)}
 const headerOrderNumbers=changedOrderNumbers
 const hasAffected=(ids:any)=>Array.isArray(ids)&&ids.some(id=>touchedOrders.has(id))
 for(const[k,e]of entities){
  if(['allocation','dispatch','delivery_notice'].includes(e.entity_type))continue
  if(e.entity_type==='rma'&&(headerIds.has(e.display?.sourceOrderId)||headerOrderNumbers.has(e.raw?.case?.hzkj_srcnumber))){
   if(e.raw?.case&&text(e.raw.payerCustomerId)){
    const result=normalizeCollectedRma(e.raw.case,{companyId:scope.companyId,payerCustomerId:e.raw.payerCustomerId,parents:rmaByNumber.get(e.raw.case.hzkj_srcnumber)??[]})
    e.display=result.display;e.owner_employee_id=result.ownerEmployeeId
   }else{e.display={...e.display,sourceOrderId:null,rmaAssociation:{...e.display?.rmaAssociation,state:'timestamp_parent_revalidation_missing'},owner:null};e.owner_employee_id=null}
   touchedEntities.add(k)
  }else if(e.entity_type==='purchase'&&!e.raw.versions&&(touchedEntities.has(k)||(e.display?.rows??[]).some((r:Row)=>headerIds.has(r.orderId))||(e.raw.hzkj_billentry??[]).some((l:Row)=>headerOrderNumbers.has(purchaseSalesReference(l).number??'')))){
   for(const r of e.display.rows??[])if(r.orderId)touchedOrders.add(r.orderId)
   const projected=projectPurchaseOrderRows(e.raw,n=>{const p=byNumber.get(n);return p?withVirtualProductFacts(p.raw,id=>entities.get(key('product',id))?.raw):undefined},id=>orders.get(id)?.display)
   e.display=scopedPurchaseGroup(purchaseGroupFacts(e.raw,projected.rows,projected.unresolved),null)
   e.owner_employee_id=null
   for(const r of projected.rows)if(r.orderId)touchedOrders.add(r.orderId)
   touchedEntities.add(k)
  }else if(e.entity_type==='purchase_demand'&&(e.display?.rows??[]).some((r:Row)=>headerIds.has(r.orderId))){
   const linkedLine=(row:Row,line:Row)=>{
    const parent=orders.get(row.orderId),current=parent?.raw.hzkj_orders_billentry?.find((l:Row)=>l.id===line.fulfillmentLineId)
    return e.raw.source==='native_parent_lines_and_linked_purchase_lines'&&e.raw.parentIds?.includes(row.orderId)&&current?{source:current,fulfillmentLineId:current.id,demand:true}:null
   }
   let rows=(e.display.rows??[]).map((r:Row)=>{
    if(!headerIds.has(r.orderId))return r
    const p=orders.get(r.orderId),lineValid=(l:Row)=>!!linkedLine(r,l),valid=p&&(r.lines??[]).length>0&&(r.lines??[]).every(lineValid)
    return {...r,orderNumber:valid?p.order_number:null,shopifyOrderNumber:valid?p.display.shopifyOrderNumber??null:null,storeName:valid?p.display.storeName??null:null,departmentName:valid?p.display.department?.name??null:null,warehouse:valid?p.display.warehouse??null:null,warehouseCode:valid?p.warehouse_code??null:null,ownerEmployeeId:valid?p.owner_employee_id:null,ownerName:valid?p.display.owner?.name??null:null,customerName:valid?p.display.customerName:null,paidAt:valid?p.display.paidAt:null,associationState:valid?'verified':'unresolved',lines:(r.lines??[]).map((l:Row)=>{const link=linkedLine(r,l),item=link?p!.display.items.find((i:Row)=>i.id===link.fulfillmentLineId):null;return {...l,quantity:link&&!link.demand?quantity(link.source.hzkj_qty):null,shippedQuantity:null,fulfillmentLineId:item?item.id:null,associationState:item?'verified':'unresolved',rawPurchaseEntryStatus:item?(p!.raw.hzkj_orders_billentry??[]).find((x:Row)=>x.id===item.id)?.hzkj_entrypurc_status??null:null,sku:item?.sku??null,name:item?.name??null,variant:item?.variant??null,imageUrl:item?.imageUrl??null}})}
   })
   const demandUnknown={stage:'unknown',shipment:'unknown',missingFields:['current_demand_quantity','hzkj_purcqty','hzkj_entrypurc_status'],timestampDemandState:'current_parent_links_verified_quantity_unverified'}
   if(e.entity_type==='purchase_demand'&&e.source_id!=='timestamp_uncreated_unknown'){
    const unknownKey=key('purchase_demand','timestamp_uncreated_unknown'),prior=entities.get(unknownKey),merged=new Map<string,Row>((prior?.display.rows??[]).map((r:Row)=>[r.orderId,r]))
    for(const r of rows)if(headerIds.has(r.orderId))merged.set(r.orderId,r)
    const unknownRows=[...merged.values()]
    entities.set(unknownKey,{batch_id:scope.batchId,entity_type:'purchase_demand',source_id:'timestamp_uncreated_unknown',owner_employee_id:null,captured_at:e.captured_at,raw:{source:'native_parent_lines_and_linked_purchase_lines',parentIds:unknownRows.map(r=>r.orderId),projection:'timestamp_unknown_demand'},display:scopedPurchaseGroup({...e.display,id:'timestamp_uncreated_unknown',...demandUnknown,rows:unknownRows,association:{state:'quantity_unverified'}},null)})
    touchedEntities.add(unknownKey);rows=rows.filter((r:Row)=>!headerIds.has(r.orderId))
   }
   e.display=scopedPurchaseGroup({...e.display,...(e.entity_type==='purchase_demand'&&e.source_id==='timestamp_uncreated_unknown'?demandUnknown:{}),rows,association:{...e.display.association,state:rows.every((r:Row)=>r.ownerEmployeeId)?'verified':'partial'}},null);touchedEntities.add(k)
   if(e.entity_type==='purchase_demand'&&e.raw.source==='native_parent_lines_and_linked_purchase_lines'&&!rows.length){deletedDemand.add(e.source_id);entities.delete(k);touchedEntities.delete(k)}
  }
 }
 const products=new Map<string,Row>([...entities.values()].filter(e=>e.entity_type==='product').map(e=>[e.source_id,e.raw]))
 const purchasesByParent=new Map<string,{raw:Row;display:Row}[]>()
 for(const e of entities.values())if(e.entity_type==='purchase')for(const id of new Set<string>((e.display.rows??[]).map((r:Row)=>r.orderId).filter(Boolean))){if(!purchasesByParent.has(id))purchasesByParent.set(id,[]);purchasesByParent.get(id)!.push({raw:e.raw,display:e.display})}
 const applicationsByNumber=new Map<string,Row[]>();for(const e of entities.values())if(e.entity_type==='purchase_application')for(const n of new Set<string>((e.raw.entryentity??[]).map((l:Row)=>l.hzkj_srcbillnumber).filter(Boolean))){if(!applicationsByNumber.has(n))applicationsByNumber.set(n,[]);applicationsByNumber.get(n)!.push(e.raw)}
 const consumptionSnapshot=await readStockConsumptionSnapshot(q,scope.batchId,batch.metadata,[...touchedOrders].map(id=>orders.get(id)?.raw.billno).filter(Boolean))
 for(const id of touchedOrders){const o=orders.get(id);if(o){o.display=physicalBusinessProjection(o.raw,o.display,products,purchasesByParent.get(id)??[],applicationsByNumber.get(o.raw.billno)??[],consumptionSnapshot);if(headerIds.has(id)&&o.display.businessStatus?.outbound==='unknown')o.display.nativeAssociationIssues=[...new Set([...(o.display.nativeAssociationIssues??[]),'current_source_outbound_status_unknown'])]}}
 const purchaseLines=new Map<string,Row|null>()
 for(const e of entities.values())if(e.entity_type==='purchase'&&e.display.association?.state!=='conflict')for(const r of e.display.rows??[])for(const l of r.lines??[]){
  const id=text(l.purchaseLineId);if(id)purchaseLines.set(id,purchaseLines.has(id)?null:{...l,orderId:r.orderId})
 }
 for(const[k,e]of entities){
  if(e.entity_type==='receipt_notice'&&(hasAffected(e.display?.sourceOrderIds)||hasAffected([...(roots.get(k)??[])]))){
   const ids=[...(roots.get(k)??[])],owners=[...new Set(ids.map(id=>orders.get(id)?.owner_employee_id).filter(Boolean))]
   const relations=relationByDocument.get(graphDocuments.get(k)?.id)??[]
   e.display={...e.display,sourceOrderIds:ids,ownerEmployeeIds:owners,lines:(e.display.lines??[]).map((l:Row)=>{
    const purchaseLineId=inputs.receiptLinks[l.id]??null,candidate=purchaseLineId?purchaseLines.get(purchaseLineId):null
    const line=candidate&&relations.some(r=>r.toEntryId===l.id&&r.rootSourceId===candidate.orderId)?candidate:null
    const own=(e.raw.entryentity??[]).find((entry:Row)=>String(entry.id)===String(l.id))?.hzkj_material
    return {...l,purchaseLineId,sourceOrderId:line?.orderId??null,sku:text(own?.number)??line?.sku??null,name:text(own?.name)??line?.name??null,variant:line?.variant??null,imageUrl:line?.imageUrl??null,productSource:line?'verified_receipt_purchase_fulfillment_link':null}
   }),association:{state:completeOwnership(k,e.raw)&&ids.length&&owners.length?'verified':'unresolved'}};e.owner_employee_id=null;touchedEntities.add(k)
  }
 }
 // Exception projection is owned by the database commit trigger, after all parent/entity facts are written.
 for(const id of touchedOrders){const row=orders.get(id);if(!row)continue;const columns=Object.keys(row).filter(k=>k!=='batch_id'&&k!=='is_exception'&&!k.startsWith('exception_')),quoted=columns.map(k=>'"'+k+'"');await q.query(`INSERT INTO hz_fop_collected_orders(batch_id,${quoted.join(',')}) VALUES($1,${columns.map((_,i)=>'$'+(i+2)).join(',')}) ON CONFLICT(batch_id,source_id) DO UPDATE SET ${quoted.filter(k=>k!=='"source_id"').map(k=>k+'=excluded.'+k).join(',')}`,[scope.batchId,...columns.map(k=>typeof row[k]==='object'&&row[k]!==null&&!(row[k] instanceof Date)?json(row[k]):row[k])])}
 for(const id of deletedDemand)await q.query("DELETE FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='purchase_demand' AND source_id=$2 AND raw->>'source'='native_parent_lines_and_linked_purchase_lines'",[scope.batchId,id])
 for(const k of touchedEntities){const e=entities.get(k)!;await q.query(`INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,owner_employee_id,search_text,display,raw,captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET owner_employee_id=excluded.owner_employee_id,search_text=excluded.search_text,display=excluded.display,raw=excluded.raw,captured_at=excluded.captured_at`,[scope.batchId,e.entity_type,e.source_id,e.owner_employee_id,json(e.display).toLowerCase(),json(e.display),json(e.raw),e.captured_at])}
 // Parent revalidation can resolve or quarantine an RMA; keep capture diagnostics in the same transaction.
 if(batch.metadata?.entityCaptures?.rma&&[...touchedEntities].some(k=>entities.get(k)?.entity_type==='rma')){
  const rmas=[...entities.values()].filter(e=>e.entity_type==='rma')
  await q.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{entityCaptures,rma}',metadata->'entityCaptures'->'rma'||$2::jsonb) WHERE id=$1",[scope.batchId,json({rowCount:rmas.length,exceptionCount:rmas.filter(e=>e.display?.rmaAssociation?.state!=='verified').length,quarantineCount:rmas.filter(e=>e.display?.rmaAssociation?.companyVerified!==true).length})])
 }
 // Do not replace analytics families. Only refresh changed facts and source-owner associations.
 const analysis=new Map(analytics.map(a=>[key(a.entity_type,a.source_id),a]))
 for(const task of accepted){const kind=kinds[task.entity_code];if(!['fulfillment','dispatch','purchase'].includes(kind))continue;const raw=kind==='fulfillment'?orders.get(task.source_id)!.raw:entities.get(key(kind,task.source_id))!.raw;analysis.set(key(kind,task.source_id),{batch_id:scope.batchId,...normalizeCollectedAnalyticsFact(kind as 'fulfillment'|'dispatch'|'purchase',raw,{companyId:scope.companyId,capturedAt:time(task.captured_at),scopeVerified:true})})}
 for(const[k,a]of analysis){
  if(a.entity_type==='stock')continue
  const isChanged=acceptedKeys.has(k)
  if(!isChanged&&!hasAffected(a.facts?.association?.sourceOrderIds)&&!hasAffected([...(roots.get(k)??[])]))continue
  const ids=a.entity_type==='fulfillment'&&orders.has(a.source_id)?[a.source_id]:[...(roots.get(k)??[])],parents=ids.map(id=>orders.get(id)).filter(Boolean),owners=[...new Set(parents.map(p=>p!.owner_employee_id).filter(Boolean))],verified=(a.entity_type==='fulfillment'?canonical(a.raw)===canonical(orders.get(a.source_id)?.raw):completeOwnership(k,a.raw))&&parents.length>0&&parents.every(p=>p!.owner_employee_id)&&owners.length===1
  a.owner_employee_id=verified?owners[0]:null;a.facts={...a.facts,missingFields:verified?(a.facts.missingFields??[]).filter((f:string)=>f!=='verifiedOwnerEmployeeId'):[...new Set([...(a.facts.missingFields??[]),'verifiedOwnerEmployeeId'])],sourceOwnershipVerified:verified,effective:verified&&a.facts.businessEligible===true,association:{state:verified?'verified':'unresolved',basis:'current_local_source_document_graph',sourceOrderIds:ids,ownerEmployeeIds:owners}}
  const columns=Object.keys(a).filter(k=>k!=='batch_id'&&k!=='is_exception'&&!k.startsWith('exception_')),quoted=columns.map(k=>'"'+k+'"')
  await q.query(`INSERT INTO hz_fop_collected_analytics_facts(batch_id,${quoted.join(',')}) VALUES($1,${columns.map((_,i)=>'$'+(i+2)).join(',')}) ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET ${quoted.filter(k=>!['"source_id"','"entity_type"'].includes(k)).map(k=>k+'=excluded.'+k).join(',')}`,[scope.batchId,...columns.map(k=>typeof a[k]==='object'&&a[k]!==null&&!(a[k] instanceof Date)?json(a[k]):a[k])])
 }
 // Keep unresolved raw references durable. Any later commit retries them even on an empty/unchanged page.
 for(const task of accepted){
  const kind=kinds[task.entity_code],entity=entities.get(key(kind,task.source_id))
  if(kind!=='fulfillment'&&entity?.display.association?.state!=='verified'){
   await block(task,'timestamp_projection_relation_unresolved');continue
  }
  await q.query("UPDATE hz_fop_timestamp_projection_tasks SET state='applied',reason=NULL,updated_at=now() WHERE batch_id=$1 AND entity_code=$2 AND source_id=$3",[scope.batchId,task.entity_code,task.source_id])
 }
 // An already-published dependency can become ambiguous after a parent rename/duplicate.
 // Requeue only applied tasks: never replace an incomplete incoming payload with old published raw.
 const entityCodes=new Map(Object.entries(kinds).map(([entity,kind])=>[kind,entity]))
 for(const k of touchedEntities){const e=entities.get(k)!,entityCode=entityCodes.get(e.entity_type)
  if(!entityCode||e.display.association?.state==='verified')continue
  await q.query("UPDATE hz_fop_timestamp_projection_tasks SET state='pending',reason='timestamp_projection_relation_unresolved',updated_at=now() WHERE batch_id=$1 AND entity_code=$2 AND source_id=$3 AND state='applied'",[scope.batchId,entityCode,e.source_id])
 }
 const [{remaining}]=await q.query("SELECT count(*)::int remaining FROM hz_fop_timestamp_projection_tasks WHERE batch_id=$1 AND state='pending'",[scope.batchId])
 // Clearing a previously set ownership fence requires a successfully rebuilt parent and all pending dependencies resolved.
 if(remaining===0&&(headerIds.size||batch.metadata?.timestampOwnershipPending===true)){
  const [{verified}]=await q.query(`SELECT EXISTS(SELECT 1 FROM hz_fop_timestamp_projection_tasks WHERE batch_id=$1 AND entity_code='hzkj_orders' AND state='applied') AND NOT EXISTS(SELECT 1 FROM hz_fop_timestamp_projection_tasks p LEFT JOIN hz_fop_collected_orders o ON o.batch_id=p.batch_id AND o.source_id=p.source_id WHERE p.batch_id=$1 AND p.entity_code='hzkj_orders' AND (p.state<>'applied' OR o.raw->'timestampProjection'->>'runId' IS DISTINCT FROM p.run_id::text)) AS verified`,[scope.batchId])
  if(verified)await q.query("UPDATE hz_fop_collected_batches SET metadata=metadata-'timestampOwnershipPending' WHERE id=$1",[scope.batchId])
 }
 return {available:true,applied:accepted.length-blocked.filter(b=>b.reason==='timestamp_projection_relation_unresolved').length,blocked,rebuildChain:accepted.length>0||touchedOrders.size>0||touchedEntities.size>0,affectedOrders:touchedOrders.size,dependentEntities:touchedEntities.size,derivedViews:{procurement:'fulfillment_source_status_and_verified_purchase_actions',outbound:'unknown_when_source_outbound_fields_omitted',missingFieldsRemainUnknown:true},remaining,publishedEntities:[...new Set([...accepted.map(t=>t.entity_code as string),...[...touchedEntities].map(k=>entityCodes.get(entities.get(k)!.entity_type)).filter((v):v is string=>!!v)])]}
}
