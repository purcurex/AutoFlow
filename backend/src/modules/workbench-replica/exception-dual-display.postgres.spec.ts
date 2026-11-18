import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DataSource } from 'typeorm'
import { collectedWhere } from './collected-workbench-query'
import { collectedDiagnosticDisplaySql } from './collected-exception-classification'
import { withOrderBusinessStatus } from '../fop-data/order-business-status'
const database=process.env.EXCEPTION_PAGE_TEST_DB
const integration=database?.startsWith('hz_ddl_validation_')?describe:describe.skip
integration('exceptions supplement normal queue membership',()=>{
 let db:DataSource
 beforeAll(async()=>{db=await new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim(),synchronize:false}).initialize()})
 afterAll(async()=>{await db?.destroy()})
 const row=()=>({batch_id:'batch',source_id:'one',owner_employee_id:'owner',raw_bill_status:'C',raw_order_status:'3',raw_payment_status:'1',raw_delivery_status:'1',display:{id:'one',reviewStatus:'approved',nativeShippingReady:true,businessStatus:{outbound:'unknown'},dispatchDocuments:[],items:[]},raw:{id:'one',billno:'TO-one',hzkj_orderstatus:'3',hzkj_receipt_status:'1',hzkj_delivery_status:'1'}} as any)
 async function run(o:any,query:any,employees:string[]=['owner']){
  const q=collectedWhere('batch',employees,query,'facts'),n=q.params.length
  const sql=`WITH hz_fop_collected_orders AS (SELECT * FROM jsonb_to_recordset($${n+1}) o(batch_id text,source_id text,owner_employee_id text,raw_bill_status text,raw_order_status text,raw_payment_status text,raw_delivery_status text,paid_at timestamptz,display jsonb,raw jsonb)),hz_fop_collected_entities AS (SELECT 'batch'::text batch_id,NULL::text source_id,'allocation'::text entity_type,'{}'::jsonb display,'{}'::jsonb raw WHERE FALSE),hz_fop_collected_batches AS (SELECT 'batch'::text id,'company'::text company_id) SELECT ${collectedDiagnosticDisplaySql()} AS display,raw FROM hz_fop_collected_orders WHERE ${q.where}`
  return (await db.query(sql,[...q.params,JSON.stringify([o])])).map((r:any)=>withOrderBusinessStatus(r.display,r.raw,'company'))
 }
 it('keeps native partial outbound in shipping and exceptions; recovery clears both badges and exception membership',async()=>{
  const o=row()
  expect(await run(o,{queue:'shipping'})).toHaveLength(1)
  expect((await run(o,{queue:'shipping'}))[0].exception?.type).toBe('outbound_exception')
  expect(await run(o,{queue:'exceptions',taskStatus:'outbound_exception'})).toHaveLength(1)
  expect(await run(o,{queue:'shipping'},[])).toHaveLength(0)
  o.display.businessStatus.outbound='partial'
  expect(await run(o,{queue:'shipping'})).toHaveLength(1)
  expect((await run(o,{queue:'shipping'}))[0].exception).toBeFalsy()
  expect(await run(o,{queue:'exceptions',taskStatus:'outbound_exception'})).toHaveLength(0)
 })
 it('retains sync failure in its normal dispatch phase and removes a stale derived exception after successful synchronization',async()=>{
  const o=row();o.raw_delivery_status='0';o.raw.hzkj_delivery_status='0';o.display.businessStatus={outbound:'pending'}
  o.display.dispatchDocuments=[{number:'FY-one',status:'approved',deliveryStatus:'SYNC_FAILED',trackingNumbers:[{type:'full',number:'TRACK'}]}]
  expect(await run(o,{queue:'dispatch'})).toHaveLength(1)
  expect(await run(o,{queue:'exceptions',taskStatus:'dispatch_exception'})).toHaveLength(1)
  o.display.exception={type:'dispatch_exception',reason:'Shopify跟踪号同步失败，请重新同步；成功回写后进入已履约清单。'}
  o.raw_order_status='4';o.raw.hzkj_orderstatus='4';o.raw.hzkj_logistics_info=[{hzkj_tracking_number:'TRACK'}];o.display.dispatchDocuments[0].deliveryStatus='FULFILLED'
  expect(await run(o,{queue:'dispatch',completed:true})).toHaveLength(1)
  expect((await run(o,{queue:'dispatch',completed:true}))[0].exception).toBeFalsy()
  expect(await run(o,{queue:'exceptions'})).toHaveLength(0)
 })
})
