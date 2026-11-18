import { ProcurementDataExceptions1794981000000 } from '../../database/migrations/1794981000000-ProcurementDataExceptions'
import { TrustPurchaseOrderNumber1794982000000 } from '../../database/migrations/1794982000000-TrustPurchaseOrderNumber'
import { AllocationOutboundGate1794983000000 } from '../../database/migrations/1794983000000-AllocationOutboundGate'
import { PurchasePaymentStates1794985000000 } from '../../database/migrations/1794985000000-PurchasePaymentStates'
import { PhysicalBusinessClassification1794986000000 } from '../../database/migrations/1794986000000-PhysicalBusinessClassification'
import { ExceptionCommitProbe1794987000000 } from '../../database/migrations/1794987000000-ExceptionCommitProbe'
import { ExceptionReceiptDateQuality1794989000000 } from '../../database/migrations/1794989000000-ExceptionReceiptDateQuality'
import { ExceptionAuditRemediation1794988000000 } from '../../database/migrations/1794988000000-ExceptionAuditRemediation'
import { PersistedExceptionState1794980000000 } from '../../database/migrations/1794980000000-PersistedExceptionState'
import { DataSource } from 'typeorm'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { chainSourceSignature } from './collected-chain-storage'
import { TimestampPostgresStore } from './timestamp-postgres'
import { TimestampPagedSync } from './timestamp-paged-sync'
import { AddWorkbenchSchemeA1794393001000 } from '../../database/migrations/1794393001000-AddWorkbenchSchemeA'
import { TimestampQueryReplica1794770000000 } from '../../database/migrations/1794770000000-TimestampQueryReplica'
import { WorkbenchCollectedOrders1794411000000 } from '../../database/migrations/1794411000000-WorkbenchCollectedOrders'
import { CollectedEntities1794480000000 } from '../../database/migrations/1794480000000-CollectedEntities'
import { CollectedAnalyticsFacts1794500000000 } from '../../database/migrations/1794500000000-CollectedAnalyticsFacts'
import { CollectedBusinessChain1794580000000 } from '../../database/migrations/1794580000000-CollectedBusinessChain'
import { collectedAllocationPredicate } from './collected-allocation-query'
// This suite owns its full migration chain; do not share a partial-schema database with other publisher suites.
const database=process.env.EXCEPTION_AUDIT_TIMESTAMP_TEST_DB
const integration=database&&/^hz_timestamp_test_\d+$/.test(database)?describe:describe.skip
integration('exception audit incremental publication',()=>{
 let db:DataSource,scope:any,tick=0
 const order=(id:string,owner='7')=>({id,billno:'SO'+id,hzkj_operator_id:owner,hzkj_customer_id:'8',billstatus:'C',hzkj_orders_billentry:[]})
 const dispatch=(id:string,root='1')=>({id,billno:'D'+id,org_id:'100000',hzkj_order_no:'SO'+root,hzkj_customer_id:'8',billstatus:'C',hzkj_logistics_orderno:'TRACK'+id,hzkj_logisticstrackentry:[]})
 const purchase=(root='1')=>({id:'80',billno:'P80',org_id:'100000',billstatus:'C',hzkj_cancelstatus:'A',hzkj_pay_status:'0',hzkj_purchase_channel:'2',hzkj_billentry:[{id:'81',hzkj_salbillnumber:'SO'+root,hzkj_qty:'2'}]})
 async function capture(entity:string,raws:any[]){const s={...scope,entityCode:entity};const prior=await db.query('SELECT 1 FROM hz_fop_timestamp_state WHERE batch_id=$1 AND entity_code=$2',[scope.batchId,entity]);return new TimestampPagedSync(new TimestampPostgresStore(db),{assertReady:()=>{},page:async()=>({scope:s,rows:raws.map(raw=>({id:raw.id,companyId:'100000',createdAt:'2026-11-15T00:00:00Z',modifiedAt:'2026-11-15T00:01:00Z',raw})),totalCount:raws.length,lastPage:true})},()=> new Date(Date.parse('2026-11-15T00:06:00Z')+(++tick)*1000).toISOString()).run(s,prior.length?'reconcile':'initialize')}
 const rows=(table:string)=>db.query('SELECT * FROM '+table+' WHERE batch_id=$1',[scope.batchId])
 beforeAll(async()=>{
  db=await new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim(),synchronize:false}).initialize()
  const [{ready}]=await db.query("SELECT to_regclass('hz_fop_timestamp_state') IS NOT NULL AS ready")
  const [{projected}]=await db.query("SELECT to_regclass('hz_fop_exception_versions') IS NOT NULL AS projected")
  const q=db.createQueryRunner()
  try {
   if(!ready){
    await q.query('CREATE TABLE public.users(id uuid PRIMARY KEY)')
    for(const M of [AddWorkbenchSchemeA1794393001000,WorkbenchCollectedOrders1794411000000,CollectedEntities1794480000000,CollectedAnalyticsFacts1794500000000,CollectedBusinessChain1794580000000,TimestampQueryReplica1794770000000])await new M().up(q)
   }
   await q.startTransaction()
   if(!projected){
    await new PersistedExceptionState1794980000000().up(q)
    for(const M of [ProcurementDataExceptions1794981000000,TrustPurchaseOrderNumber1794982000000,AllocationOutboundGate1794983000000,PurchasePaymentStates1794985000000,PhysicalBusinessClassification1794986000000,ExceptionCommitProbe1794987000000,ExceptionAuditRemediation1794988000000])await new M().up(q)
   }
   const [{v7}]=await q.query("SELECT to_regprocedure('hz_exception_evaluate_order_v7(uuid,text,boolean)') IS NOT NULL AS v7")
   if(!v7)await new ExceptionReceiptDateQuality1794989000000().up(q)
   await q.commitTransaction()
  }finally{if(q.isTransactionActive)await q.rollbackTransaction();await q.release()}
 })
 afterAll(async()=>{await db?.destroy()})
 beforeEach(async()=>{scope={batchId:randomUUID(),tenantId:'tenant',companyId:'100000',entityCode:'hzkj_orders'};const owner=randomUUID();await db.query('INSERT INTO users(id) VALUES($1)',[owner]);await db.query("INSERT INTO hz_fop_collected_batches(id,workspace_owner_id,tenant_id,company_id,state,source_as_of) VALUES($1,$2,'tenant','100000','active',now())",[scope.batchId,owner])})

 it('survives real publisher replacement, restores on null, and clears when the source date is filled',async()=>{
  const header={...order('1'),hzkj_orderstatus:'2',hzkj_receipt_status:'1',hzkj_receipt_date:null}
  await capture('hzkj_orders',[header]);const [first]=await rows('hz_fop_collected_orders')
  expect(first.exception_reason).toBe('收款日期为空')
  expect(first.display.paymentDataCheck).toBeUndefined()
  await capture('hzkj_orders',[{...header,hzkj_source_number:'#CHANGED'}]);const [next]=await rows('hz_fop_collected_orders')
  expect(next.exception_reason).toBe('收款日期为空')
  await capture('hzkj_orders',[{...header,hzkj_receipt_date:'2026-11-15 08:00:00'}]);expect((await rows('hz_fop_collected_orders'))[0].is_exception).toBe(false)
  await capture('hzkj_orders',[header]);expect((await rows('hz_fop_collected_orders'))[0].exception_reason).toBe('收款日期为空')
  const [stable]=await rows('hz_fop_collected_orders');await capture('hzkj_orders',[header]);expect((await rows('hz_fop_collected_orders'))[0].exception_checked_at).toEqual(stable.exception_checked_at)
 })

 const paidOrder=(id='1')=>({...order(id),hzkj_orderstatus:'3',hzkj_receipt_status:'1',hzkj_receipt_date:'2026-11-15 08:00:00',hzkj_delivery_status:'0',hzkj_logistics_info:[{hzkj_tracking_number:'TRACK'}]})
 const mark=async(id='1')=>(await rows('hz_fop_collected_orders')).find((r:any)=>r.source_id===id)
 const allocation=(root='1')=>({id:'20',billno:'AO20',org_id:'100000',hzkj_order_id:root,hzkj_order_no:'SO'+root,billstatus:'B',hzkj_alloc_status:'error',hzkj_error_code:'ALLOC-PURCHASE-TIMEOUT',hzkj_error_msg:'自动配货超时',hzkj_alloc_entry:[]})
 it('keeps independent causes through unrelated edits and clears them one by one on actual recovery',async()=>{
  const raw={...paidOrder(),hzkj_orderstatus:'4',hzkj_receipt_date:null,hzkj_logistics_info:[] as any[]}
  await capture('hzkj_orders',[raw]);await capture('hzkj_deliver_bill',[{...dispatch('10'),hzkj_delivery_status:'SYNC_FAILED'}])
  expect((await mark()).exception_reason).toBe('收款日期为空；发运审核同步状态与履约状态不一致；履约订单物流跟踪号为空')
  await capture('hzkj_orders',[{...raw,hzkj_source_number:'#UNCHANGED-BUSINESS'}])
  expect((await mark()).exception_reason).toBe('收款日期为空；发运审核同步状态与履约状态不一致；履约订单物流跟踪号为空')
  await capture('hzkj_orders',[{...raw,hzkj_receipt_date:'2026-11-15 08:00:00'}])
  expect((await mark()).exception_reason).toBe('发运审核同步状态与履约状态不一致；履约订单物流跟踪号为空')
  await capture('hzkj_deliver_bill',[{...dispatch('10'),hzkj_delivery_status:'TRACKING_OBTAINED'}])
  expect((await mark()).exception_reason).toBe('履约订单物流跟踪号为空')
  await capture('hzkj_orders',[{...raw,hzkj_receipt_date:'2026-11-15 08:00:00',hzkj_logistics_info:[{hzkj_tracking_number:'CURRENT'}]}])
  expect((await mark()).is_exception).toBe(false)
 })
 it('moves a source allocation error to its new root and clears it when allocation succeeds',async()=>{
  await capture('hzkj_orders',[paidOrder('1'),paidOrder('2')]);await capture('hzkj_alloc_bill',[allocation()])
  expect((await mark('1')).exception_reason).toBe('采购入库自动配货超时');expect((await mark('2')).is_exception).toBe(false)
  await capture('hzkj_alloc_bill',[allocation('2')])
  expect((await mark('1')).is_exception).toBe(false);expect((await mark('2')).exception_reason).toBe('采购入库自动配货超时')
  await capture('hzkj_alloc_bill',[{...allocation('2'),hzkj_alloc_status:'completed',hzkj_error_code:'',hzkj_error_msg:''}])
  expect((await mark('2')).is_exception).toBe(false)
 })
 it('removes old-root dispatch marks and does not reuse cancelled or detached dispatch failures',async()=>{
  await capture('hzkj_orders',[paidOrder('1'),paidOrder('2')]);await capture('hzkj_deliver_bill',[{...dispatch('10'),hzkj_delivery_status:'SYNC_FAILED'}])
  expect((await mark('1')).exception_reason).toBe('发运单审核同步失败')
  await capture('hzkj_deliver_bill',[{...dispatch('10','2'),hzkj_delivery_status:'SYNC_FAILED'}])
  expect((await mark('1')).is_exception).toBe(false);expect((await mark('2')).exception_reason).toBe('发运单审核同步失败')
  await capture('hzkj_deliver_bill',[{...dispatch('10','2'),hzkj_delivery_status:'SYNC_FAILED',hzkj_ship_block_state:'CANCELLED'}])
  expect((await mark('2')).is_exception).toBe(false)
  await capture('hzkj_deliver_bill',[{...dispatch('10','2'),hzkj_delivery_status:'SYNC_FAILED'}])
  await capture('hzkj_deliver_bill',[{...dispatch('10'),hzkj_order_no:null,hzkj_delivery_status:'SYNC_FAILED'}])
  expect((await mark('1')).is_exception).toBe(false);expect((await mark('2')).is_exception).toBe(false)
 })
 it('ignores virtual line status churn and moves ready allocations by their own approval only',async()=>{
  const real={id:'11',hzkj_local_sku:{id:'31',number:'REAL'},hzkj_qty:'1',hzkj_entrypurc_status:'0',hzkj_outbound_qty:'0',hzkj_outbound_status:'0'}
  const virtual={id:'12',hzkj_local_sku:{id:'32',number:'HZ000020-001'},hzkj_qty:'1',hzkj_entrypurc_status:'3',hzkj_outbound_qty:'1',hzkj_outbound_status:'1'}
  const raw={...paidOrder(),hzkj_delivery_status:'1',hzkj_orders_billentry:[real,virtual]}
  const queues=async()=> (await db.query(`SELECT ${collectedAllocationPredicate('allocation_review')} AS ready,${collectedAllocationPredicate('allocation',true)} AS complete FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id='1'`,[scope.batchId]))[0]
  await capture('hzkj_orders',[raw]);await capture('hzkj_alloc_bill',[{...allocation(),hzkj_alloc_status:'completed',hzkj_error_code:'',hzkj_error_msg:''}])
  expect((await mark()).is_exception).toBe(false);expect((await mark()).display.businessStatus).toMatchObject({purchase:'unpurchased',outbound:'pending'})
  expect(await queues()).toMatchObject({ready:true,complete:false})
  await capture('hzkj_orders',[{...raw,hzkj_orders_billentry:[real,{...virtual,hzkj_entrypurc_status:null,hzkj_outbound_qty:null,hzkj_outbound_status:null}]}])
  expect((await mark()).is_exception).toBe(false);expect((await mark()).display.businessStatus).toMatchObject({purchase:'unpurchased',outbound:'pending'})
  await capture('hzkj_alloc_bill',[{...allocation(),billstatus:'C',hzkj_alloc_status:'completed',hzkj_error_code:'',hzkj_error_msg:''}])
  expect((await mark()).is_exception).toBe(false);expect(await queues()).toMatchObject({ready:false,complete:true})
 })
 it('marks a real receipt-state contradiction and clears only that cause after source correction',async()=>{
  const raw={...paidOrder(),hzkj_receipt_status:'0'}
  await capture('hzkj_orders',[raw]);expect((await mark()).exception_reason).toBe('单据审核状态与收款状态不一致')
  await capture('hzkj_alloc_bill',[allocation()]);expect((await mark()).exception_reason).toBe('采购入库自动配货超时；单据审核状态与收款状态不一致')
  await capture('hzkj_orders',[paidOrder()]);expect((await mark()).exception_reason).toBe('采购入库自动配货超时')
 })
 it('distinguishes malformed receipt dates from genuinely empty dates and recovers without sticky flags',async()=>{
  await capture('hzkj_orders',[{...paidOrder(),hzkj_receipt_date:'2026-02-30 08:00:00'}])
  expect((await mark()).exception_reason).toBe('收款日期格式待核验')
  const original=await mark(), q=db.createQueryRunner()
  try {
   await q.startTransaction()
   const migration=new ExceptionReceiptDateQuality1794989000000()
   await migration.down(q)
   expect((await q.query('SELECT exception_reason FROM hz_fop_collected_orders WHERE batch_id=$1',[scope.batchId]))[0].exception_reason).toBe('收款日期为空')
   await migration.up(q)
   const [rebuilt]=await q.query('SELECT * FROM hz_fop_collected_orders WHERE batch_id=$1',[scope.batchId])
   expect(rebuilt).toMatchObject({raw:original.raw,display:original.display,exception_reason:'收款日期格式待核验',exception_rule_version:7})
   await q.commitTransaction()
  }finally{if(q.isTransactionActive)await q.rollbackTransaction();await q.release()}
  await capture('hzkj_orders',[{...paidOrder(),hzkj_receipt_date:null}])
  expect((await mark()).exception_reason).toBe('收款日期为空')
  await capture('hzkj_orders',[paidOrder()]);expect((await mark()).is_exception).toBe(false)
 })
})
