import { ExceptionAuditRemediation1794988000000 } from '../../database/migrations/1794988000000-ExceptionAuditRemediation'
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
import { PurchasePaymentStates1794985000000 } from '../../database/migrations/1794985000000-PurchasePaymentStates'

const database = process.env.EXCEPTION_PAGE_TEST_DB
const integration = database?.startsWith('hz_ddl_validation_') ? describe : describe.skip
integration('source-backed exception audit remediation', () => {
 let db: DataSource, q: QueryRunner, batch: string, schema: string
 beforeAll(async () => {
  db = await new DataSource({ type: 'postgres', host: '127.0.0.1', port: 55432, username: 'autoflow_demo', database,
   password: readFileSync(resolve(__dirname, '../../../../.runtime/local-demo/database-password'), 'utf8').trim() }).initialize()
  q = db.createQueryRunner(); await q.connect(); schema = 'exception_remediation_' + Date.now()
  await q.query(`CREATE SCHEMA ${schema}`); await q.query(`SET search_path TO ${schema},public`)
  for (const migration of [new WorkbenchCollectedOrders1794411000000(), new CollectedEntities1794480000000(),
   new CollectedAnalyticsFacts1794500000000(), new PersistedExceptionState1794980000000(),
   new ProcurementDataExceptions1794981000000(), new TrustPurchaseOrderNumber1794982000000(), new AllocationOutboundGate1794983000000(), new PurchasePaymentStates1794985000000(), new PhysicalBusinessClassification1794986000000(),new ExceptionAuditRemediation1794988000000()]) await migration.up(q)
 })
 afterAll(async () => { if (q) { await q.query('SET search_path TO public'); await q.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await q.release() } await db?.destroy() })
 beforeEach(async () => {
  batch = randomUUID()
  await q.query("INSERT INTO hz_fop_collected_batches(id,workspace_owner_id,tenant_id,company_id,state,source_as_of) VALUES($1,$2,'tenant','100000','active',now())", [batch, randomUUID()])
 })

 async function root(patch:any={}, displayPatch:any={}) {
  const raw={id:'o',billno:'TO1',org_id:'100000',billstatus:'C',hzkj_orderstatus:'4',hzkj_receipt_status:'1',hzkj_receipt_date:'2026-11-18T00:00:00Z',hzkj_logistics_info:[{hzkj_tracking_number:'TRACK'}],timestampProjection:{entityCode:'hzkj_orders',companyId:'100000',companyBasis:'source_org_id_checked_against_timestamp_scope'},...patch}
  const display={id:'o',reviewStatus:'approved',businessStatus:{outbound:'completed'},dispatchDocuments:[],exception:null,...displayPatch}
  await q.query("INSERT INTO hz_fop_collected_orders(batch_id,source_id,order_number,raw_bill_status,raw_order_status,raw_payment_status,paid_at,search_text,display,raw) VALUES($1,'o','TO1','C',$2,$3,$4,'TO1',$5,$6) ON CONFLICT(batch_id,source_id) DO UPDATE SET raw=excluded.raw,display=excluded.display,raw_order_status=excluded.raw_order_status,raw_payment_status=excluded.raw_payment_status,paid_at=excluded.paid_at",[batch,raw.hzkj_orderstatus,raw.hzkj_receipt_status,raw.hzkj_receipt_date,JSON.stringify(display),JSON.stringify(raw)])
 }
 const read=async()=>(await q.query("SELECT is_exception,exception_type,exception_reason,exception_checked_at,exception_facts_hash FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id='o'",[batch]))[0]
 it('rebuilds missing receipt evidence from a verified incremental capture and clears only on actual recovery',async()=>{
  await root({hzkj_receipt_date:null})
  expect((await read()).exception_reason).toBe('收款日期为空')
  const before=await read();await root({hzkj_receipt_date:null});expect((await read()).exception_checked_at).toEqual(before.exception_checked_at)
  await root();expect((await read()).is_exception).toBe(false)
  await root({hzkj_receipt_date:null,timestampProjection:{entityCode:'hzkj_orders',companyId:'200000',companyBasis:'verified_timestamp_scope'}})
  expect((await read()).is_exception).toBe(false)
 })
 it('preserves every independent cause and uses native failure wording without instructing duplicate Shopify uploads',async()=>{
  await root({hzkj_logistics_info:[]},{dispatchDocuments:[{association:{state:'verified'},deliveryStatus:'SYNC_FAILED',trackingNumbers:[{type:'full',number:'TRACK'}]}]})
  const r=await read();expect(r.exception_reason).toBe('发运审核同步状态与履约状态不一致；履约订单物流跟踪号为空')
  await root({hzkj_orderstatus:'3'},{dispatchDocuments:[{association:{state:'verified'},deliveryStatus:'SYNC_FAILED',trackingNumbers:[{type:'full',number:'TRACK'}]}]})
  expect((await read()).exception_reason).toBe('发运单审核同步失败')
 })
 it('does not let an old blank capture override current package tracking or call an omitted field empty',async()=>{
  const capture={sourceId:'o',orderNumber:'TO1',companyId:'100000',operation:'order-list',values:{hzkj_logistics_info:[]}}
  await root({}, {moneyCapture:capture});expect((await read()).is_exception).toBe(false)
  await root({hzkj_logistics_info:undefined});expect((await read()).exception_reason).toBe('履约订单物流信息待核验')
 })
 it('only treats missing payment as an error after 1688 placement and keeps invalid nonempty codes',async()=>{
  await root()
  const save=async(patch:any)=>{const raw={billstatus:'C',hzkj_cancelstatus:'A',hzkj_pay_status:null,hzkj_1688_order_n:null,hzkj_billentry:[{hzkj_srcbillnumber:'TO1'}],...patch};await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'purchase','p','','{\"rows\":[{\"orderId\":\"o\",\"lines\":[{\"sku\":\"REAL\"}]}]}',$2,now()) ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET raw=excluded.raw",[batch,JSON.stringify(raw)])}
  await save({});expect((await read()).is_exception).toBe(false)
  await save({hzkj_1688_order_n:'5127891553471031616'});expect((await read()).exception_reason).toBe('采购付款状态待核验')
  await save({hzkj_pay_status:'invalid'});expect((await read()).exception_reason).toBe('采购付款状态待核验')
  await save({hzkj_pay_status:'1'});expect((await read()).is_exception).toBe(false)
 })
 it('shows source allocation causes and removes them when FOP resolves the document',async()=>{
  await root()
  const save=async(status:string,code:string)=>q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'allocation','a','',$2,$3,now()) ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET raw=excluded.raw,display=excluded.display",[batch,JSON.stringify({sourceOrderId:'o',rawAllocationStatus:status,association:{state:'verified'}}),JSON.stringify({hzkj_alloc_status:status,hzkj_error_code:code,hzkj_error_msg:'配货明细缺少有效的来源订单商品行。'})])
  await save('error','ALLOC-DATA-001');expect((await read()).exception_reason).toBe('配货明细来源商品行关联缺失')
  await save('error','ALLOC-PURCHASE-TIMEOUT');expect((await read()).exception_reason).toBe('采购入库自动配货超时')
  await save('completed','');expect((await read()).is_exception).toBe(false)
 })
 it('reports contradictory native payment facts instead of assuming an audited order is unpaid',async()=>{
  await root({hzkj_receipt_status:'0'})
  expect((await read()).exception_reason).toBe('单据审核状态与收款状态不一致')
 })
 it('keeps stock payment truth and changes only the missing date diagnostic',async()=>{
  const raw={id:'s',billno:'IO1',org_id:'100000',hzkj_orderstatus:'2',hzkj_operator_id:'8',hzkj_receipt_status:'',hzkj_receipt_date:null}
  await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,owner_employee_id,search_text,display,raw,captured_at) VALUES($1,'stock_orders','s','8','','{\"stockNumber\":\"IO1\"}','{}',now())",[batch])
  const save=async()=>q.query("INSERT INTO hz_fop_collected_analytics_facts(batch_id,entity_type,source_id,company_id,document_number,raw,facts,captured_at) VALUES($1,'stock','s','100000','IO1',$2,'{}',now()) ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET raw=excluded.raw",[batch,JSON.stringify(raw)])
  const readStock=async()=>(await q.query("SELECT exception_reason,is_exception FROM hz_fop_collected_entities WHERE batch_id=$1 AND source_id='s'",[batch]))[0]
  await save();expect((await readStock()).exception_reason).toBe('备货收款日期待补齐')
  raw.hzkj_receipt_status='1';await save();expect((await readStock()).exception_reason).toBe('备货收款日期待补齐')
  ;(raw as any).hzkj_receipt_date='2026-11-18T00:00:00Z';raw.hzkj_receipt_status='';await save();expect((await readStock()).is_exception).toBe(false)
 })
 it('keeps virtual facts excluded and supports a reversible projection-only upgrade',async()=>{
  await root({hzkj_delivery_status:'1',hzkj_orders_billentry:[{id:'v',hzkj_local_sku:{number:'HZ000020-001'}}]}, {businessStatus:{outbound:'unknown',lines:[{id:'v',excluded:true}]}})
  expect((await read()).is_exception).toBe(false)
  await root({hzkj_receipt_date:null})
  const snap=async()=>await q.query('SELECT raw,display FROM hz_fop_collected_orders WHERE batch_id=$1',[batch]);const before=await snap()
  const m=new ExceptionAuditRemediation1794988000000();await m.down(q);expect((await read()).is_exception).toBe(false)
  await m.up(q);expect((await read()).exception_reason).toBe('收款日期为空');expect(await snap()).toEqual(before)
 })

})
