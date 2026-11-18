import { ProcurementDataExceptions1794981000000 } from '../../database/migrations/1794981000000-ProcurementDataExceptions'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DataSource, QueryRunner } from 'typeorm'
import { WorkbenchCollectedOrders1794411000000 } from '../../database/migrations/1794411000000-WorkbenchCollectedOrders'
import { CollectedEntities1794480000000 } from '../../database/migrations/1794480000000-CollectedEntities'
import { CollectedAnalyticsFacts1794500000000 } from '../../database/migrations/1794500000000-CollectedAnalyticsFacts'
import { PersistedExceptionState1794980000000 } from '../../database/migrations/1794980000000-PersistedExceptionState'

const database=process.env.EXCEPTION_PAGE_TEST_DB
const integration=database?.startsWith('hz_ddl_validation_')?describe:describe.skip
integration('transactional persisted exceptions',()=>{
 let db:DataSource,q:QueryRunner,batch:string,schema:string
 beforeAll(async()=>{
  db=await new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim()}).initialize()
  q=db.createQueryRunner();await q.connect();schema='exception_projection_'+Date.now();await q.query(`CREATE SCHEMA ${schema}`);await q.query(`SET search_path TO ${schema},public`)
  await new WorkbenchCollectedOrders1794411000000().up(q);await new CollectedEntities1794480000000().up(q);await new CollectedAnalyticsFacts1794500000000().up(q)
  await new PersistedExceptionState1794980000000().up(q)
  await new ProcurementDataExceptions1794981000000().up(q)
 })
 afterAll(async()=>{if(q){if(q.isTransactionActive)await q.rollbackTransaction();await q.query('SET search_path TO public');await q.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await q.release()}await db?.destroy()})
 beforeEach(async()=>{batch=randomUUID();await q.query("INSERT INTO hz_fop_collected_batches(id,workspace_owner_id,tenant_id,company_id,state,source_as_of) VALUES($1,$2,'tenant','100000','active',now())",[batch,randomUUID()])})
 const read=async(id='1')=>(await q.query('SELECT is_exception,exception_type,exception_reason,exception_code,exception_checked_at,exception_changed_at,exception_facts_hash,exception_rule_version FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id=$2',[batch,id]))[0]
 const revision=async()=>(await q.query('SELECT revision AS exception_data_revision FROM hz_fop_exception_versions WHERE batch_id=$1',[batch]))[0].exception_data_revision
 async function order(id='1'){
  const display={id,reviewStatus:'approved',businessStatus:{outbound:'completed'},dispatchDocuments:[{deliveryStatus:'FULFILLED',trackingNumbers:[{type:'full',number:'QC'}]}],nativeAssociationIssues:[],nativeProcurementAssociationIssues:[],exception:null}
  const raw={id,billno:'TO'+id,hzkj_orderstatus:'4',hzkj_logistics_info:[{hzkj_tracking_number:'QC'}]}
  await q.query("INSERT INTO hz_fop_collected_orders(batch_id,source_id,order_number,owner_employee_id,raw_bill_status,raw_order_status,raw_payment_status,raw_delivery_status,paid_at,search_text,display,raw) VALUES($1,$2,$3,'owner','C','4','1','2',now(),$3,$4,$5)",[batch,id,'TO'+id,JSON.stringify(display),JSON.stringify(raw)])
 }
 async function allocation(parent='1',status='error'){
  await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'allocation','a','',$2,'{}',now()) ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET display=excluded.display",[batch,JSON.stringify({sourceOrderId:parent,rawAllocationStatus:status})])
 }
 it('classifies incomplete linked purchases, preserves normal membership, and clears after repair',async()=>{
  await order()
  await q.query(`UPDATE hz_fop_collected_orders SET display=display||'{"nativeProcurementCaptured":true,"procurementQueueFlags":{"pending":true},"procurementStage":"purchase_order_pending"}'::jsonb WHERE batch_id=$1`,[batch])
  expect((await read()).is_exception).toBe(false)
  const save=async(raw:any,rowState='verified',lineId:any='line')=>q.query(`INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'purchase','p','',$2,$3,now()) ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET display=excluded.display,raw=excluded.raw`,[batch,JSON.stringify({association:{state:'verified'},rows:[{orderId:'1',associationState:rowState,lines:[{fulfillmentLineId:lineId}]}]}),JSON.stringify(raw)])
  await save({billstatus:'C',hzkj_cancelstatus:'A'})
  expect(await read()).toMatchObject({is_exception:true,exception_type:'procurement_exception',exception_reason:'采购付款信息不完整'})
  expect((await q.query(`SELECT count(*)::int n FROM hz_fop_collected_orders WHERE batch_id=$1 AND display->'procurementQueueFlags'->>'pending'='true'`,[batch]))[0].n).toBe(1)
  await save({billstatus:'C',hzkj_cancelstatus:'A',hzkj_pay_status:'0'})
  expect((await read()).is_exception).toBe(false)
  await save({hzkj_cancelstatus:'A',hzkj_pay_status:'0'})
  expect((await read()).exception_reason).toBe('采购单状态缺失')
  await save({billstatus:'C',hzkj_cancelstatus:'A',hzkj_pay_status:'1'},'unresolved')
  expect((await read()).exception_reason).toBe('采购关联未核实')
  await save({billstatus:'C',hzkj_cancelstatus:'A',hzkj_pay_status:'1'},'verified',null)
  expect((await read()).exception_reason).toBe('采购关联未核实')
  await save({billstatus:'C',hzkj_cancelstatus:'A',hzkj_pay_status:'1'})
  expect((await read()).is_exception).toBe(false)
  await save({hzkj_cancelstatus:'B'},'unresolved',null)
  expect((await read()).is_exception).toBe(false)
 })
 it('rechecks old and new parents on purchase relinking and deletion without leaking across batches',async()=>{
  await order('1');await order('2')
  const display=(id:string)=>JSON.stringify({association:{state:'verified'},rows:[{orderId:id,associationState:'verified',lines:[{fulfillmentLineId:'line'}]}]})
  await q.query(`INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'purchase','p','',$2,'{}',now())`,[batch,display('1')])
  expect((await read('1')).exception_reason).toBe('采购单状态缺失；采购付款信息不完整')
  expect((await read('2')).is_exception).toBe(false)
  await q.query(`UPDATE hz_fop_collected_entities SET display=$2 WHERE batch_id=$1 AND entity_type='purchase'`,[batch,display('2')])
  expect((await read('1')).is_exception).toBe(false);expect((await read('2')).exception_type).toBe('procurement_exception')
  await q.query(`DELETE FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='purchase'`,[batch])
  expect((await read('2')).is_exception).toBe(false)
 })
 it('checks new facts, skips an identical replay and clears resolved outbound anomalies',async()=>{
  await order();const normal=await read(),v=await revision();expect(normal).toMatchObject({is_exception:false,exception_type:null,exception_reason:null,exception_rule_version:2});expect(normal.exception_checked_at).toBeInstanceOf(Date)
  await q.query('UPDATE hz_fop_collected_orders SET raw=raw,display=display WHERE batch_id=$1',[batch]);expect(await read()).toEqual(normal);expect(await revision()).toBe(v)
  await q.query("UPDATE hz_fop_collected_orders SET raw_delivery_status='1',display=jsonb_set(display,'{businessStatus,outbound}','\"unknown\"') WHERE batch_id=$1",[batch])
  expect(await read()).toMatchObject({is_exception:true,exception_type:'outbound_exception',exception_reason:'部分出库无法核实'})
  expect(await revision()).not.toBe(v)
  await q.query("UPDATE hz_fop_collected_orders SET raw_delivery_status='2',display=jsonb_set(display,'{businessStatus,outbound}','\"completed\"') WHERE batch_id=$1",[batch])
  expect(await read()).toMatchObject({is_exception:false,exception_type:null,exception_reason:null})
 })
 it('rechecks both old and new allocation parents and keeps independent remaining causes',async()=>{
  await order('1');await order('2');await allocation();expect((await read('1')).exception_type).toBe('allocation_exception')
  await allocation('2');expect((await read('1')).is_exception).toBe(false);expect((await read('2')).exception_reason).toBe('配货单报错')
  await q.query("UPDATE hz_fop_collected_orders SET raw_order_status='6' WHERE batch_id=$1 AND source_id='2'",[batch]);expect((await read('2')).exception_reason).toBe('取消履约')
  await q.query("UPDATE hz_fop_collected_orders SET raw_order_status='4' WHERE batch_id=$1 AND source_id='2'",[batch]);expect((await read('2')).exception_reason).toBe('配货单报错')
  await allocation('2','completed');expect((await read('2')).is_exception).toBe(false)
 })
 it('deduplicates within a transaction, publishes the final facts and rolls back marks and revision together',async()=>{
  await order();const before=await read(),v=await revision();await q.startTransaction()
  await allocation();await allocation('1','completed');await allocation()
  expect((await q.query("SELECT count(*)::int n FROM hz_fop_exception_dirty WHERE batch_id=$1 AND document_kind='order'",[batch]))[0].n).toBe(1)
  await q.query('SELECT hz_exception_flush_v1($1)',[batch]);expect((await read()).exception_type).toBe('allocation_exception')
  await q.rollbackTransaction();expect(await read()).toEqual(before);expect(await revision()).toBe(v)
  await q.startTransaction();await allocation();await allocation('1','completed');await q.commitTransaction();expect((await read()).is_exception).toBe(false)
  expect(await q.query('SELECT * FROM hz_fop_exception_dirty WHERE batch_id=$1',[batch])).toEqual([])
 })
 it('persists stock exceptions after the matching source fact arrives and removes them on correction',async()=>{
  const stock={id:'s',stockNumber:'IO1',owner:null,items:[]}
  await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,owner_employee_id,search_text,display,raw,captured_at) VALUES($1,'stock_orders','s',NULL,'',$2,'{}',now())",[batch,JSON.stringify(stock)])
  const raw={id:'s',billno:'IO1',org_id:'100000',hzkj_operator_id:'0',hzkj_orderstatus:'2',hzkj_receipt_status:'',hzkj_receipt_date:null}
  await q.query("INSERT INTO hz_fop_collected_analytics_facts(batch_id,entity_type,source_id,company_id,document_number,facts,raw,captured_at) VALUES($1,'stock','s','100000','IO1','{}',$2,now())",[batch,JSON.stringify(raw)])
  const stockState=async()=>(await q.query("SELECT is_exception,exception_reason FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='stock_orders' AND source_id='s'",[batch]))[0]
  expect(await stockState()).toEqual({is_exception:true,exception_reason:'业务员为空；已支付，收款状态为空'})
  await q.query("UPDATE hz_fop_collected_analytics_facts SET raw=raw||'{\"hzkj_operator_id\":\"7\",\"hzkj_receipt_status\":\"1\"}'::jsonb WHERE batch_id=$1",[batch]);expect(await stockState()).toEqual({is_exception:false,exception_reason:null})
 })
 it('rechecks dispatch edits, unlink and deletion without retaining a stale parent snapshot',async()=>{
  await order('1');await order('2')
  const doc=(parent:string,state:string)=>JSON.stringify({sourceOrderId:parent,association:{state:'verified'},deliveryStatus:state,trackingNumbers:[{type:'full',number:'QC'}]})
  await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'dispatch','d','',$2,'{}',now())",[batch,doc('1','SYNC_FAILED')])
  expect((await read()).exception_type).toBe('dispatch_exception')
  await q.query("UPDATE hz_fop_collected_entities SET display=$2 WHERE batch_id=$1 AND source_id='d'",[batch,doc('2','SYNC_FAILED')])
  expect((await read()).is_exception).toBe(false);expect((await read('2')).exception_type).toBe('dispatch_exception')
  await q.query("DELETE FROM hz_fop_collected_entities WHERE batch_id=$1 AND source_id='d'",[batch]);expect((await read('2')).is_exception).toBe(false)
 })
 it('does not treat missing downstream coverage as an exception or allow another batch to affect a parent',async()=>{
  await order();await q.query("UPDATE hz_fop_collected_orders SET display=display||'{\"nativeAssociationIssues\":[\"timestamp_relation_coverage_unknown\"]}'::jsonb WHERE batch_id=$1",[batch]);expect((await read()).is_exception).toBe(false)
  const other=randomUUID();await q.query("INSERT INTO hz_fop_collected_batches(id,workspace_owner_id,tenant_id,company_id,state,source_as_of) VALUES($1,$2,'tenant','100000','active',now())",[other,randomUUID()])
  await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'allocation','x','','{\"sourceOrderId\":\"1\",\"rawAllocationStatus\":\"error\"}','{}',now())",[other]);expect((await read()).is_exception).toBe(false)
 })

 it('allows concurrent parent and child writes without sharing a dirty-row lock',async()=>{
  await order();const other=db.createQueryRunner();await other.connect();await other.query(`SET search_path TO ${schema},public`)
  try{
   await q.startTransaction();await other.startTransaction();await other.query("SET LOCAL statement_timeout='2s'")
   await allocation()
   await other.query("UPDATE hz_fop_collected_orders SET search_text='changed' WHERE batch_id=$1 AND source_id='1'",[batch])
   await Promise.all([q.commitTransaction(),other.commitTransaction()])
   expect((await read()).exception_reason).toBe('配货单报错')
   expect(await q.query('SELECT * FROM hz_fop_exception_dirty WHERE batch_id=$1',[batch])).toEqual([])
  }finally{if(q.isTransactionActive)await q.rollbackTransaction();if(other.isTransactionActive)await other.rollbackTransaction();await other.query('RESET search_path');await other.release()}
 })

 it('does not make source-first maintenance wait on a publisher batch lock',async()=>{
  await order();await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'rma','r','','{}','{}',now())",[batch])
  const other=db.createQueryRunner();await other.connect();await other.query(`SET search_path TO ${schema},public`)
  try{
   await other.startTransaction();await other.query('SELECT id FROM hz_fop_collected_batches WHERE id=$1 FOR UPDATE',[batch])
   await q.startTransaction();await q.query("SET LOCAL statement_timeout='2s'")
   await q.query("UPDATE hz_fop_collected_entities SET search_text='maintenance' WHERE batch_id=$1 AND source_id='r'",[batch])
   const publish=other.query("UPDATE hz_fop_collected_entities SET search_text='published' WHERE batch_id=$1 AND source_id='r'",[batch])
   await q.commitTransaction();await publish;await other.commitTransaction()
   expect((await q.query("SELECT search_text FROM hz_fop_collected_entities WHERE batch_id=$1 AND source_id='r'",[batch]))[0].search_text).toBe('published')
  }finally{if(q.isTransactionActive)await q.rollbackTransaction();if(other.isTransactionActive)await other.rollbackTransaction();await other.query('RESET search_path');await other.release()}
 })

 it('rolls back the procurement rule and rebuilds it without changing source facts',async()=>{
  await order()
  await q.query(`INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'purchase','p','','{"association":{"state":"verified"},"rows":[{"orderId":"1","associationState":"verified","lines":[{"fulfillmentLineId":"x"}]}]}','{"billstatus":"C","hzkj_cancelstatus":"A"}',now())`,[batch])
  expect((await read()).exception_type).toBe('procurement_exception')
  const source=(await q.query('SELECT raw,display FROM hz_fop_collected_orders WHERE batch_id=$1',[batch]))[0]
  await new ProcurementDataExceptions1794981000000().down(q)
  expect((await read()).is_exception).toBe(false)
  await new ProcurementDataExceptions1794981000000().up(q)
  expect((await read()).exception_reason).toBe('采购付款信息不完整')
  expect((await q.query('SELECT raw,display FROM hz_fop_collected_orders WHERE batch_id=$1',[batch]))[0]).toEqual(source)
 })

})
