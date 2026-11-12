/* Synthetic domain-to-PostgreSQL validation. Dedicated disposable databases ONLY; no FOP calls. */
require('reflect-metadata')
require('ts-node').register({ project:'backend/tsconfig.json',transpileOnly:true })
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto'),{DataSource}=require('typeorm')
const {ReplicaPublisher}=require('../../modules/workbench-replica/replica-publisher')
const {normalizeReplicaGroup,sourceEntityIdentity}=require('../../modules/workbench-replica/replica-domain-normalizer')
const {completeFulfillmentDomainFixture}=require('../../modules/workbench-replica/replica-domain.fixture')
const {WORKBENCH_TABLE_COLUMNS}=require('../workbench-schema')
const database=process.env.WORKBENCH_VALIDATION_DATABASE||'hz_ddl_validation_1794392169018'
assert.match(database,/^hz_ddl_validation_\d+$/)
const db=new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,password:fs.readFileSync('.runtime/local-demo/database-password','utf8').trim()})
const scope={connectionId:randomUUID(),companyId:randomUUID(),datasetId:randomUUID()},stream=randomUUID(),stamp=new Date().toISOString()
const orderId=sourceEntityIdentity(scope,'hzkj_orders','90071992547409931'),dispatchId=sourceEntityIdentity(scope,'hzkj_deliver_bill','dispatch-1'),receiptId=sourceEntityIdentity(scope,'hzkj_receiptnotice','receipt-1')
const copy=v=>JSON.parse(JSON.stringify(v))
function domain(version,after){
 const g=completeFulfillmentDomainFixture(stamp),o=g.documents[0];g.groupKey='domain-group-'+version;g.afterCursor=after;g.endCursor='domain-cursor-'+version;g.expectedCount=4
 o.eventId='domain-order-'+version;o.sourceVersion=String(version);o.header.totalAmount=version===1?'10':'5';o.entries[0].quantity='1';o.entries[0].unitPrice='5';o.entries[0].lineAmount='5'
 const first=copy(o.entries[0]);first.sourceEntryId='first-line';const second=copy(o.entries[0]);second.sourceEntryId='second-line';o.entries=version===1?[first,second]:[second]
 const orderRef={entityCode:o.entityCode,sourceId:o.sourceId},lineRef={...orderRef,entryEntity:second.entryEntity,sourceEntryId:second.sourceEntryId}
 o.packages=[{sourcePackageKey:'package-1',packageNumber:'PK1',expectedActive:true,trackingNumber:version===1?'QC-OLD':null,lines:[{line:lineRef,quantity:'1'}]}]
 o.relations=version===1?[{sourceRelationId:'order-dispatch',relationType:'dispatch',from:orderRef,to:{entityCode:'hzkj_deliver_bill',sourceId:'dispatch-1'}}]:[]
 const dispatch={eventId:'domain-dispatch-'+version,entityCode:'hzkj_deliver_bill',sourceId:'dispatch-1',sourceVersion:String(version),operation:version===1?'upsert':'delete',documentNumber:'FY-FIXTURE',linesComplete:true,relationsComplete:true,sourceFields:{rawBillStatus:'C',relationRevision:'0'},entries:[],relations:[],affectedOrders:[orderRef]}
 if(version===1){dispatch.header={rawDeliveryStatus:'TRACKING_OBTAINED',rawShopifySyncStatus:'pending'};dispatch.trackingNumbers=[{sourceTrackingId:'full-1',trackingType:'full',number:'QC-OLD',shopifySelected:true,package:{order:orderRef,sourcePackageKey:'package-1'}}]}
 const receipt={eventId:'domain-receipt-'+version,entityCode:'hzkj_receiptnotice',sourceId:'receipt-1',sourceVersion:String(version),operation:'upsert',documentNumber:'SH-FIXTURE',linesComplete:true,relationsComplete:true,sourceFields:{rawBillStatus:'C',relationRevision:'0'},header:{warehouseId:'receipt-warehouse',supplierId:'receipt-supplier',rawWmsStatus:version===1?'5':'10',supplierShippedAt:stamp,trackingNumber:'SF-SOURCE'},entries:[{entryEntity:'billentry',sourceEntryId:'receipt-line',skuCode:'RECEIPT-SKU',quantity:'2',inboundQuantity:version===1?'0':'1'}],relations:[],workbench:{ownerEmployeeIds:['fixture-employee'],ownershipVerifiedAt:stamp,ownershipVersion:'fixture-1',shipmentState:'shipped',carrierName:'Synthetic carrier'}}
 const purchase={eventId:'domain-purchase-'+version,entityCode:'hzkj_purorderbill',sourceId:'purchase-1',sourceVersion:String(version),operation:'upsert',documentNumber:'PO-FIXTURE',linesComplete:true,relationsComplete:true,sourceFields:{rawBillStatus:'C',relationRevision:'0'},header:{},entries:[{entryEntity:'billentry',sourceEntryId:'purchase-line',skuCode:'PURCHASE-SKU',quantity:'10',...(version===1?{procurementDetails:{orderedQuantity:'10',supplierShippedQuantity:'10'}}:{})}],relations:[],platformOrders:[]}
 g.documents.push(dispatch,receipt,purchase);return g
}
async function scalar(sql,args=[]){return (await db.query(sql,args))[0]}
async function cleanup(company=scope.companyId,connection=scope.connectionId){await db.transaction(async m=>{
 await m.query('SET CONSTRAINTS ALL DEFERRED')
 await m.query('DELETE FROM hz_fop_workbench_receipt_notices WHERE document_id IN (SELECT id FROM hz_fop_source_documents WHERE company_id=$1)',[company])
 const pending=Object.entries(WORKBENCH_TABLE_COLUMNS).filter(([,columns])=>columns.includes('company_id')).map(([table])=>table)
 while(pending.length){let progress=false;for(const table of [...pending]){await m.query('SAVEPOINT cleanup_row');try{await m.query('DELETE FROM '+table+' WHERE company_id=$1',[company]);pending.splice(pending.indexOf(table),1);progress=true}catch(error){await m.query('ROLLBACK TO SAVEPOINT cleanup_row');if(error.code!=='23503')throw error}await m.query('RELEASE SAVEPOINT cleanup_row')}assert.ok(progress,'FK cleanup must progress')}
 await m.query('DELETE FROM hz_fop_companies WHERE id=$1',[company]);await m.query('DELETE FROM hz_fop_connections WHERE id=$1',[connection])
})}
;(async()=>{await db.initialize();try{
 const residue=await db.query("SELECT c.id connection,co.id company FROM hz_fop_connections c JOIN hz_fop_companies co ON co.connection_id=c.id WHERE c.name='Domain publisher validation' AND c.base_url='https://example.invalid'");for(const row of residue)await cleanup(row.company,row.connection)
 const [owner]=await db.query('SELECT id FROM users ORDER BY id LIMIT 1')
 await db.query("INSERT INTO hz_fop_connections(id,workspace_owner_id,name,environment,tenant_id,base_url,credential_ref,status) VALUES($1,$2,'Domain publisher validation','test','synthetic','https://example.invalid','synthetic','active')",[scope.connectionId,owner.id])
 await db.query("INSERT INTO hz_fop_companies(id,connection_id,source_company_id,company_number,name,enabled)VALUES($1,$2,'synthetic','synthetic','synthetic',true)",[scope.companyId,scope.connectionId])
 await db.query("INSERT INTO hz_fop_datasets(id,connection_id,company_id,state)VALUES($1,$2,$3,'active')",[scope.datasetId,scope.connectionId,scope.companyId])
 await db.query("INSERT INTO hz_fop_sync_streams(id,connection_id,company_id,dataset_id,stream_key,state)VALUES($1,$2,$3,$4,'business','ready')",[stream,scope.connectionId,scope.companyId,scope.datasetId])
 const publisher=new ReplicaPublisher(db)
 await publisher.apply(scope,stream,normalizeReplicaGroup(scope,domain(1,null)))
 assert.equal((await scalar('SELECT count(*)::int n FROM hz_fop_source_lines WHERE document_id=$1 AND removed_at IS NULL',[orderId])).n,2)
 assert.equal((await scalar('SELECT tracking_number FROM hz_fop_order_packages WHERE order_document_id=$1',[orderId])).tracking_number,'QC-OLD')
 assert.deepEqual((await scalar('SELECT quantity::text,inbound_quantity::text,owner_employee_ids,carrier_name FROM hz_fop_workbench_receipt_notices WHERE document_id=$1',[receiptId])),{quantity:'2.00000000',inbound_quantity:'0.00000000',owner_employee_ids:['fixture-employee'],carrier_name:'Synthetic carrier'})
 assert.equal((await scalar('SELECT supplier_shipped_quantity::text FROM hz_fop_procurement_line_details WHERE company_id=$1',[scope.companyId])).supplier_shipped_quantity,'10.00000000')
 await publisher.apply(scope,stream,normalizeReplicaGroup(scope,domain(2,'domain-cursor-1')))
 assert.equal((await scalar('SELECT count(*)::int n FROM hz_fop_procurement_line_details WHERE company_id=$1',[scope.companyId])).n,0)
 assert.equal((await scalar('SELECT count(*)::int n FROM hz_fop_source_lines WHERE document_id=$1 AND removed_at IS NOT NULL',[orderId])).n,1)
 assert.equal((await scalar('SELECT count(*)::int n FROM hz_fop_document_relations WHERE company_id=$1 AND removed_at IS NULL',[scope.companyId])).n,0)
 assert.equal((await scalar('SELECT count(*)::int n FROM hz_fop_tracking_numbers WHERE dispatch_document_id=$1 AND removed_at IS NULL',[dispatchId])).n,0)
 assert.equal((await scalar('SELECT tracking_number FROM hz_fop_order_packages WHERE order_document_id=$1',[orderId])).tracking_number,null)
 assert.equal((await scalar('SELECT inbound_quantity::text FROM hz_fop_workbench_receipt_notices WHERE document_id=$1',[receiptId])).inbound_quantity,'1.00000000')
 const failed=normalizeReplicaGroup(scope,domain(3,'domain-cursor-2'));failed.events[2].sourceVersion='1';failed.receiptNotices[0].rows[0].values.source_version='1'
 await assert.rejects(()=>publisher.apply(scope,stream,failed),/regressed source version/)
 assert.equal((await scalar('SELECT source_version::text FROM hz_fop_source_documents WHERE id=$1',[orderId])).source_version,'2')
 assert.equal((await scalar('SELECT applied_cursor FROM hz_fop_sync_streams WHERE id=$1',[stream])).applied_cursor,'domain-cursor-2')
 const deletion=domain(3,'domain-cursor-2');deletion.documents=[{eventId:'receipt-delete',entityCode:'hzkj_receiptnotice',sourceId:'receipt-1',sourceVersion:'3',operation:'delete',documentNumber:'SH-FIXTURE',linesComplete:true,relationsComplete:true,entries:[],relations:[]}];deletion.expectedCount=1
 await publisher.apply(scope,stream,normalizeReplicaGroup(scope,deletion))
 assert.equal((await scalar('SELECT count(*)::int n FROM hz_fop_workbench_receipt_notices WHERE document_id=$1',[receiptId])).n,0)
 console.log('PASS domain publication: cross-document FK group, receipt projection, full-entry removal, relation/tracking tombstones, package mirror clearing, group rollback/version fence, receipt deletion, removed optional line details')
}finally{await cleanup();await db.destroy()}})().catch(error=>{console.error(error.message);process.exitCode=1})
