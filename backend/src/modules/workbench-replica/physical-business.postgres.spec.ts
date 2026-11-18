import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DataSource, QueryRunner } from 'typeorm'
import { WorkbenchCollectedOrders1794411000000 } from '../../database/migrations/1794411000000-WorkbenchCollectedOrders'
import { CollectedEntities1794480000000 } from '../../database/migrations/1794480000000-CollectedEntities'
import { CollectedAnalyticsFacts1794500000000 } from '../../database/migrations/1794500000000-CollectedAnalyticsFacts'
import { PersistedExceptionState1794980000000 } from '../../database/migrations/1794980000000-PersistedExceptionState'
import { ProcurementDataExceptions1794981000000 } from '../../database/migrations/1794981000000-ProcurementDataExceptions'
import { TrustPurchaseOrderNumber1794982000000 } from '../../database/migrations/1794982000000-TrustPurchaseOrderNumber'
import { AllocationOutboundGate1794983000000 } from '../../database/migrations/1794983000000-AllocationOutboundGate'
import { collectedOutboundUnverifiedSql } from './collected-exception-classification'
import { PhysicalBusinessClassification1794986000000 } from '../../database/migrations/1794986000000-PhysicalBusinessClassification'
import { collectedAllocationPredicate } from './collected-allocation-query'

const database = process.env.EXCEPTION_PAGE_TEST_DB
const integration = database?.startsWith('hz_ddl_validation_') ? describe : describe.skip
integration('virtual completion before allocation release is not physical outbound', () => {
 let db: DataSource, q: QueryRunner, batch: string, schema: string
 beforeAll(async () => {
  db = await new DataSource({ type: 'postgres', host: '127.0.0.1', port: 55432, username: 'autoflow_demo', database,
   password: readFileSync(resolve(__dirname, '../../../../.runtime/local-demo/database-password'), 'utf8').trim() }).initialize()
  q = db.createQueryRunner(); await q.connect(); schema = 'physical_business_' + Date.now()
  await q.query(`CREATE SCHEMA ${schema}`); await q.query(`SET search_path TO ${schema},public`)
  for (const migration of [new WorkbenchCollectedOrders1794411000000(), new CollectedEntities1794480000000(),
   new CollectedAnalyticsFacts1794500000000(), new PersistedExceptionState1794980000000(),
   new ProcurementDataExceptions1794981000000(), new TrustPurchaseOrderNumber1794982000000(), new AllocationOutboundGate1794983000000(), new PhysicalBusinessClassification1794986000000()]) await migration.up(q)
 })
 afterAll(async () => { if (q) { await q.query('SET search_path TO public'); await q.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await q.release() } await db?.destroy() })
 beforeEach(async () => {
  batch = randomUUID()
  await q.query("INSERT INTO hz_fop_collected_batches(id,workspace_owner_id,tenant_id,company_id,state,source_as_of) VALUES($1,$2,'tenant','100000','active',now())", [batch, randomUUID()])
 })
 async function root(virtual = true, physicalOutbound = 'unknown') {
  const raw = { id: 'o', billno: 'TO1', hzkj_orderstatus: '4', hzkj_delivery_status: '1', hzkj_logistics_info: [{ hzkj_tracking_number: 'TRACK' }],
   hzkj_orders_billentry: [{ id: 'p', hzkj_local_sku: { number: 'PHYSICAL' } }, ...(virtual ? [{ id: 'v', hzkj_local_sku: { number: 'HZ000020-001' } }] : [])] }
  const display = { id: 'o', businessStatus: { outbound: 'unknown', lines: [{ id: 'p', excluded: false, outbound: physicalOutbound }, ...(virtual ? [{ id: 'v', excluded: true, outbound: 'not_required' }] : [])] }, exception: null }
  await q.query("INSERT INTO hz_fop_collected_orders(batch_id,source_id,order_number,owner_employee_id,raw_bill_status,raw_order_status,raw_payment_status,raw_delivery_status,paid_at,search_text,display,raw) VALUES($1,'o','TO1','owner','C','4','1','1',now(),'TO1',$2,$3)", [batch, JSON.stringify(display), JSON.stringify(raw)])
 }
 async function allocation(bill = 'B', status = 'completed', verified = 'verified', id = 'a') {
  const display = { sourceOrderId: 'o', rawBillStatus: bill, rawAllocationStatus: status, association: { state: verified } }
  await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'allocation',$2,'',$3,'{}',now()) ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET display=excluded.display", [batch, id, JSON.stringify(display)])
 }
 const read = async () => (await q.query(`SELECT is_exception,exception_type,exception_reason,exception_checked_at,exception_facts_hash,${collectedOutboundUnverifiedSql()} AS diagnostic,${collectedAllocationPredicate('allocation_review')} AS ready_queue FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id='o'`, [batch]))[0]
 it.each(['A','B','C'])('never derives a physical exception from virtual completion, allocation %s',async bill=>{
  await root();await allocation(bill)
  expect(await read()).toMatchObject({is_exception:false,diagnostic:false,ready_queue:bill!=='C'})
  await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'delivery_notice','n','','{}','{\"hzkj_platform_order_no\":\"TO1\"}',now())",[batch])
  expect((await read()).is_exception).toBe(false)
 })
 it('retains unverified partial outbound when there is no virtual item',async()=>{await root(false);expect(await read()).toMatchObject({is_exception:true,diagnostic:true})})
 it('recomputes when product identity changes, clearing and restoring only the derived flag',async()=>{
  await root(false);expect((await read()).is_exception).toBe(true)
  await q.query("UPDATE hz_fop_collected_orders SET raw=jsonb_set(raw,'{hzkj_orders_billentry,0,hzkj_local_sku,number}','\"HZ000020-001\"') WHERE batch_id=$1",[batch])
  expect((await read()).is_exception).toBe(false)
  await q.query("UPDATE hz_fop_collected_orders SET raw=jsonb_set(raw,'{hzkj_orders_billentry,0,hzkj_local_sku,number}','\"REAL\"') WHERE batch_id=$1",[batch])
  expect((await read()).is_exception).toBe(true)
 })
 it('does not let virtual-only purchase documents create payment errors',async()=>{
  await root();await allocation()
  const display={rows:[{orderId:'o',lines:[{sku:'HZ000020-001',fulfillmentLineId:'v'}]}]}
  const raw={billstatus:'C',hzkj_cancelstatus:'A',hzkj_billentry:[{hzkj_salbillnumber:'TO1'}]}
  await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'purchase','p','',$2,$3,now())",[batch,JSON.stringify(display),JSON.stringify(raw)])
  expect((await read()).is_exception).toBe(false)
  display.rows[0].lines=[{sku:'REAL',fulfillmentLineId:'p'}]
  await q.query("UPDATE hz_fop_collected_entities SET display=$2 WHERE batch_id=$1 AND source_id='p'",[batch,JSON.stringify(display)])
  expect(await read()).toMatchObject({is_exception:true,exception_type:'procurement_exception',exception_reason:'采购付款信息不完整'})
 })
 it('keeps allocation errors independent and supports rollback/forward without changing source',async()=>{
  await root();await allocation('C','error')
  expect(await read()).toMatchObject({is_exception:true,exception_type:'allocation_exception'})
  await allocation('C','completed')
  expect((await read()).is_exception).toBe(false)
  const snapshot=async()=>await q.query('SELECT raw,display FROM hz_fop_collected_orders WHERE batch_id=$1',[batch])
  const before=await snapshot(),migration=new PhysicalBusinessClassification1794986000000()
  await migration.down(q);expect((await read()).is_exception).toBe(true)
  await migration.up(q);expect((await read()).is_exception).toBe(false)
  expect(await snapshot()).toEqual(before)
 })
})
