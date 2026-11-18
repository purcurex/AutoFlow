import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DataSource } from 'typeorm'
import { collectedInboundQuery } from './collected-inbound-query'
const database=process.env.INBOUND_QUERY_TEST_DB
const integration=(database?.startsWith('hz_timestamp_test_')||database?.startsWith('hz_ddl_validation_'))?describe:describe.skip
integration('native fulfillment pending inbound in PostgreSQL',()=>{
 let db:DataSource
 beforeAll(async()=>{db=new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim(),synchronize:false});await db.initialize()})
 afterAll(async()=>{if(db?.isInitialized)await db.destroy()})
 const line=(id:string,state='4',purchase='10',received='0',extra={})=>({id,hzkj_entrypurc_status:state,hzkj_purcqty:purchase,hzkj_instock_qty:received,hzkj_local_sku:{number:'SKU'+id},...extra})
 async function result(lines:any[],patch={},query={},employees=['employee']){
  const q=collectedInboundQuery('batch',employees,query)
  const order={batch_id:'batch',source_id:'10',owner_employee_id:'employee',warehouse_code:'01',search_text:'to10 sku1',raw:{hzkj_purchase_status:'4',hzkj_orderstatus:'3',hzkj_orders_billentry:lines,...patch},display:{}}
  const slot=q.params.length+1
  const cte=`WITH hz_fop_collected_orders AS(SELECT * FROM jsonb_to_recordset($${slot}::jsonb) AS r(batch_id text,source_id text,owner_employee_id text,warehouse_code text,search_text text,raw jsonb,display jsonb)),hz_fop_collected_entities AS(SELECT NULL::text batch_id,NULL::text source_id,NULL::text entity_type,NULL::jsonb display,NULL::jsonb raw WHERE false),${q.cte.replace(/^WITH\s*/,'')}`
  return db.query(`${cte} SELECT o.source_id,n.* ${q.from}`,[...q.params,JSON.stringify([order])])
 }
 it('shows shipped orders without requiring a receipt/purchase cross-document link',async()=>{expect(await result([line('1')])).toMatchObject([{source_id:'10',status:'pending',quantity:'10',inbound_quantity:'0',pending_quantity:'10'}])})
 it('includes a native partially shipped order with partial receipt',async()=>{expect(await result([line('1','4','10','2')],{hzkj_purchase_status:'native-partial',hzkj_purchase_status_title:'部分发货'})).toMatchObject([{status:'partial',pending_quantity:'8'}])})
 it('recognizes partial shipment only from a physical shipped entry within procurement-in-progress',async()=>{
  expect(await result([line('1','4','1','0'),line('2','1','2','0')],{hzkj_purchase_status:'1',hzkj_purchase_status_title:'采购中'})).toMatchObject([{status:'pending',quantity:'3'}])
  expect(await result([line('1','1','3','0')],{hzkj_purchase_status:'1'})).toEqual([])
  expect(await result([line('1','4','1','0',{hzkj_local_sku:{number:'HZ000020-001'}}),line('2','1','2','0')],{hzkj_purchase_status:'1'})).toEqual([])
 })
 it('ignores virtual shipment regardless of header and ignores virtual child pid',async()=>{
  expect(await result([line('1','0','2','0'),line('2','4','999','999',{hzkj_local_sku:{number:'HZ000020-001'}})],{hzkj_purchase_status:'4'})).toEqual([])
  expect(await result([line('1','4','2','0'),line('2','3','999','999',{pid:'1',hzkj_local_sku:{number:'HZ000020-001'}})],{hzkj_purchase_status:'3'})).toMatchObject([{status:'pending',quantity:'2'}])
 })
 it('retains received/unreceived items together and excludes fully received orders',async()=>{expect(await result([line('1','3','2','2'),line('2','4','3','0')])).toMatchObject([{status:'partial',quantity:'5',pending_quantity:'3'}]);expect(await result([line('1','3','2','2')])).toEqual([])})
 it('preserves explicit zero purchase facts in displayed lines without counting them as pending',async()=>{const [r]=await result([line('1','4','2','0'),line('2','0','0','0')]);expect(r.quantity).toBe('2');expect(r.inbound_lines.find((l:any)=>l.id==='2')).toMatchObject({purchaseQuantity:0,inboundQuantity:0,pendingQuantity:0})})
 it('uses purchase quantity, not the consumer order quantity',async()=>{expect(await result([line('1','3','8','3',{hzkj_qty:'3'})])).toMatchObject([{status:'partial',pending_quantity:'5'}])})
 it('does not cancel out shortages against another SKU excess',async()=>{expect(await result([line('1','3','5','7'),line('2','4','5','3')])).toMatchObject([{status:'partial',pending_quantity:'2'}])})
 it('does not call an order fully received before the line received status is set',async()=>{expect(await result([line('1','4','5','5')])).toMatchObject([{status:'partial'}])})
 it('excludes virtual and combination-parent rows from physical quantities',async()=>{expect(await result([line('1','4','10','0',{hzkj_local_sku:{number:'HZ000020-001'}}),line('2','4','20','0'),line('3','4','3','0',{pid:'2'})])).toMatchObject([{quantity:'3',pending_quantity:'3'}])})
 it('does not invent zero for missing, null or invalid receipt quantities',async()=>{for(const value of [undefined,null,'','bad','-1'])expect(await result([line('1','4','10','0',{hzkj_instock_qty:value})])).toEqual([])})
 it('excludes unshipped, foreign-owner and zero-purchase records',async()=>{expect(await result([line('1','2')],{hzkj_purchase_status:'4'})).toEqual([]);expect(await result([line('1')],{}, {},['foreign'])).toEqual([]);expect(await result([line('1','4','0','0')])).toEqual([])})
 it('keeps status, warehouse and escaped keyword filters inside the same owner scope',async()=>{expect(await result([line('1')],{}, {status:'partial'})).toEqual([]);expect(await result([line('1')],{}, {warehouseCode:'SZ'})).toEqual([]);expect(await result([line('1')],{}, {search:'SKU_1'})).toEqual([]);expect(await result([line('1')],{}, {warehouseCode:'HZ',search:'TO10'})).toHaveLength(1)})
})
