import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DataSource } from 'typeorm'
import { collectedInboundPage } from './collected-inbound-query'
const database=process.env.INBOUND_QUERY_TEST_DB
const integration=database?.startsWith('hz_timestamp_test_')?describe:describe.skip
integration('reverse stock package membership',()=>{
 let db:DataSource
 beforeAll(async()=>{db=new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim()});await db.initialize()})
 afterAll(async()=>{await db?.destroy()})
 const stock=(id='s',patch={})=>({batch_id:'batch',source_id:id,entity_type:'stock_orders',owner_employee_id:'e',display:{stockNumber:'IO'+id,stockType:'full_payment',purchaseStatus:'shipped',warehouseCode:'HZ',...patch}})
 const notice=(id='n',sid='s',patch={})=>({batch_id:'batch',source_id:id,entity_type:'receipt_notice',display:{number:id,association:{state:'verified'},rawCancelStatus:'A',rawWmsStatus:'5',lines:[{id:'line',sourceDocumentKind:'stock',sourceDocumentId:sid}],...patch},raw:{hzkj_waybill_number:id,hzkj_logistics_company:'carrier',hzkj_shipping_time:'2026-11-19 08:00:00',entryentity:[{id:'line',hzkj_qty:'10',hzkj_receiveqty:'0'}]}})
 const order={batch_id:'batch',source_id:'o',order_number:'TO1',owner_employee_id:'e',display:{customerName:'Customer'},raw:{hzkj_orders_billentry:[]}}
 const consumption={batch_id:'batch',stock_id:'s',record_id:'c',order_number:'TO1',quantity:2,use_status:'1',payload:{stockNumber:'IOs',skuNumber:'SKU1'}}
 async function run(entities:any[],cons:any[]=[],orders:any[]=[],employees:string[]|null=['e'],query:any={},facts:any[]=[]) {
 const q=collectedInboundPage('batch',employees,{view:'parcel',...query},1,100),i=q.params.length+1
 const sql=`WITH hz_fop_collected_entities AS(SELECT * FROM jsonb_to_recordset($${i}::jsonb) r(batch_id text,source_id text,entity_type text,owner_employee_id text,display jsonb,raw jsonb)),
 hz_fop_collected_orders AS(SELECT * FROM jsonb_to_recordset($${i+1}::jsonb) r(batch_id text,source_id text,order_number text,owner_employee_id text,warehouse_code text,search_text text,paid_at timestamptz,display jsonb,raw jsonb,is_exception boolean,exception_type text,exception_reason text,exception_code text)),
 hz_fop_collected_stock_consumptions AS(SELECT * FROM jsonb_to_recordset($${i+2}::jsonb) r(batch_id text,stock_id text,record_id text,order_number text,quantity numeric,use_status text,payload jsonb)),
 hz_fop_collected_analytics_facts AS(SELECT * FROM jsonb_to_recordset($${i+3}::jsonb) r(batch_id text,source_id text,entity_type text,raw jsonb)),${q.sql.replace(/^WITH\s*/,'')}`
 return (await db.query(sql,[...q.params,JSON.stringify(entities),JSON.stringify(orders),JSON.stringify(cons),JSON.stringify(facts)]))[0]
 }
 it('keeps unconsumed full-payment and deposit stock',async()=>{const r=await run([stock(),notice(),stock('d',{stockType:'deposit'}),notice('n2','d')]);expect(r.parcel_total).toBe(2);expect(r.rows).toEqual([]);expect(r.parcels.map((p:any)=>p.stock_lines[0].stockType).sort()).toEqual(['deposit','full_payment'])})
 it('groups multiple receipt packages once per stock document before pagination',async()=>{const r=await run([stock(),notice(),notice('second')],[consumption],[order]);expect(r.parcel_total).toBe(1);expect(r.parcels[0].stock_lines).toEqual([{stockId:'s',stockNumber:'IOs',stockType:'full_payment'}])})
 it('applies stock ownership before grouping',async()=>{expect((await run([stock(),notice()],[consumption],[order],[])).parcel_total).toBe(0)})
 it('excludes completed stock and terminal notices',async()=>{expect((await run([stock('s',{purchaseStatus:'received'}),notice()])).parcel_total).toBe(0);for(const code of ['15','20','25','30'])expect((await run([stock(),notice('n','s',{rawWmsStatus:code})])).parcel_total).toBe(0)})
 it('searches stock and authorized consumer numbers',async()=>{expect((await run([stock(),notice()],[consumption],[order],['e'],{search:'TO1'})).parcel_total).toBe(1);expect((await run([stock(),notice()],[consumption],[{...order,owner_employee_id:'other'}],['e'],{search:'TO1'})).parcel_total).toBe(0);expect((await run([stock(),notice()],[],[],['e'],{search:'IOs'})).parcel_total).toBe(1)})

 it('filters direct and stock groups and sorts before pagination',async()=>{const older=notice('old'),newer=notice('new','d');newer.raw.hzkj_shipping_time='2026-11-20 08:00:00';const entities=[stock(),older,stock('d',{stockType:'deposit'}),newer];expect((await run(entities,[],[],null,{parcelType:'direct'})).parcel_total).toBe(0);const asc=await run(entities,[],[],null,{parcelType:'stock',shippedSort:'asc'});expect(asc.parcels.map((p:any)=>p.parcel_key)).toEqual(['stock:s','stock:d']);const desc=await run(entities,[],[],null,{parcelType:'stock',shippedSort:'desc'});expect(desc.parcels.map((p:any)=>p.parcel_key)).toEqual(['stock:d','stock:s'])})

})
