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
import { outboundBeforeReleaseV4 } from './outbound-before-release-v4'
const collectedOutboundUnverifiedSql=()=>`(hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown' AND NOT ${outboundBeforeReleaseV4('hz_fop_collected_orders')})`
import { collectedAllocationPredicate } from './collected-allocation-query'

const database = process.env.EXCEPTION_PAGE_TEST_DB
const integration = database?.startsWith('hz_ddl_validation_') ? describe : describe.skip
integration('virtual completion before allocation release is not physical outbound', () => {
 let db: DataSource, q: QueryRunner, batch: string, schema: string
 beforeAll(async () => {
  db = await new DataSource({ type: 'postgres', host: '127.0.0.1', port: 55432, username: 'autoflow_demo', database,
   password: readFileSync(resolve(__dirname, '../../../../.runtime/local-demo/database-password'), 'utf8').trim() }).initialize()
  q = db.createQueryRunner(); await q.connect(); schema = 'allocation_outbound_' + Date.now()
  await q.query(`CREATE SCHEMA ${schema}`); await q.query(`SET search_path TO ${schema},public`)
  for (const migration of [new WorkbenchCollectedOrders1794411000000(), new CollectedEntities1794480000000(),
   new CollectedAnalyticsFacts1794500000000(), new PersistedExceptionState1794980000000(),
   new ProcurementDataExceptions1794981000000(), new TrustPurchaseOrderNumber1794982000000(), new AllocationOutboundGate1794983000000()]) await migration.up(q)
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
 it('keeps the ready task, removes only its false outbound flag, and skips unchanged data', async () => {
  await root(); await allocation()
  expect(await read()).toMatchObject({ is_exception: false, diagnostic: false, ready_queue: true })
  const before = await read(); await q.query('UPDATE hz_fop_collected_orders SET raw=raw,display=display WHERE batch_id=$1', [batch])
  expect(await read()).toEqual(before)
 })
 it('rechecks approval and reversal without altering allocation membership', async () => {
  await root(); await allocation('A', 'pending'); expect((await read()).is_exception).toBe(false)
  await allocation('C'); expect(await read()).toMatchObject({ is_exception: true, diagnostic: true, ready_queue: false })
  await allocation(); expect(await read()).toMatchObject({ is_exception: false, ready_queue: true })
 })
 it.each(['unresolved', 'multiple', 'missing'])('does not dismiss an ambiguous %s allocation relation', async mode => {
  await root()
  if (mode !== 'missing') await allocation('B', 'completed', mode === 'unresolved' ? 'unresolved' : 'verified')
  if (mode === 'multiple') await allocation('C', 'completed', 'verified', 'a2')
  expect(await read()).toMatchObject({ is_exception: true, diagnostic: true })
 })
 it.each([['no virtual', false, 'unknown'], ['physical movement', true, 'partial']])('retains %s evidence for investigation', async (_label, virtual, physical) => {
  await root(virtual as boolean, physical as string); await allocation()
  expect(await read()).toMatchObject({ is_exception: true, diagnostic: true })
 })
 it.each(['delivery_notice', 'outbound'])('rechecks on %s creation and deletion, including raw-only linkage', async type => {
  await root(); await allocation(); expect((await read()).is_exception).toBe(false)
  const raw = type === 'delivery_notice' ? { hzkj_platform_order_no: 'TO1' } : { billentry: [{ hzkj_entry_billno: 'TO1' }] }
  await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,$2,'downstream','','{}',$3,now())", [batch, type, JSON.stringify(raw)])
  expect(await read()).toMatchObject({ is_exception: true, diagnostic: true })
  await q.query('DELETE FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type=$2', [batch, type])
  expect((await read()).is_exception).toBe(false)
 })
 it('retains independent procurement errors while removing the false outbound reason', async () => {
  await root(); await allocation()
  const display = { association: { state: 'verified' }, rows: [{ orderId: 'o' }] }
  const raw = { billstatus: 'C', hzkj_cancelstatus: 'A', hzkj_billentry: [{ hzkj_salbillnumber: 'TO1' }] }
  await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'purchase','p','',$2,$3,now())", [batch, JSON.stringify(display), JSON.stringify(raw)])
  expect(await read()).toMatchObject({ is_exception: true, exception_type: 'procurement_exception', exception_reason: '采购付款信息不完整', ready_queue: true })
 })
 it('rechecks the former parent when a downstream document is relinked', async () => {
  await root(); await allocation()
  await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'delivery_notice','n','','{}','{\"hzkj_platform_order_no\":\"TO1\"}',now())", [batch])
  expect((await read()).is_exception).toBe(true)
  await q.query("UPDATE hz_fop_collected_entities SET raw='{\"hzkj_platform_order_no\":\"OTHER\"}' WHERE batch_id=$1 AND source_id='n'", [batch])
  expect((await read()).is_exception).toBe(false)
 })
 it('supports rollback and forward rebuild without changing source facts or task membership', async () => {
  await root(); await allocation()
  const source = async () => (await q.query("SELECT raw,display FROM hz_fop_collected_orders WHERE batch_id=$1", [batch]))[0]
  const before = await source(), migration = new AllocationOutboundGate1794983000000()
  await migration.down(q); expect(await read()).toMatchObject({ is_exception: true, ready_queue: true })
  await migration.up(q); expect(await read()).toMatchObject({ is_exception: false, ready_queue: true })
  expect(await source()).toEqual(before)
 })
})
