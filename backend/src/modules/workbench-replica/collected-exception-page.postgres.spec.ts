import { collectedDiagnosticTypeSql, collectedDiagnosticDisplaySql } from './collected-exception-classification'
import { collectedPaymentDataExceptionSql } from './collected-payment-data-quality'
import { collectedDispatchExceptionSql } from './collected-dispatch-status'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DataSource } from 'typeorm'
import { collectedExceptionPage } from './collected-exception-page'
import { collectedWhere } from './collected-workbench-query'
import { collectedExceptionHeaderCandidateSql } from './collected-exception-candidates'
import { WorkbenchOutboundException1794967200000 } from '../../database/migrations/1794967200000-WorkbenchOutboundException'
import { CollectedExceptionCandidates1794975000000 } from '../../database/migrations/1794975000000-CollectedExceptionCandidates'

const database=process.env.EXCEPTION_PAGE_TEST_DB
const integration=database?.startsWith('hz_ddl_validation_')?describe:describe.skip
integration('exception page PostgreSQL membership, facets and scope',()=>{
 let db:DataSource
 beforeAll(async()=>{db=await new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim(),synchronize:false}).initialize()})
 afterAll(async()=>{await db?.destroy()})
 function row(id:string,patch:Record<string,any>={}){
  return {batch_id:'batch',source_id:id,order_number:'TO-'+id,owner_employee_id:'owner',raw_bill_status:'C',raw_order_status:'4',raw_payment_status:'1',raw_delivery_status:'2',paid_at:'2026-11-01T00:00:00Z',country_code:'US',warehouse_code:'HZ',total_quantity:2,search_text:('TO-'+id).toLowerCase(),
   display:{id,nativeFactsCaptured:true,nativeProcurementCaptured:true,nativeAssociationIssues:[],nativeProcurementAssociationIssues:[],procurementStage:'shipped',dispatchTaskStatus:'dispatch_synced',dispatchDocuments:[{deliveryStatus:'FULFILLED',trackingNumbers:[{type:'full',number:'TRACK'}]}],exception:null},
   raw:{id,billno:'TO-'+id,hzkj_logistics_info:[{hzkj_tracking_number:'TRACK'}]},...patch}
 }
 function fixtures(){
  const procurement=row('01');procurement.display.nativeProcurementAssociationIssues=['current_purchase_relationship_unresolved'] as any
  const failed=row('02',{country_code:'GB'});failed.display.dispatchDocuments[0].deliveryStatus='SYNC_FAILED'
  const missing=row('03');missing.raw.hzkj_logistics_info=[]
  const obtained=row('04');obtained.display.dispatchDocuments[0]={deliveryStatus:'TRACKING_OBTAINED',trackingNumbers:[]}
  const allocation=row('05')
  const base=row('06',{raw_order_status:null,raw_delivery_status:'0'})
  const cancelled=row('07',{raw_order_status:'0',raw_delivery_status:'0'})
  const conflict=row('08',{raw_order_status:'2',raw_delivery_status:'0'})
  const typed=row('09');Object.assign(typed.display,{exception:{type:'logistics_exception'},nativeAssociationIssues:['parent_version_conflict']})
  const legacy=row('10');Object.assign(legacy.display,{exception:{type:'dispatch_exception'},nativeProcurementAssociationIssues:['unresolved']})
  const partial=row('11',{raw_delivery_status:'1'});Object.assign(partial.display,{businessStatus:{outbound:'unknown'}})
  const uncertain=row('12',{raw_order_status:'2',raw_bill_status:'A',raw_delivery_status:'0'});uncertain.display.nativeProcurementCaptured=false;uncertain.display.dispatchTaskStatus='dispatch_pending'
  const sourceAbsent=row('13',{raw_order_status:'1',raw_bill_status:'A',raw_payment_status:'0',raw_delivery_status:'0'});Object.assign(sourceAbsent.display,{exception:{type:'dispatch_exception'},salesSourceStatus:{source:'fulfillment_capture',sourceId:'13',orderStatus:'1',fulfillmentStatus:'fulfilled'}})
  const sourceNull=row('normal-null',{raw_order_status:'1',raw_bill_status:'A',raw_payment_status:'0',raw_delivery_status:'0'});Object.assign(sourceNull.display,{exception:{type:'dispatch_exception'},salesSourceStatus:{source:'fulfillment_capture',sourceId:'normal-null',orderStatus:'1',fulfillmentStatus:'fulfilled'}});Object.assign(sourceNull.raw,{hzkj_fulfillment_status:null})
  const foreign=row('foreign',{owner_employee_id:'other'});foreign.raw.hzkj_logistics_info=[]
  const wrongBatch=row('wrong-batch',{batch_id:'other'});wrongBatch.raw.hzkj_logistics_info=[]
  return [procurement,failed,missing,obtained,allocation,base,cancelled,conflict,typed,legacy,partial,uncertain,sourceAbsent,sourceNull,row('normal-complete'),foreign,wrongBatch]
 }
 async function run(query:Record<string,any>={},employees:string[]=['owner'],page=1,pageSize=50,extra:any[]=[],allocationStatus='error'){
  const q=collectedExceptionPage('batch',employees,{queue:'exceptions',...query},page,pageSize),n=q.params.length
  const facts=collectedWhere('batch',null,{queue:'exceptions'},'facts').where.replace('(batch_id = $1) AND ','')
  const prefix=`WITH source_rows AS (SELECT * FROM jsonb_to_recordset($${n+1}) o(batch_id text,source_id text,order_number text,owner_employee_id text,raw_bill_status text,raw_order_status text,raw_payment_status text,raw_delivery_status text,paid_at timestamptz,consumer_paid_at timestamptz,country_code text,warehouse_code text,total_quantity numeric,search_text text,display jsonb,raw jsonb)),
   hz_fop_collected_batches AS (SELECT 'batch'::text id,'company'::text company_id),
   hz_fop_collected_entities AS (SELECT 'batch'::text batch_id,'allocation'::text entity_type,'alloc'::text source_id,'{}'::jsonb raw,jsonb_build_object('sourceOrderId','05','rawAllocationStatus',$${n+2}::text,'rawBillStatus','A') display), hz_fop_collected_orders AS (SELECT *,coalesce(${facts},false) AS is_exception,CASE WHEN raw_order_status='6' OR ${collectedPaymentDataExceptionSql} THEN 'logistics_exception' WHEN ${collectedDispatchExceptionSql} THEN 'dispatch_exception' ELSE ${collectedDiagnosticTypeSql()} END AS exception_type,(${collectedDiagnosticDisplaySql()})->'exception'->>'reason' AS exception_reason,NULL::text AS exception_code FROM source_rows hz_fop_collected_orders), `
  return (await db.query(prefix+q.sql.slice(5),[...q.params,JSON.stringify([...fixtures(),...extra]),allocationStatus]))[0]
 }
 it('includes native cancellation without a saved mark only in order exceptions, respects scope and recovery',async()=>{
  const cancelled=row('cancel-fulfillment',{raw_order_status:'6'})
  const foreign=row('foreign-cancel',{raw_order_status:'6',owner_employee_id:'other'})
  const query={taskStatus:'logistics_exception',search:'TO-cancel-fulfillment'}
  const result=await run(query,['owner'],1,50,[cancelled,foreign])
  expect(result.total).toBe(1)
  expect(result.rows[0].display.id).toBe('cancel-fulfillment')
  expect((await run({...query,taskStatus:'dispatch_exception'},['owner'],1,50,[cancelled])).total).toBe(0)
  expect((await run(query,[],1,50,[cancelled])).total).toBe(0)
  cancelled.raw_order_status='4'
  expect((await run(query,['owner'],1,50,[cancelled])).total).toBe(0)
 })
 it('preserves diagnostic scenarios without treating every normal order as an exception',async()=>{
  const result=await run()
  expect(result.rows.map((r:any)=>r.display.id)).toEqual(['02','03','04','05','06','08','09','10','11','13'])
  expect(result.total).toBe(10);expect(result.quantity).toBe('20');expect(result.countries).toEqual(['GB','US'])
 })
 it('candidate lookup cannot omit exceptions across native states, missing tracking and supplemental packages',async()=>{
  const tracks=[[],[{type:'full',number:'QC'}],[{type:'full',number:' \t\r\n'}],[{type:'full',number:123}],[{type:'full',number:['QC']}],[{type:'last_mile',number:'WC'}],[{type:'full',number:null},{type:'first_mile',number:'TC'}],null]
  const packages=[undefined,null,[],[{hzkj_tracking_number:'QC'}],[{hzkj_tracking_number:' \t\r\n'}],[{hzkj_tracking_number:123}]]
  const samples:any[]=[]
  for(const state of ['no','1','2','3','4','5','6',null,'unexpected'])for(const delivery of ['FULFILLED','TRACKING_OBTAINED','SYNC_FAILED',null])for(const trackingNumbers of tracks)for(const pkg of packages){
   const id=String(samples.length),r=row(id,{raw_order_status:state});r.display.dispatchDocuments=[{deliveryStatus:delivery,trackingNumbers}] as any;r.raw.hzkj_logistics_info=pkg as any
   if(samples.length%5===0)Object.assign(r.display,{moneyCapture:{sourceId:id,orderNumber:'TO-'+id,companyId:'company',operation:'order-list',values:{hzkj_logistics_info:[]}}})
   samples.push(r)
  }
  const baseline=collectedWhere('batch',['owner'],{queue:'exceptions'},'facts'),n=baseline.params.length
  const result=await db.query(`WITH hz_fop_collected_orders AS (SELECT * FROM jsonb_to_recordset($${n+1}) o(batch_id text,source_id text,order_number text,owner_employee_id text,raw_bill_status text,raw_order_status text,raw_payment_status text,raw_delivery_status text,paid_at timestamptz,display jsonb,raw jsonb)),
   hz_fop_collected_batches AS (SELECT 'batch'::text id,'company'::text company_id),
   hz_fop_collected_entities AS (SELECT NULL::text batch_id,NULL::text entity_type,NULL::text source_id,NULL::jsonb raw,NULL::jsonb display WHERE FALSE)
   SELECT source_id FROM hz_fop_collected_orders WHERE ${baseline.where} AND NOT coalesce(${collectedExceptionHeaderCandidateSql},false)`,[...baseline.params,JSON.stringify(samples)])
  expect(samples).toHaveLength(1728)
  expect(result).toEqual([])
 })
 it.each([
  ['outbound_exception','11','部分出库无法核实'],
  ['allocation_exception','05','配货单报错'],
 ])('classifies and filters native %s with the same reason for rows, counts and selected exports',async(type,id,reason)=>{
  const result=await run({taskStatus:type})
  expect(result.total).toBe(1)
  expect(result.rows.map((r:any)=>r.display.id)).toEqual([id])
  expect(result.rows[0].display.exception).toMatchObject({type,reason})
  expect((await run({taskStatus:type,projection:'count'})).total).toBe(1)
  expect((await run({taskStatus:type,mode:'selected',orderIds:[id,'foreign','normal-complete']})).rows.map((r:any)=>r.display.id)).toEqual([id])
  expect((await run({taskStatus:type},[])).total).toBe(0)
 })
 it('does not classify known partial outbound progress or unrelated allocation errors',async()=>{
  const known=row('known-partial',{raw_delivery_status:'1'});Object.assign(known.display,{businessStatus:{outbound:'partial'}})
  expect((await run({taskStatus:'outbound_exception',search:'TO-known-partial'},['owner'],1,50,[known])).total).toBe(0)
  expect((await run({taskStatus:'allocation_exception',search:'TO-normal-complete'})).total).toBe(0)
  expect((await run({taskStatus:'allocation_exception'},['owner'],1,50,[],'completed')).total).toBe(0)
 })
 it('extends persisted exception validation without accepting arbitrary types',async()=>{
  const runner=db.createQueryRunner();await runner.connect();await runner.startTransaction()
  try {
   await runner.query("CREATE TEMP TABLE hz_fop_exception_marks(type text CONSTRAINT ck_hz_fop_exception_marks_type CHECK(type IN ('procurement_exception','dispatch_exception','allocation_exception','logistics_exception','delivery_exception'))) ON COMMIT DROP")
   await new WorkbenchOutboundException1794967200000().up(runner)
   await runner.query("INSERT INTO hz_fop_exception_marks(type) VALUES ('outbound_exception'),('allocation_exception')")
   expect((await runner.query('SELECT type FROM hz_fop_exception_marks ORDER BY type')).map((r:any)=>r.type)).toEqual(['allocation_exception','outbound_exception'])
   await expect(runner.query("INSERT INTO hz_fop_exception_marks(type) VALUES ('invalid')")).rejects.toThrow()
  } finally {await runner.rollbackTransaction();await runner.release()}
 })
 it('candidate indexes follow local fact changes and can be rolled back without changing source rows',async()=>{
  const runner=db.createQueryRunner(),schema='exception_index_test_'+Date.now()
  await runner.connect()
  try {
   await runner.query(`CREATE SCHEMA ${schema}`);await runner.query(`SET search_path TO ${schema},public`)
   await runner.query('CREATE TABLE hz_fop_collected_orders(batch_id text,source_id text,owner_employee_id text,raw_order_status text,raw_bill_status text,raw_payment_status text,raw_delivery_status text,paid_at timestamptz,display jsonb,raw jsonb)')
   await runner.query('CREATE TABLE hz_fop_collected_entities(batch_id text,entity_type text,display jsonb)')
   const migration=new CollectedExceptionCandidates1794975000000();await migration.up(runner)
   await runner.query("INSERT INTO hz_fop_collected_orders VALUES ('b','order','owner','1','A','0','0',NULL,'{}','{}')")
   const candidates=()=>runner.query(`SELECT source_id FROM hz_fop_collected_orders WHERE batch_id='b' AND ${collectedExceptionHeaderCandidateSql}`)
   expect(await candidates()).toEqual([])
   await runner.query("UPDATE hz_fop_collected_orders SET raw_delivery_status='1',display= '{\"businessStatus\":{\"outbound\":\"unknown\"}}'")
   expect(await candidates()).toEqual([{source_id:'order'}])
   await runner.query('SET enable_seqscan=off')
   const [plan]=await runner.query(`EXPLAIN (FORMAT JSON) SELECT source_id FROM hz_fop_collected_orders WHERE batch_id='b' AND ${collectedExceptionHeaderCandidateSql}`)
   expect(JSON.stringify(plan)).toContain('ix_collected_exception_candidates')
   await runner.query("UPDATE hz_fop_collected_orders SET raw_delivery_status='2',display='{}'")
   expect(await candidates()).toEqual([])
   await runner.query("INSERT INTO hz_fop_collected_entities VALUES ('b','allocation','{\"sourceOrderId\":\"order\",\"rawAllocationStatus\":\"error\"}')")
   const allocation="SELECT display->>'sourceOrderId' AS id FROM hz_fop_collected_entities WHERE batch_id='b' AND entity_type='allocation' AND display->>'rawAllocationStatus'='error'"
   expect(await runner.query(allocation)).toEqual([{id:'order'}])
   expect(JSON.stringify((await runner.query('EXPLAIN (FORMAT JSON) '+allocation))[0])).toContain('ix_collected_allocation_errors')
   await runner.query("UPDATE hz_fop_collected_entities SET display=jsonb_set(display,'{rawAllocationStatus}','\"completed\"')")
   expect(await runner.query(allocation)).toEqual([])
   await migration.down(runner)
   expect((await runner.query('SELECT count(*)::int n FROM hz_fop_collected_orders'))[0].n).toBe(1)
  } finally {await runner.query('RESET enable_seqscan');await runner.query('SET search_path TO public');await runner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await runner.release()}
 })
 it('includes live tracking exceptions and retained explicit dispatch types',async()=>{
  const result=await run({taskStatus:'dispatch_exception'})
  expect(result.rows.map((r:any)=>r.display.id)).toEqual(['02','03','04','10','13']);expect(result.total).toBe(5)
 })
 it('filters non-dispatch types without losing their own diagnostic membership',async()=>{
  const result=await run({taskStatus:'logistics_exception'})
  expect(result.rows.map((r:any)=>r.display.id)).toEqual(['09']);expect(result.total).toBe(1)
 })
 it('preserves full authorized country options when one country is selected',async()=>{
  const result=await run({taskStatus:'dispatch_exception',shippingCountryCode:'US'},['owner'],2,1)
  expect(result.rows.map((r:any)=>r.display.id)).toEqual(['04']);expect(result.total).toBe(4);expect(result.countries).toEqual(['GB','US'])
 })
 it.each([{projection:'count'},{page:99}])('keeps totals when the visible page is empty: %j',async query=>{
  const result=await run(query,['owner'],query.page??1)
  expect(result.rows).toEqual([]);expect(result.total).toBe(10)
 })
 it('enforces empty scope in results, totals and facets',async()=>{const r=await run({},[]);expect(r.rows).toEqual([]);expect(r.total).toBe(0);expect(r.countries).toEqual([])})
 it('keeps search and selected export within membership and owner scope',async()=>{
  const result=await run({taskStatus:'dispatch_exception',mode:'selected',orderIds:['03','foreign','normal-complete'],warehouseCode:'01'})
  expect(result.rows.map((r:any)=>r.display.id)).toEqual(['03'])
  expect((await run({taskStatus:'dispatch_exception',search:'TO-02'})).total).toBe(1)
  expect((await run({search:"%' OR TRUE --"})).total).toBe(0)
 })
})
