import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DataSource } from 'typeorm'
import { collectedInboundPage } from './collected-inbound-query'
const database=process.env.INBOUND_QUERY_TEST_DB
const integration=(database?.startsWith('hz_timestamp_test_')||database?.startsWith('hz_ddl_validation_'))?describe:describe.skip
integration('native fulfillment pending inbound in PostgreSQL',()=>{
 let db:DataSource
 beforeAll(async()=>{db=new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim(),synchronize:false});await db.initialize()})
 afterAll(async()=>{if(db?.isInitialized)await db.destroy()})
 const line=(id:string,state='4',purchase='10',received='0',extra={})=>({id,hzkj_entrypurc_status:state,hzkj_purcqty:purchase,hzkj_qty:purchase,hzkj_instock_qty:received,hzkj_local_sku:{number:'SKU'+id},...extra})
 async function result(lines:any[],patch={},query={},employees=['employee']){
  const q=collectedInboundPage('batch',employees,query,1,100)
  const order={batch_id:'batch',source_id:'10',owner_employee_id:'employee',warehouse_code:'01',search_text:'to10 sku1',raw:{hzkj_purchase_status:'4',hzkj_orderstatus:'3',hzkj_orders_billentry:lines,...patch},display:{},paid_at:null,is_exception:false,exception_type:null,exception_reason:null,exception_code:null}
  const slot=q.params.length+1
  const cte=`WITH hz_fop_collected_orders AS(SELECT * FROM jsonb_to_recordset($${slot}::jsonb) AS r(batch_id text,source_id text,owner_employee_id text,warehouse_code text,search_text text,raw jsonb,display jsonb,paid_at timestamptz,is_exception boolean,exception_type text,exception_reason text,exception_code text)),hz_fop_collected_entities AS(SELECT NULL::text batch_id,NULL::text source_id,NULL::text entity_type,NULL::jsonb display,NULL::jsonb raw WHERE false),${q.sql.replace(/^WITH\s*/,'')}`
  return (await db.query(cte,[...q.params,JSON.stringify([order])]))[0].rows.map((r:any)=>({...r,source_id:r.order_id}))
 }
 it('shows shipped orders without requiring a receipt/purchase cross-document link',async()=>{expect(await result([line('1')])).toMatchObject([{source_id:'10',status:'pending',quantity:10,inbound_quantity:0,pending_quantity:10}])})
 it('includes a native partially shipped order with partial receipt',async()=>{expect(await result([line('1','4','10','2')],{hzkj_purchase_status:'native-partial',hzkj_purchase_status_title:'部分发货'})).toMatchObject([{status:'partial',pending_quantity:8}])})
 it('recognizes partial shipment only from a physical shipped entry within procurement-in-progress',async()=>{
  expect(await result([line('1','4','1','0'),line('2','1','2','0')],{hzkj_purchase_status:'1',hzkj_purchase_status_title:'采购中'})).toMatchObject([{status:'pending',quantity:3}])
  expect(await result([line('1','1','3','0')],{hzkj_purchase_status:'1'})).toEqual([])
  expect(await result([line('1','4','1','0',{hzkj_local_sku:{number:'HZ000020-001'}}),line('2','1','2','0')],{hzkj_purchase_status:'1'})).toEqual([])
 })
 it('ignores virtual shipment regardless of header and ignores virtual child pid',async()=>{
  expect(await result([line('1','0','2','0'),line('2','4','999','999',{hzkj_local_sku:{number:'HZ000020-001'}})],{hzkj_purchase_status:'4'})).toEqual([])
  expect(await result([line('1','4','2','0'),line('2','3','999','999',{pid:'1',hzkj_local_sku:{number:'HZ000020-001'}})],{hzkj_purchase_status:'3'})).toMatchObject([{status:'pending',quantity:2}])
 })
 it('retains received/unreceived items together and excludes fully received orders',async()=>{expect(await result([line('1','3','2','2'),line('2','4','3','0')])).toMatchObject([{status:'partial',quantity:5,pending_quantity:3}]);expect(await result([line('1','3','2','2')])).toEqual([])})
 it('preserves explicit zero purchase facts in displayed lines without counting them as pending',async()=>{const [r]=await result([line('1','4','2','0'),line('2','0','0','0')]);expect(r.quantity).toBe(2);expect(r.inbound_lines.find((l:any)=>l.id==='2')).toMatchObject({purchaseQuantity:0,inboundQuantity:0,pendingQuantity:0})})
 it('uses SKU demand even when the purchased amount is higher',async()=>{expect(await result([line('1','3','8','3',{hzkj_qty:'3'})])).toEqual([]);expect(await result([line('1','4','8','2',{hzkj_qty:'3'})])).toMatchObject([{status:'partial',quantity:3,pending_quantity:1}])})
 it('does not cancel out shortages against another SKU excess',async()=>{expect(await result([line('1','3','5','7'),line('2','4','5','3')])).toMatchObject([{status:'partial',pending_quantity:2}])})
 it('completes at or above each physical SKU demand despite a lagging line state',async()=>{for(const received of ['5','7']){expect(await result([line('1','4','5',received)])).toEqual([]);expect(await result([line('1','3','5',received)],{},{status:'completed'})).toMatchObject([{status:'completed',pending_quantity:0}])}})
 it('excludes virtual and combination-parent rows from physical quantities',async()=>{expect(await result([line('1','4','10','0',{hzkj_local_sku:{number:'HZ000020-001'}}),line('2','4','20','0'),line('3','4','3','0',{pid:'2'})])).toMatchObject([{quantity:3,pending_quantity:3}])})
 it('does not invent zero for missing, null or invalid receipt quantities',async()=>{for(const value of [undefined,null,'','bad','-1'])expect(await result([line('1','4','10','0',{hzkj_instock_qty:value})])).toEqual([])})
 it('excludes unshipped, foreign-owner and zero-purchase records',async()=>{expect(await result([line('1','2')],{hzkj_purchase_status:'4'})).toEqual([]);expect(await result([line('1')],{}, {},['foreign'])).toEqual([]);expect(await result([line('1','4','0','0')])).toEqual([])})
 it('keeps status, warehouse and escaped keyword filters inside the same owner scope',async()=>{expect(await result([line('1')],{}, {status:'partial'})).toEqual([]);expect(await result([line('1')],{}, {warehouseCode:'SZ'})).toEqual([]);expect(await result([line('1')],{}, {search:'SKU_1'})).toEqual([]);expect(await result([line('1')],{}, {warehouseCode:'HZ',search:'TO10'})).toHaveLength(1)})
 async function pageResult(orders:any[],entities:any[]=[],query={},page=1,size=1){
  const q=collectedInboundPage('batch',['employee'],query,page,size),slot=q.params.length+1
  const normalized=orders.map(o=>({batch_id:'batch',owner_employee_id:'employee',warehouse_code:'01',search_text:'order',paid_at:'2026-11-01T00:00:00Z',display:{},...o}))
  const sql=`WITH hz_fop_collected_orders AS(SELECT * FROM jsonb_to_recordset($${slot}::jsonb) AS r(batch_id text,source_id text,owner_employee_id text,warehouse_code text,search_text text,raw jsonb,display jsonb,paid_at timestamptz,is_exception boolean,exception_type text,exception_reason text,exception_code text)),hz_fop_collected_entities AS(SELECT * FROM jsonb_to_recordset($${slot+1}::jsonb) AS r(batch_id text,source_id text,entity_type text,display jsonb,raw jsonb)),${q.sql.replace(/^WITH\s*/,'')}`
  return (await db.query(sql,[...q.params,JSON.stringify(normalized),JSON.stringify(entities)]))[0]
 }
 it('paginates a scoped stable ordering while totals and quality cover the whole filter',async()=>{
  const order=(id:string,lines:any[],patch={})=>({source_id:id,raw:{hzkj_orders_billentry:lines},...patch})
  const orders=[order('2',[line('1')]),order('1',[line('1')]),order('3',[line('1','4','3','1')]),order('4',[line('1','4','2','bad')]),order('5',[line('1')],{owner_employee_id:'foreign'}),order('6',[line('1')],{warehouse_code:'HNDGLB'})]
  const first=await pageResult(orders,[],{warehouseCode:'HZ'}),second=await pageResult(orders,[],{warehouseCode:'HZ'},2)
  expect(first.counts).toEqual({total:3,quantity:23,inbound_quantity:1,pending_quantity:22})
  expect(first.unclassified).toBe(1);expect(first.rows.map((r:any)=>r.order_id)).toEqual(['1'])
  expect(second.counts).toEqual(first.counts);expect(second.rows.map((r:any)=>r.order_id)).toEqual(['2'])
  const empty=await pageResult(orders,[],{warehouseCode:'HZ'},100)
  expect(empty.rows).toEqual([]);expect(empty.counts).toEqual(first.counts)
 })
 it('uses matching same-batch product identity and never uses a foreign order child to suppress a line',async()=>{
  const orders=[{source_id:'1',raw:{hzkj_orders_billentry:[line('parent','4','2','0'),line('virtual','4','999','0',{pid:'parent',hzkj_local_sku:{id:'v',number:'VIRTUAL'}})]}},{source_id:'2',raw:{hzkj_orders_billentry:[line('child','4','3','0',{pid:'parent'})]}}]
  const products=[{batch_id:'batch',entity_type:'product',source_id:'v',raw:{number:'VIRTUAL',hzkj_good:{hzkj_good_carrier:'2'}}}]
  const page=await pageResult(orders,products,{},1,10)
  expect(page.counts.quantity).toBe(5);expect(page.rows[0].inbound_lines).toHaveLength(1)
  const wrongBatch=await pageResult(orders,[{...products[0],batch_id:'other'}],{},1,10)
  expect(wrongBatch.counts.quantity).toBe(1002)
  const wrongSku=await pageResult(orders,[{...products[0],raw:{number:'OTHER',hzkj_good:{hzkj_good_carrier:'2'}}}],{},1,10)
  expect(wrongSku.counts.quantity).toBe(1002)
 })
 it('loads only current-page verified noncancelled receipt links without making them an admission condition',async()=>{
  const orders=['1','2'].map(source_id=>({source_id,raw:{hzkj_orders_billentry:[line('1')]}}))
  const receipt=(id:string,orderId:string,patch={})=>({batch_id:'batch',entity_type:'receipt_notice',source_id:id,raw:{hzkj_waybill_number:'TRACK'},display:{number:id,association:{state:'verified'},rawCancelStatus:'A',lines:[{sourceOrderId:orderId},{sourceOrderId:orderId}],...patch}})
  const page=await pageResult(orders,[receipt('RN1','1'),receipt('RN2','2'),receipt('CANCELLED','1',{rawCancelStatus:'B'}),receipt('CONFLICT','1',{association:{state:'conflict'}})])
  expect(page.counts.total).toBe(2);expect(page.rows[0].notices.map((n:any)=>n.number)).toEqual(['RN1'])
  const without=await pageResult(orders)
  expect(without.counts).toEqual(page.counts);expect(without.rows[0].notices).toEqual([])
 })

})
