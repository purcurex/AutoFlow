import { DataSource } from 'typeorm'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { TimestampPostgresStore } from './timestamp-postgres'
import { TimestampSync } from './timestamp-sync'
import { TimestampPagedSync } from './timestamp-paged-sync'
import { timestampStatus } from './timestamp-status'
import { TimestampQueryReplica1794770000000 } from '../../database/migrations/1794770000000-TimestampQueryReplica'
import { WorkbenchCollectedOrders1794411000000 } from '../../database/migrations/1794411000000-WorkbenchCollectedOrders'
import { CollectedEntities1794480000000 } from '../../database/migrations/1794480000000-CollectedEntities'

const database=process.env.TIMESTAMP_SYNC_TEST_DB
const integration=database&&/^hz_timestamp_test_\d+$/.test(database)?describe:describe.skip
integration('timestamp durable PostgreSQL capture and local projection',()=>{
 let db:DataSource,scope:any,source:any,engine:TimestampSync,documents:any[]
 const at='2026-11-15T00:00:00.123456789Z'
 const order=(id:string,owner='7',modifiedAt=at)=>({id,companyId:'100000',createdAt:at,modifiedAt,raw:{id,billno:'SO'+id,hzkj_org:{id:'100000'},hzkj_operator:{id:owner,name:'Employee'},billstatus:'A',hzkj_receipt_status:'0',hzkj_orderstatus:'1',hzkj_orders_billentry:[],createtime:at,modifytime:modifiedAt}})
 beforeAll(async()=>{
  db=await new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim(),synchronize:false}).initialize()
  const q=db.createQueryRunner();try{await new WorkbenchCollectedOrders1794411000000().up(q);await new CollectedEntities1794480000000().up(q);await new TimestampQueryReplica1794770000000().up(q)}finally{await q.release()}
 })
 afterAll(async()=>{await db?.destroy()})
 beforeEach(async()=>{
  scope={batchId:randomUUID(),tenantId:'tenant',companyId:'100000',entityCode:'hzkj_orders'}
  await db.query("INSERT INTO hz_fop_collected_batches(id,workspace_owner_id,tenant_id,company_id,state,source_as_of) VALUES($1,$2,'tenant','100000','active',now())",[scope.batchId,randomUUID()])
  documents=[order('1')]
  source={assertReady:()=>{},clock:async()=> '2026-11-15T00:05:00Z',page:async(_:any,q:any)=>({scope,rows:q.mode==='full'?documents:[],complete:true}),exists:async(_:any,id:string)=>({scope,id,state:'absent'})}
  engine=new TimestampSync(new TimestampPostgresStore(db),source)
 })
 afterEach(async()=>{await db.query('DELETE FROM hz_fop_collected_batches WHERE id=$1',[scope.batchId])})
 it('commits native facts, primary workbench display and W together; identical replay is idempotent',async()=>{
  await engine.run(scope,'initialize');await engine.run(scope,'reconcile')
  const [o]=await db.query('SELECT * FROM hz_fop_collected_orders WHERE batch_id=$1',[scope.batchId])
  expect(o.owner_employee_id).toBe('7');expect(o.display.orderNumber).toBe('SO1');expect(o.display.paymentStatus).toBe('unpaid')
  const [s]=await db.query('SELECT * FROM hz_fop_timestamp_state WHERE batch_id=$1',[scope.batchId]);expect(s.watermark).toBe('2026-11-15T00:03:00.000000000Z')
  const docs=await db.query('SELECT * FROM hz_fop_timestamp_documents WHERE batch_id=$1',[scope.batchId]);expect(docs).toHaveLength(1);expect(docs[0].modified_at).toBe(at)
 })
 it('updates ownership and clears stale native stage data through the shared list table',async()=>{
  await engine.run(scope,'initialize')
  await db.query(`UPDATE hz_fop_collected_orders SET display=display||'{"nativeShippingReady":true}'::jsonb WHERE batch_id=$1`,[scope.batchId])
  documents=[order('1','9','2026-11-15T00:01:00Z')];await engine.run(scope,'reconcile')
  const [o]=await db.query('SELECT * FROM hz_fop_collected_orders WHERE batch_id=$1',[scope.batchId]);expect(o.owner_employee_id).toBe('9');expect(o.display.nativeShippingReady).toBeUndefined()
 })
 it('rolls back facts, projection and W when any document cannot normalize',async()=>{
  documents=[order('1'),{...order('2'),raw:{id:'2'}}]
  await expect(engine.run(scope,'initialize')).rejects.toThrow()
  expect(await db.query('SELECT * FROM hz_fop_collected_orders WHERE batch_id=$1',[scope.batchId])).toHaveLength(0)
  expect(await db.query('SELECT * FROM hz_fop_timestamp_documents WHERE batch_id=$1',[scope.batchId])).toHaveLength(0)
  const [s]=await db.query('SELECT * FROM hz_fop_timestamp_state WHERE batch_id=$1',[scope.batchId]);expect(s?.watermark??null).toBeNull()
  const [r]=await db.query('SELECT * FROM hz_fop_timestamp_runs WHERE batch_id=$1',[scope.batchId]);expect(r.state).toBe('failed')
 })
 it('deletes only confirmed absent records, retaining a local tombstone',async()=>{
  await engine.run(scope,'initialize');documents=[];await engine.run(scope,'reconcile')
  expect(await db.query('SELECT * FROM hz_fop_collected_orders WHERE batch_id=$1',[scope.batchId])).toHaveLength(0)
  const [d]=await db.query('SELECT * FROM hz_fop_timestamp_documents WHERE batch_id=$1',[scope.batchId]);expect(d.removed).toBe(true)
 })
 it('stores unsupported entity facts with an explicit durable pending projection, not ready',async()=>{
  scope.entityCode='hzkj_alloc_bill';await engine.run(scope,'initialize')
  const [r]=await db.query('SELECT state FROM hz_fop_timestamp_runs WHERE batch_id=$1',[scope.batchId]);expect(r.state).toBe('projection_pending')
  const [p]=await db.query('SELECT * FROM hz_fop_timestamp_projection_tasks WHERE batch_id=$1',[scope.batchId]);expect(p.state).toBe('pending');expect(p.reason).toBe('entity_projection_not_connected')
 })
 it('a second writer fails without altering the first writer lock',async()=>{
  const store=new TimestampPostgresStore(db)
  await store.exclusive(scope,async()=>{await expect(new TimestampPostgresStore(db).exclusive(scope,async()=>1)).rejects.toThrow('timestamp_scope_busy')})
  await expect(store.exclusive(scope,async()=>1)).resolves.toBe(1)
 })
 it('isolates a new parent from the published linked snapshot until related projections can be rebuilt',async()=>{
  await engine.run(scope,'initialize')
  await db.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at) VALUES($1,'allocation','a1',$2,'{}','',now())",[scope.batchId,JSON.stringify({sourceOrderId:'1',rawBillStatus:'C'})])
  documents=[order('1','7','2026-11-15T00:02:00Z')];documents[0].raw.billstatus='D';await engine.run(scope,'reconcile')
  const [o]=await db.query('SELECT raw_bill_status FROM hz_fop_collected_orders WHERE batch_id=$1',[scope.batchId]);expect(o.raw_bill_status).toBe('A')
  const [d]=await db.query('SELECT raw FROM hz_fop_timestamp_documents WHERE batch_id=$1',[scope.batchId]);expect(d.raw.billstatus).toBe('D')
  const [b]=await db.query('SELECT metadata FROM hz_fop_collected_batches WHERE id=$1',[scope.batchId]);expect(b.metadata.timestampSync.hzkj_orders.presentation).toBe('previous_snapshot')
 })
 it('records a permission fence when source ownership changes, even before linked snapshot publication',async()=>{
  await engine.run(scope,'initialize');documents=[order('1','9')];await engine.run(scope,'reconcile')
  const [b]=await db.query('SELECT metadata FROM hz_fop_collected_batches WHERE id=$1',[scope.batchId]);expect(b.metadata.timestampOwnershipPending).toBe(true)
 })
 function ordinary(rows:any[]){
  return new TimestampPagedSync(new TimestampPostgresStore(db),{assertReady:()=>{},captureIdentityBasis:()=>({tenantId:'tenant',userId:'integration',companyId:'100000',basis:'kingdee_get_connection_context',scopeProof:false}),page:async()=>({scope,rows,totalCount:rows.length,lastPage:true})},()=> '2026-11-15T00:06:00Z')
 }
 it('ordinary capture commits facts, identity metadata and W together while retaining the previous displayed generation',async()=>{
  await engine.run(scope,'initialize')
  const changed=order('1','7','2026-11-15T00:02:00Z');changed.raw.billstatus='D'
  await ordinary([changed]).run(scope,'reconcile')
  const [o]=await db.query('SELECT raw_bill_status FROM hz_fop_collected_orders WHERE batch_id=$1',[scope.batchId]);expect(o.raw_bill_status).toBe('A')
  const [d]=await db.query('SELECT raw,last_run_id FROM hz_fop_timestamp_documents WHERE batch_id=$1',[scope.batchId]);expect(d.raw.billstatus).toBe('D')
  const [s]=await db.query('SELECT watermark FROM hz_fop_timestamp_state WHERE batch_id=$1',[scope.batchId]);expect(s.watermark).toBe('2026-11-15T00:04:00.000000000Z')
  const [b]=await db.query('SELECT metadata FROM hz_fop_collected_batches WHERE id=$1',[scope.batchId]),m=b.metadata.timestampSync.hzkj_orders
  expect(m.watermark).toBe(s.watermark);expect(m.runId).toBe(d.last_run_id);expect(m.publicationPending).toBe(true);expect(m.presentation).toBe('previous_snapshot');expect(m.identityBasis.userId).toBe('integration');expect(m.sourceScopeProof).toBe(false)
 })
 it('ordinary empty initialization persists publication pending even with zero pending tasks',async()=>{
  await ordinary([]).run(scope,'initialize')
  const [b]=await db.query('SELECT metadata FROM hz_fop_collected_batches WHERE id=$1',[scope.batchId])
  expect(b.metadata.timestampSync.hzkj_orders.pendingProjection).toBe(0)
  expect(timestampStatus(b.metadata.timestampSync)?.projectionPending).toBe(true)
 })
 it('rolls back ordinary facts, tasks and W if the final batch metadata publication fails',async()=>{
  await engine.run(scope,'initialize')
  const [before]=await db.query('SELECT metadata FROM hz_fop_collected_batches WHERE id=$1',[scope.batchId])
  await db.query("ALTER TABLE hz_fop_collected_batches ADD CONSTRAINT test_reject_ordinary_metadata CHECK ((metadata->'timestampSync'->'hzkj_orders'->>'protocol') IS DISTINCT FROM 'ordinary_modified_pages') NOT VALID")
  try{
   const changed=order('1','7','2026-11-15T00:02:00Z');changed.raw.billstatus='D'
   await expect(ordinary([changed]).run(scope,'reconcile')).rejects.toThrow('test_reject_ordinary_metadata')
   const [s]=await db.query('SELECT watermark FROM hz_fop_timestamp_state WHERE batch_id=$1',[scope.batchId]);expect(s.watermark).toBe('2026-11-15T00:03:00.000000000Z')
   const [d]=await db.query('SELECT raw FROM hz_fop_timestamp_documents WHERE batch_id=$1',[scope.batchId]);expect(d.raw.billstatus).toBe('A')
   const [p]=await db.query('SELECT current_raw FROM hz_fop_timestamp_projection_tasks WHERE batch_id=$1',[scope.batchId]);expect(p.current_raw.billstatus).toBe('A')
   const [b]=await db.query('SELECT metadata FROM hz_fop_collected_batches WHERE id=$1',[scope.batchId]);expect(b.metadata).toEqual(before.metadata)
   const runs=await db.query("SELECT state FROM hz_fop_timestamp_runs WHERE batch_id=$1 AND mode='reconcile'",[scope.batchId]);expect(runs[0].state).toBe('failed')
  }finally{await db.query('ALTER TABLE hz_fop_collected_batches DROP CONSTRAINT test_reject_ordinary_metadata')}
 })
})
