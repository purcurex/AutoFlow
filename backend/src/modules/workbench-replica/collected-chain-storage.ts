import { enqueueChangedRelations } from './relation-refresh'
import { collectedChainInputs } from './collected-chain-inputs'
import type { EntityManager } from 'typeorm'
import { createHash } from 'node:crypto'
import { buildCollectedBusinessChain, chainId, chainKinds, chainText, chainTime, chainDecimal } from './collected-business-chain'
type Row=Record<string,any>
export const chainSourceSignature=(batch:Row)=>{
 // Scheduler receipts describe execution, not source facts. Updating the next
 // attempt must not invalidate an otherwise unchanged local business graph.
 const metadata=batch.metadata?{...batch.metadata}:batch.metadata
 if(metadata){delete metadata.timestampSchedule;delete metadata.catalogSchedule;delete metadata.catalogFingerprints}
 return createHash('sha256').update(JSON.stringify([batch.id,batch.source_as_of,metadata])).digest('hex')
}
const MAPPING_VERSION=4
/** Preserve the existing digest without building a single >512 MB JSON string. */
export function chainContentHash(ordered:unknown[],receiptLinks:Record<string,string>,unresolvedConflicts:number){
 const hash=createHash('sha256').update(`[${MAPPING_VERSION},[`)
 for(let i=0;i<ordered.length;i++){if(i)hash.update(',');hash.update(JSON.stringify(ordered[i])??'null')}
 return hash.update('],').update(JSON.stringify(receiptLinks)).update(',').update(JSON.stringify(unresolvedConflicts)).update(']').digest('hex')
}
export async function rebuildCollectedChain(q:EntityManager,batchId:string,dryRun=false){
 const [batch]=await q.query(`SELECT * FROM hz_fop_collected_batches WHERE id=$1 AND state='active' ${dryRun?'':'FOR UPDATE'}`,[batchId]);if(!batch)throw Error('active_batch_required')
 const connectionId=chainId(batch.workspace_owner_id,batch.tenant_id,'offline-collected-chain'),companyId=chainId(connectionId,batch.company_id)
 const datasetId=chainId(batch.id,'collected-business-chain'),scope={connectionId,companyId,sourceCompanyId:batch.company_id,datasetId}
 const orders=await q.query('SELECT raw,display FROM hz_fop_collected_orders WHERE batch_id=$1 ORDER BY source_id',[batch.id])
 const entities=await q.query('SELECT * FROM hz_fop_collected_entities WHERE batch_id=$1 ORDER BY entity_type,source_id',[batch.id])
 const analytics=await q.query('SELECT * FROM hz_fop_collected_analytics_facts WHERE batch_id=$1 ORDER BY entity_type,source_id',[batch.id])
 const {ordered,receiptLinks,unresolvedConflicts}=collectedChainInputs(batch,orders,entities,analytics)
 const contentHash=chainContentHash(ordered,receiptLinks,unresolvedConflicts),signature=chainSourceSignature(batch)
 const graph=buildCollectedBusinessChain(scope,ordered,receiptLinks)
 const summary={documents:graph.documents.length,lines:graph.lines.length,relations:new Set(graph.relations.map(r=>r.id)).size,paths:graph.relations.length,issues:graph.issues.length,unresolvedConflicts,byKind:graph.documents.reduce((a:Row,d)=>(a[d.kind]=(a[d.kind]??0)+1,a),{}),relationTypes:graph.relations.reduce((a:Row,r)=>(a[r.type]=(a[r.type]??0)+1,a),{}),sourceVersionsVerified:false,consistentSnapshot:false,upstreamCalled:false}
 if(dryRun)return {datasetId,dryRun:true,...summary}
 const [existing]=await q.query('SELECT * FROM hz_fop_collected_chains WHERE batch_id=$1',[batch.id])
 if(existing?.content_hash===contentHash&&existing?.mapping_version===MAPPING_VERSION){
  // A capture-only watermark change invalidates the metadata signature, not the unchanged graph.
  if(existing.source_signature!==signature)await q.query('UPDATE hz_fop_collected_chains SET source_signature=$2,built_at=now() WHERE batch_id=$1',[batch.id,signature])
  await enqueueChangedRelations(q,batch.id)
  return {datasetId,reused:true,...summary}
 }
 await q.query("INSERT INTO hz_fop_connections(id,workspace_owner_id,name,environment,tenant_id,base_url,credential_ref,status,capabilities) VALUES($1,$2,'已采集离线业务链',$4,$3,$5,'collected/offline/no-credentials','disabled','{\"offlineCollectedOnly\":true}'::jsonb) ON CONFLICT(id) DO NOTHING",[connectionId,batch.workspace_owner_id,batch.tenant_id,collectedDeploymentScope(batch).environment,collectedDeploymentScope(batch).baseUrl])
 const [connection]=await q.query('SELECT status,capabilities FROM hz_fop_connections WHERE id=$1',[connectionId]);if(connection.status!=='disabled'||connection.capabilities?.offlineCollectedOnly!==true)throw Error('offline_connection_required')
 await q.query('INSERT INTO hz_fop_companies(id,connection_id,source_company_id,company_number,enabled) VALUES($1,$2,$3,$4,false) ON CONFLICT(id) DO NOTHING',[companyId,connectionId,batch.company_id,collectedDeploymentScope(batch).orgNumber])
 const [dataset]=await q.query('SELECT * FROM hz_fop_datasets WHERE id=$1 FOR UPDATE',[datasetId]);if(dataset&&(dataset.state!=='building'||dataset.snapshot_id!=='collected:'+batch.id))throw Error('cannot_overwrite_replica_dataset')
 if(!dataset)await q.query("INSERT INTO hz_fop_datasets(id,connection_id,company_id,snapshot_id,state) VALUES($1,$2,$3,$4,'building')",[datasetId,scope.connectionId,scope.companyId,'collected:'+batch.id])
 const unique=new Map(graph.relations.map(r=>[r.id,r]))
 const pathKeys=['company_id','dataset_id','order_document_id','relation_id']
 const paths=graph.relations.map(r=>({company_id:scope.companyId,dataset_id:datasetId,order_document_id:r.rootId,relation_id:r.id,basis:r.basis}))
 const pathKey=(row:Row)=>JSON.stringify(pathKeys.map(key=>row[key]))
 const wantedPaths=new Set(paths.map(pathKey))
 const priorPaths:Row[]=await q.query('SELECT company_id,dataset_id,order_document_id,relation_id FROM hz_fop_order_relation_paths WHERE dataset_id=$1',[datasetId])
 const removedPaths=priorPaths.filter(row=>!wantedPaths.has(pathKey(row)))
 // Remove vanished roots before their relations/documents, preserving the real composite key.
 for(let i=0;i<removedPaths.length;i+=250)await q.query(`DELETE FROM hz_fop_order_relation_paths p
  USING jsonb_to_recordset($1::jsonb) AS gone(company_id uuid,dataset_id uuid,order_document_id uuid,relation_id uuid)
  WHERE ${pathKeys.map(key=>`p.${key}=gone.${key}`).join(' AND ')}`,[JSON.stringify(removedPaths.slice(i,i+250))])
 await q.query('DELETE FROM hz_fop_document_relations WHERE dataset_id=$1 AND NOT(id=ANY($2::uuid[]))',[datasetId,[...unique.keys()]])
 async function insert(table:string,rows:Row[],keys?:string[]){
  const columns:Row[]=await q.query('SELECT attname FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum',[table])
  const key=keys??[table==='hz_fop_source_documents'||table==='hz_fop_source_lines'||table==='hz_fop_document_relations'?'id':'document_id']
  const changed=columns.filter(c=>!key.includes(c.attname)).map(c=>`"${c.attname}"`)
  const conflict=` ON CONFLICT (${key.map(k=>`"${k}"`).join(',')}) DO UPDATE SET `+changed.map(c=>`${c}=excluded.${c}`).join(',')
   +` WHERE ROW(${changed.map(c=>`${table}.${c}`).join(',')}) IS DISTINCT FROM ROW(${changed.map(c=>`excluded.${c}`).join(',')})`
  for(let i=0;i<rows.length;i+=250)await q.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)${conflict}`,[JSON.stringify(rows.slice(i,i+250))])
  await q.query(`ANALYZE ${table}`)
 }
 const issueByDoc=new Map<string,Row[]>();for(const issue of graph.issues)issueByDoc.set(issue.documentId,[...(issueByDoc.get(issue.documentId)??[]),issue])
 const common={connection_id:scope.connectionId,company_id:scope.companyId,dataset_id:datasetId}
 await insert('hz_fop_source_documents',graph.documents.map(d=>({...common,id:d.id,entity_code:d.entity,source_id:d.sourceId,document_number:d.number,source_version:null,raw_bill_status:chainText(d.raw.billstatus),source_created_at:chainTime(d.raw.createtime),source_modified_at:chainTime(d.raw.modifytime),source_audited_at:chainTime(d.raw.auditdate),synced_at:d.capturedAt,validation_state:'incomplete',payload_hash:createHash('sha256').update(JSON.stringify(d.raw)).digest('hex'),payload:{raw:d.raw,provenance:{mode:'collected',capturedAt:d.capturedAt,sourceVersionVerified:false,...(d.display?.lineOutboundCapture?{lineOutboundCapture:d.display.lineOutboundCapture}:{})},issues:issueByDoc.get(d.id)??[]},mapping_version:MAPPING_VERSION,relation_revision:0})))
 await insert('hz_fop_source_lines',graph.lines.map(l=>({...common,id:l.id,document_id:l.documentId,entry_entity:l.entryEntity,source_entry_id:l.sourceEntryId,sequence:l.sequence,sku_code:l.sku,product_name:l.name,quantity:l.quantity,line_amount:l.amount,payload:l.raw})))
 for(const[kind,cfg]of Object.entries(chainKinds)){
  const rows=graph.documents.filter(d=>d.kind===kind).map(d=>{const r=d.raw,base:Row={document_id:d.id,company_id:scope.companyId,dataset_id:datasetId,entity_code:cfg.entity};const id=(key:string)=>chainText(r[key+'_id']??r[key]?.id)
   if(kind==='fulfillment'||kind==='stock')Object.assign(base,{owner_employee_id:id('hzkj_operator'),customer_id:id('hzkj_customer'),paying_customer_id:id('hzkj_payingcustomer'),raw_order_status:chainText(r.hzkj_orderstatus),raw_payment_status:chainText(r.hzkj_receipt_status),raw_purchase_status:chainText(r.hzkj_purchase_status),customer_paid_at:chainTime(r.hzkj_receipt_date),...(kind==='stock'?{stock_type:'unknown'}:{raw_delivery_status:chainText(r.hzkj_delivery_status)})})
   if(kind==='purchase')Object.assign(base,{supplier_id:id('hzkj_supplier'),raw_cancel_status:chainText(r.hzkj_cancelstatus),purchase_type:'unknown'})
   if(kind==='purchase_application')Object.assign(base,{raw_cancel_status:chainText(r.hzkj_cancelstatus),raw_close_status:chainText(r.hzkj_closestatus)})
   if(kind==='allocation')Object.assign(base,{source_order_id:chainText(r.hzkj_order_id),source_order_number:chainText(r.hzkj_order_no),raw_allocation_status:chainText(r.hzkj_alloc_status)})
   if(kind==='dispatch')Object.assign(base,{raw_fulfillment_status:chainText(r.hzkj_fulfillment_status),raw_delivery_status:chainText(r.hzkj_delivery_status)})
   if(kind==='receipt_notice')Object.assign(base,{raw_wms_status:chainText(r.hzkj_receiptnotice_status),tracking_number:chainText(r.hzkj_waybill_number)})
   if(kind==='receipt')Object.assign(base,{receipt_type:chainText(r.hzkj_receive_type),raw_receive_status:chainText(r.hzkj_receive_status),raw_arrival_status:chainText(r.hzkj_receipt_status),received_amount:chainDecimal(r.hzkj_rec_amount),order_amount:chainDecimal(r.hzkj_receive_amount),received_at:chainTime(r.hzkj_receive_time)})
   if(kind==='inbound')Object.assign(base,{warehouse_id:id('warehouse'),supplier_id:id('supplier'),business_at:chainTime(r.biztime),raw_cancel_status:chainText(r.cancelstatus)})
   if(kind==='outbound')base.movement_kind='unknown'
   return base
  });await insert(cfg.table,rows)
 }
 await insert('hz_fop_document_relations',[...unique.values()].map(r=>({...common,id:r.id,from_document_id:r.fromId,from_line_id:r.fromLineId,to_document_id:r.toId,to_line_id:r.toLineId,relation_type:r.type,allocated_quantity:r.quantity,allocated_amount:r.amount,currency_code:r.currency,source_version:null,holder_document_id:r.toId,resolution_state:'resolved',relation_grain:r.fromLineId?(r.toLineId?'line_line':'line_document'):(r.toLineId?'document_line':'document')})))
 for(const [kind,cfg]of Object.entries(chainKinds))await q.query(`DELETE FROM ${cfg.table} WHERE dataset_id=$1 AND NOT(document_id=ANY($2::uuid[]))`,[datasetId,graph.documents.filter(d=>d.kind===kind).map(d=>d.id)])
 await q.query('DELETE FROM hz_fop_source_lines WHERE dataset_id=$1 AND NOT(id=ANY($2::uuid[]))',[datasetId,graph.lines.map(l=>l.id)])
 await q.query('DELETE FROM hz_fop_source_documents WHERE dataset_id=$1 AND NOT(id=ANY($2::uuid[]))',[datasetId,graph.documents.map(d=>d.id)])
 await insert('hz_fop_order_relation_paths',paths,pathKeys)
 await q.query(`INSERT INTO hz_fop_collected_chains(batch_id,dataset_id,source_signature,content_hash,mapping_version,summary) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(batch_id) DO UPDATE SET source_signature=excluded.source_signature,content_hash=excluded.content_hash,mapping_version=excluded.mapping_version,summary=excluded.summary,built_at=now()`,[batch.id,datasetId,signature,contentHash,MAPPING_VERSION,JSON.stringify(summary)])
 await enqueueChangedRelations(q,batch.id)
 return {datasetId,reused:false,...summary}
}

export function collectedDeploymentScope(batch:Row){
 const scope=batch.metadata?.deploymentScope
 if(scope?.environment==='production'){
  const url=new URL(scope.baseUrl)
  if(url.protocol!=='https:'||url.origin!==scope.baseUrl||!scope.orgNumber)throw Error('collected_production_scope_invalid')
  return {environment:'production',baseUrl:scope.baseUrl,orgNumber:scope.orgNumber}
 }
 return {environment:'test',baseUrl:'https://hyperzone.test.kdgalaxy.com',orgNumber:'hyperzone.test'}
}
