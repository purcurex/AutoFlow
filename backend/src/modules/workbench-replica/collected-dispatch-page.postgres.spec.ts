import { withOrderBusinessStatus } from '../fop-data/order-business-status'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DataSource } from 'typeorm'
import { ConfigService } from '@nestjs/config'
import { CollectedWorkbenchService } from './collected-workbench.service'

const database = process.env.DISPATCH_PAGE_TEST_DB
const integration = database?.startsWith('hz_ddl_validation_') ? describe : describe.skip
integration('fulfilled page: one membership evaluation in PostgreSQL', () => {
 let db: DataSource
 beforeAll(async () => {
  db = await new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,
   password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim(),synchronize:false}).initialize()
 })
 afterAll(async () => { await db?.destroy() })
 const paid = new Date(Date.now()-86400000).toISOString()
 const capture = new Date(Date.now()-2*86400000).toISOString()
 const order=(id:string,country='US',patch:Record<string,any>={})=>({batch_id:'batch',source_id:id,order_number:'TO-'+id,owner_employee_id:'owner',raw_bill_status:'C',raw_order_status:'4',raw_payment_status:'1',raw_delivery_status:'2',paid_at:paid,country_code:country,warehouse_code:'HZ',total_quantity:'2',search_text:('TO-'+id).toLowerCase(),
  display:{id,orderNumber:'TO-'+id,reviewStatus:'approved',items:[],dispatchDocuments:[{deliveryStatus:'FULFILLED',trackingNumbers:[{type:'full',number:'TRACK-'+id}]}]},
  raw:{id,billno:'TO-'+id,hzkj_orderstatus:'4',hzkj_logistics_info:[{hzkj_tracking_number:'TRACK-'+id}]},...patch})
 async function run(query:Record<string,any>={},employees:string[]=['owner']) {
  const valid=[order('01'),order('02','GB',{total_quantity:'3'}),order('03','US',{total_quantity:null})]
  // Matching supplemental packages override raw; another company's capture must not do so.
  valid[0].raw.hzkj_logistics_info=[]
  Object.assign(valid[0].display,{moneyCapture:{sourceId:'01',orderNumber:'TO-01',companyId:'company',operation:'order-detail',values:{hzkj_logistics_info:[{hzkj_tracking_number:'SUPPLEMENT-01'}]}}})
  const missing=order('missing');missing.raw.hzkj_logistics_info=[]
  Object.assign(missing.display,{moneyCapture:{sourceId:'missing',orderNumber:'TO-missing',companyId:'another-company',operation:'order-list',values:{hzkj_logistics_info:[{hzkj_tracking_number:'UNTRUSTED'}]}}})
  const failed=order('failed');failed.display.dispatchDocuments[0].deliveryStatus='SYNC_FAILED'
  const obtained=order('obtained');obtained.display.dispatchDocuments[0]={deliveryStatus:'TRACKING_OBTAINED',trackingNumbers:[]}
  const fixtures=[...valid,missing,failed,obtained,order('foreign','US',{owner_employee_id:'other'}),order('wrong-batch','US',{batch_id:'other'}),order('old','US',{paid_at:new Date(Date.now()-100*86400000).toISOString()}),order('future','US',{paid_at:new Date(Date.now()+86400000).toISOString()})]
  for(const row of fixtures){const exception=withOrderBusinessStatus(row.display,row.raw,'company').exception;Object.assign(row,{is_exception:!!exception,exception_type:exception?.type??null,exception_reason:exception?.reason??null,exception_code:exception?.code??null})}
  const analytics=valid.map(o=>({batch_id:'batch',source_id:o.source_id,entity_type:'fulfillment',company_id:'company',document_number:o.order_number,captured_at:paid,raw:{hzkj_orderstatus:'4',hzkj_purchase_status:'3',hzkj_purchase_status_title:'已入库'},facts:{scope:{verified:true}}}))
  let reads=0
  const adapter={query:async(sql:string,params:unknown[]=[])=>{
   reads++
   const n=params.length
   const fixture=`WITH hz_fop_collected_orders AS (SELECT * FROM jsonb_to_recordset($${n+1}) o(batch_id text,source_id text,order_number text,owner_employee_id text,raw_bill_status text,raw_order_status text,raw_payment_status text,raw_delivery_status text,paid_at timestamptz,country_code text,warehouse_code text,total_quantity numeric,search_text text,display jsonb,raw jsonb,is_exception boolean,exception_type text,exception_reason text,exception_code text)),
    hz_fop_collected_entities AS (SELECT 'batch'::text batch_id,'allocation'::text entity_type,'{}'::jsonb display WHERE FALSE),
    hz_fop_collected_batches AS (SELECT 'batch'::text id,'company'::text company_id,$${n+2}::timestamptz source_as_of),
    hz_fop_collected_analytics_facts AS (SELECT * FROM jsonb_to_recordset($${n+3}) a(batch_id text,source_id text,entity_type text,company_id text,document_number text,captured_at timestamptz,raw jsonb,facts jsonb))`
   return db.query(fixture+(sql.startsWith('WITH ')?', '+sql.slice(5):' '+sql),[...params,JSON.stringify(fixtures),capture,JSON.stringify(analytics)])
  }}
  const service=new CollectedWorkbenchService(adapter as any,{} as any,new ConfigService())
  const context={user:{sessionVersion:1},filter:{employeeIds:employees},org:{members:[],departments:[],employeeIds:employees},batch:{id:'batch',company_id:'company',source_as_of:capture,metadata:{entityCaptures:{dispatch:{companyId:'company',coverage:'full_parent_scan',capturedAt:capture}}}},signature:'stable',searchOwnerIds:[]}
  jest.spyOn(service as any,'context').mockResolvedValue(context)
  const result=await service.orders('user',{queue:'dispatch',completed:true,timeRange:'1m',pageSize:2,...query},'dispatch')
  return {result,reads}
 }
 it('shares total, countries and page membership instead of rescanning large order JSON three times',async()=>{
  const {result,reads}=await run()
  expect(result.total).toBe(6)
  expect(result.items.map(o=>o.id)).toEqual(['01','02'])
  expect(result.totals.itemQuantity).toBeNull()
  expect(result.shippingCountries).toEqual(['GB','US'])
  expect(result.items[0].sourcePurchaseStatus).toBe('3')
  expect(result.items[0].sourcePurchaseStatusName).toBe('已入库')
  expect(reads).toBe(1)
 })
 it('paginates after validation and selected country while keeping full authorized country facets',async()=>{
  const {result}=await run({shippingCountryCode:'US',pageSize:1,page:2})
  expect(result.total).toBe(5);expect(result.items.map(o=>o.id)).toEqual(['03'])
  expect(result.shippingCountries).toEqual(['GB','US'])
 })
 it.each([{projection:'count'},{page:10}])('returns exact totals for empty page %j',async query=>{
  const {result,reads}=await run(query)
  expect(result.total).toBe(6);expect(result.items).toEqual([]);expect(reads).toBe(1)
 })
 it('keeps empty authorization empty for rows, totals and facets',async()=>{
  const {result}=await run({},[])
  expect(result.total).toBe(0);expect(result.items).toEqual([]);expect(result.shippingCountries).toEqual([])
 })
 it('uses the same membership for selected exports, retaining anomalous native fulfilled orders',async()=>{
  const {result}=await run({mode:'selected',orderIds:['01','missing','foreign','obtained']})
  expect(result.total).toBe(3);expect(result.items.map(o=>o.id)).toEqual(['01','missing']);expect(result.totals.itemQuantity).toBe(6)
  expect(result.items[1].exception?.type).toBe('dispatch_exception')
 })
 it('preserves search, warehouse filters and descending/ascending stable order',async()=>{
  const {result}=await run({search:'TO-02',warehouseCode:'HZ',sortOrder:'asc'})
  expect(result.total).toBe(1);expect(result.items.map(o=>o.id)).toEqual(['02']);expect(result.totals.itemQuantity).toBe(3)
 })
})
