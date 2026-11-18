import {TrustPurchaseOrderNumber1794982000000} from '../../database/migrations/1794982000000-TrustPurchaseOrderNumber'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {DataSource,QueryRunner} from 'typeorm'
import {WorkbenchCollectedOrders1794411000000} from '../../database/migrations/1794411000000-WorkbenchCollectedOrders'
import {CollectedEntities1794480000000} from '../../database/migrations/1794480000000-CollectedEntities'
import {CollectedAnalyticsFacts1794500000000} from '../../database/migrations/1794500000000-CollectedAnalyticsFacts'
import {PersistedExceptionState1794980000000} from '../../database/migrations/1794980000000-PersistedExceptionState'
import {ProcurementDataExceptions1794981000000} from '../../database/migrations/1794981000000-ProcurementDataExceptions'
const database=process.env.EXCEPTION_PAGE_TEST_DB
const integration=database?.startsWith('hz_ddl_validation_')?describe:describe.skip
integration('purchase number is authoritative',()=>{
 let db:DataSource,q:QueryRunner,schema:string
 const batch='00000000-0000-4000-8000-000000000001'
 beforeAll(async()=>{
  db=await new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim()}).initialize();q=db.createQueryRunner();await q.connect();schema='purchase_number_'+Date.now();await q.query(`CREATE SCHEMA ${schema}`);await q.query(`SET search_path TO ${schema},public`)
  await new WorkbenchCollectedOrders1794411000000().up(q);await new CollectedEntities1794480000000().up(q);await new CollectedAnalyticsFacts1794500000000().up(q);await new PersistedExceptionState1794980000000().up(q);await new ProcurementDataExceptions1794981000000().up(q);await new TrustPurchaseOrderNumber1794982000000().up(q)
  await q.query(`INSERT INTO hz_fop_collected_batches(id,workspace_owner_id,tenant_id,company_id,state,source_as_of) VALUES($1,$1,'tenant','100000','active',now())`,[batch])
  await q.query(`INSERT INTO hz_fop_collected_orders(batch_id,source_id,order_number,raw_bill_status,raw_order_status,raw_payment_status,raw_delivery_status,paid_at,search_text,display,raw) VALUES($1,'1','TO1','C','2','1','0',now(),'to1','{"nativeProcurementCaptured":true,"procurementQueueFlags":{"pending":true},"procurementStage":"purchase_order_pending"}','{}')`,[batch])
 })
 afterAll(async()=>{await q.query('SET search_path TO public');await q.query(`DROP SCHEMA ${schema} CASCADE`);await q.release();await db.destroy()})
 it('accepts the recorded order number without a fulfillment line ID and clears legacy false positives',async()=>{
  const raw={billstatus:'C',hzkj_cancelstatus:'A',hzkj_pay_status:'0',hzkj_billentry:[{id:'p1',hzkj_salbillnumber:'TO1',hzkj_salbillid:'legacy'}]}
  const display={association:{state:'partial'},rows:[{orderId:'1',associationState:'verified',lines:[{purchaseLineId:'p1',fulfillmentLineId:null}]}]}
  await q.query(`INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'purchase','p','',$2,$3,now())`,[batch,JSON.stringify(display),JSON.stringify(raw)])
  const read=async()=>(await q.query(`SELECT is_exception,exception_type,exception_reason FROM hz_fop_collected_orders WHERE batch_id=$1`,[batch]))[0]
  expect((await read()).is_exception).toBe(false)
  delete (raw as any).hzkj_pay_status
  await q.query(`UPDATE hz_fop_collected_entities SET raw=$2 WHERE batch_id=$1 AND entity_type='purchase'`,[batch,JSON.stringify(raw)])
  expect(await read()).toMatchObject({exception_type:'procurement_exception',exception_reason:'采购付款信息不完整'})
  raw.hzkj_pay_status='0';raw.hzkj_billentry[0].hzkj_salbillnumber=''
  await q.query(`UPDATE hz_fop_collected_entities SET raw=$2 WHERE batch_id=$1 AND entity_type='purchase'`,[batch,JSON.stringify(raw)])
  expect((await read()).exception_reason).toBe('采购关联未核实')
  raw.hzkj_billentry[0].hzkj_salbillnumber='TO1'
  await q.query(`UPDATE hz_fop_collected_entities SET raw=$2 WHERE batch_id=$1 AND entity_type='purchase'`,[batch,JSON.stringify(raw)])
  expect((await read()).is_exception).toBe(false)
 })
})
