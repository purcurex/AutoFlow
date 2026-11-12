import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { DataSource } from 'typeorm'
import { WORKBENCH_TABLE_COLUMNS } from '../../database/workbench-schema'
import { ReplicaBootstrapService } from './replica-bootstrap.service'
import { ReplicaHttpSource, REPLICA_RESOURCES } from './replica-http-source'
import { REPLICA_API_KEYS } from './replica-source-api'
import { ReplicaAuthorizationService } from './replica-authorization.service'
import { ReplicaPublisher } from './replica-publisher'
import { completeFulfillmentDomainFixture } from './replica-domain.fixture'
import { type ReplicaDomainDocument } from './replica-domain-normalizer'

const database=process.env.LOCAL_WORKBENCH_TEST_DB
const integration=database?.match(/^hz_ddl_validation_\d+$/)?describe:describe.skip
integration('durable snapshot staging across source pages and streams',()=>{
 let db:DataSource,actor:string,connection:string,company:string,previous:string,bootstrap:ReplicaBootstrapService,publisher:ReplicaPublisher
 let pages:number,missingLine:boolean,source:ReplicaHttpSource,config:ConfigService
 const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v))
 function fixtures(asOf:string){
  const order=(id:string):ReplicaDomainDocument=>{
   const d=completeFulfillmentDomainFixture(asOf,'10').documents[0];d.sourceId=id;d.eventId='snapshot-'+id
   const line={entityCode:d.entityCode,sourceId:d.sourceId,entryEntity:d.entries[0].entryEntity,sourceEntryId:d.entries[0].sourceEntryId}
   const purchaseLine={entityCode:'hzkj_purorderbill' as const,sourceId:'purchase-1',entryEntity:'billentry',sourceEntryId:'purchase-line'}
   d.relations=[{sourceRelationId:'purchase-link-'+id,relationType:'demand_purchase',from:line,to:purchaseLine,allocatedQuantity:'1'}]
   d.workbench!.purchaseAllocations=[{sourceAllocationId:'allocation-'+id,line,purchaseLine,purchaseSourceVersion:'1',purchaseRelationRevision:'0',allocatedRequirementQuantity:'1',purchasedQuantity:'1',supplierShippedQuantity:'0',inboundQuantity:'0',cancelledQuantity:'0',returnedQuantity:'0',remainingSupplyQuantity:'1',allocatedAmount:'5',currencyCode:'USD'}]
   return d
  }
  const first=order('order-1'),second=order('order-2')
  const purchase:ReplicaDomainDocument={eventId:'snapshot-purchase',entityCode:'hzkj_purorderbill',sourceId:'purchase-1',sourceVersion:'1',operation:'upsert',documentNumber:'PO-SNAPSHOT',linesComplete:true,relationsComplete:true,sourceFields:{rawBillStatus:'C',relationRevision:'0'},header:{purchaseType:'online',totalAmount:'10',settlementCurrency:'USD'},entries:missingLine?[]:[{entryEntity:'billentry',sourceEntryId:'purchase-line',skuCode:'PURCHASE-SKU',quantity:'2',unitPrice:'5',lineAmount:'10',currencyCode:'USD'}],relations:[{sourceRelationId:'source-order-link',relationType:'demand_purchase',from:{entityCode:first.entityCode,sourceId:first.sourceId,entryEntity:first.entries[0].entryEntity,sourceEntryId:first.entries[0].sourceEntryId},to:{entityCode:'hzkj_purorderbill',sourceId:'purchase-1',entryEntity:'billentry',sourceEntryId:'purchase-line'}}],platformOrders:[]}
  const group=(key:string,after:string|null,end:string,document:ReplicaDomainDocument)=>({schemaVersion:'fop-replica-domain/1',groupKey:key,afterCursor:after,endCursor:end,committedAt:asOf,expectedCount:1,documents:[document]})
  return {first:group('first',null,'orders-page-1',first),second:group('second','orders-page-1','orders-end',second),purchase:{...group('purchase',null,'purchases-end',purchase),orderProjections:[{order:clone(first),dependencies:[]}]}}
 }
 async function cleanup(companyId:string,connectionId:string){await db.transaction(async m=>{
  await m.query('SET CONSTRAINTS ALL DEFERRED');await m.query('UPDATE hz_fop_companies SET active_dataset_id=NULL WHERE id=$1',[companyId])
  await m.query('UPDATE hz_fop_bootstrap_batches SET start_barrier_id=NULL,cutover_barrier_id=NULL WHERE company_id=$1',[companyId])
  const tables=Object.entries(WORKBENCH_TABLE_COLUMNS).filter(([,cols])=>cols.includes('company_id')).map(([table])=>table)
  while(tables.length){let progress=false;for(const table of [...tables]){await m.query('SAVEPOINT cleanup_row');try{await m.query(`DELETE FROM ${table} WHERE company_id=$1`,[companyId]);tables.splice(tables.indexOf(table),1);progress=true}catch(error){await m.query('ROLLBACK TO SAVEPOINT cleanup_row');if((error as any).code!=='23503')throw error}await m.query('RELEASE SAVEPOINT cleanup_row')}if(!progress)throw new Error('Staging fixture cleanup dependency cycle')}
  await m.query('DELETE FROM hz_fop_companies WHERE id=$1',[companyId]);await m.query('DELETE FROM hz_fop_connections WHERE id=$1',[connectionId])
 })}
 beforeAll(async()=>{
  db=await new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim()}).initialize()
  actor=(await db.query("SELECT id FROM users WHERE role='admin' AND NOT account_disabled ORDER BY id LIMIT 1"))[0].id
  const residue=await db.query("SELECT c.id connection_id,co.id company_id FROM hz_fop_connections c JOIN hz_fop_companies co ON co.connection_id=c.id WHERE c.name='Snapshot staging test' AND c.base_url='https://staging.fixture.invalid'")
  for(const row of residue)await cleanup(row.company_id,row.connection_id)
 })
 afterAll(async()=>{await db?.destroy()})
 beforeEach(async()=>{
  connection=randomUUID();company=randomUUID();previous=randomUUID();pages=0;missingLine=false
  config=new ConfigService({...Object.fromEntries(REPLICA_API_KEYS.map(k=>[`FOP_REPLICA_${k}_URL`,`https://staging.fixture.invalid/${k}`])),FOP_REPLICA_ACCESS_TOKEN:'synthetic-only',WORKBENCH_BOOTSTRAP_PAGE_BUDGET:'1'})
  await db.query(`INSERT INTO hz_fop_connections(id,workspace_owner_id,name,environment,tenant_id,base_url,credential_ref,status)VALUES($1,$2,'Snapshot staging test','test','fixture','https://staging.fixture.invalid','fixture','active')`,[connection,actor])
  await db.query(`INSERT INTO hz_fop_companies(id,connection_id,source_company_id,company_number,enabled)VALUES($1,$2,'fixture','fixture',true)`,[company,connection])
  await db.query(`INSERT INTO hz_fop_datasets(id,connection_id,company_id,state,validated_at,activated_at)VALUES($1,$2,$3,'active',now(),now())`,[previous,connection,company])
  await db.query('UPDATE hz_fop_companies SET active_dataset_id=$2 WHERE id=$1',[company,previous])
  let captured:ReturnType<typeof fixtures>|undefined
  source=new ReplicaHttpSource(config,db,async(url,options)=>{
   const key=new URL(String(url)).pathname.slice(1),body=JSON.parse(String(options?.body)),sourceAsOf=new Date(Date.now()-100).toISOString(),expiresAt=new Date(Date.now()+50000).toISOString(),common={scopeVersion:'v1',sourceAsOf,expiresAt},targetVector={orders:'orders-end',purchases:'purchases-end'}
   let data:object
   if(key==='SNAPSHOT_BEGIN'){captured=fixtures(sourceAsOf);data={...common,snapshotId:'cross-stream-snapshot',entityCodes:['hzkj_orders','hzkj_purorderbill'],streams:[{key:'orders',endCursor:'orders-end'},{key:'purchases',endCursor:'purchases-end'}]}}
   else if(key==='SNAPSHOT_PAGE'){pages++;const group=body.streamKey==='purchases'?captured!.purchase:body.afterCursor===null?captured!.first:captured!.second;data={snapshotId:body.snapshotId,streamKey:body.streamKey,afterCursor:body.afterCursor,complete:body.streamKey==='purchases'||body.afterCursor!==null,groups:[group]}}
   else if(key==='BARRIER')data={...common,id:'cross-barrier',targetVector,proof:{fixture:true}}
   else if(key==='RECONCILE')data={barrierId:body.barrierId,targetVector:body.targetVector,scopeVersion:'v1',entities:[{entityCode:'hzkj_orders',count:2,amounts:{USD:'20'}},{entityCode:'hzkj_purorderbill',count:1,amounts:{USD:'10'}}]}
   else if(key==='AUTHORIZATION')data={...common,companyAllowed:true,ownershipVector:targetVector,resources:REPLICA_RESOURCES.map(resource=>({resource,grants:[{target:'*',decision:'allow'}]})),employees:[],references:[]}
   else throw new Error('Unexpected source request '+key)
   return new Response(JSON.stringify({success:true,data:{schemaVersion:'fop-replica/1',tenantId:'fixture',companyId:'fixture',...data}}))
  })
  publisher=new ReplicaPublisher(db);bootstrap=new ReplicaBootstrapService(db,config,source,publisher,new ReplicaAuthorizationService(db,config,source))
 })
 afterEach(async()=>{await cleanup(company,connection)})
 const active=async()=>(await db.query('SELECT active_dataset_id id FROM hz_fop_companies WHERE id=$1',[company]))[0].id
 it('collects all pages first, fills later document/line targets, resumes a publication crash without rereading pages, then activates',async()=>{
  const original=publisher.apply.bind(publisher),apply=jest.spyOn(publisher,'apply');let crash=true
  apply.mockImplementation(async(...args)=>{if(crash){crash=false;throw new Error('synthetic publication interruption')}return original(...args)})
  let interrupted=false
  for(let i=0;i<10;i++){try{await bootstrap.initialize(actor,company,'staged')}catch{interrupted=true;break}}
  expect(interrupted).toBe(true);expect(pages).toBe(3);expect(await active()).toBe(previous)
  const [building]=await db.query("SELECT id FROM hz_fop_datasets WHERE company_id=$1 AND state='building'",[company])
  expect((await db.query("SELECT count(*)::int n FROM hz_fop_source_documents WHERE dataset_id=$1 AND validation_state='unverified' AND source_version IS NULL",[building.id]))[0].n).toBe(3)
  let result=await bootstrap.status(actor,company,'staged')
  for(let i=0;i<10&&result.state!=='published';i++)result=await bootstrap.initialize(actor,company,'staged')
  expect(result.state).toBe('published');expect(pages).toBe(3);expect(await active()).toBe(result.datasetId)
  expect((await db.query("SELECT count(*)::int n FROM hz_fop_source_documents WHERE dataset_id=$1 AND validation_state='unverified'",[result.datasetId]))[0].n).toBe(0)
  expect((await db.query('SELECT count(*)::int n FROM hz_fop_workbench_purchase_allocations WHERE dataset_id=$1',[result.datasetId]))[0].n).toBe(2)
  expect((await db.query("SELECT applied_watermarks->'_local'->'entityCodes' entities FROM hz_fop_datasets WHERE id=$1",[result.datasetId]))[0].entities).toEqual(['hzkj_orders','hzkj_purorderbill'])
 })
 it('clears the previous failure while a multi-page resume is still importing',async()=>{
  jest.spyOn(source,'page').mockRejectedValueOnce(new Error('workbench_fixture_transient_failure'))
  await expect(bootstrap.initialize(actor,company,'resume-error')).rejects.toMatchObject({response:{code:'workbench_fixture_transient_failure'}})
  const resumed=await bootstrap.initialize(actor,company,'resume-error')
  expect(resumed).toMatchObject({state:'importing',errorCode:null})
  expect(pages).toBe(1);expect(await active()).toBe(previous)
 })
 it('does not fabricate an absent referenced source line and never activates a snapshot with a missing target',async()=>{
  missingLine=true;let error:unknown
  for(let i=0;i<10;i++){try{await bootstrap.initialize(actor,company,'missing')}catch(e){error=e;break}}
  expect(error).toBeTruthy();expect(pages).toBe(3);expect(await active()).toBe(previous)
  await expect(bootstrap.initialize(actor,company,'missing')).rejects.toBeTruthy();expect(pages).toBe(3)
  expect((await db.query("SELECT count(*)::int n FROM hz_fop_source_lines l JOIN hz_fop_source_documents d ON d.id=l.document_id WHERE d.company_id=$1 AND d.source_id='purchase-1'",[company]))[0].n).toBe(0)
 })
})
