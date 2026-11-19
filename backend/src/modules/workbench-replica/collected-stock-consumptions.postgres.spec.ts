import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {DataSource,QueryRunner} from 'typeorm'
import {stockConsumptionTableSql,replaceStockConsumptionSnapshot,readStockConsumptionSnapshot} from './collected-stock-consumptions'
const database=process.env.STOCK_SOURCE_TEST_DB
const integration=database?.startsWith('hz_timestamp_test_')?describe:describe.skip
integration('stock consumption current facts in PostgreSQL',()=>{
 let db:DataSource,q:QueryRunner
 const batch='00000000-0000-4000-8000-000000000001',captured='2026-11-18T18:00:00Z'
 const stock=(status='0',extra={})=>({id:'B1',org_id:'100000',hzkj_stock_type:'1',hzkj_sale_order_use:[{id:'R1',hzkj_sale_order_billno:'TO1',hzkj_sales_order_sku_id:'S1',hzkj_use_qty:'4',hzkj_use_status:status,...extra}]})
 beforeAll(async()=>{db=new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim(),synchronize:false});await db.initialize()})
 afterAll(async()=>{if(db?.isInitialized)await db.destroy()})
 beforeEach(async()=>{q=db.createQueryRunner();await q.connect();await q.startTransaction();await q.query('CREATE TEMP TABLE hz_fop_collected_batches(id uuid PRIMARY KEY,company_id text,metadata jsonb) ON COMMIT DROP');await q.query('CREATE TEMP TABLE hz_fop_collected_orders(batch_id uuid,order_number text,raw_bill_status text) ON COMMIT DROP');await q.query(stockConsumptionTableSql.replace('CREATE TABLE','CREATE TEMP TABLE')+' ON COMMIT DROP');await q.query("INSERT INTO hz_fop_collected_batches VALUES($1,'100000','{}')",[batch]);await q.query("INSERT INTO hz_fop_collected_orders VALUES($1,'TO1','C'),($1,'TO2','C')",[batch])})
 afterEach(async()=>{await q.rollbackTransaction();await q.release()})
 const snapshot=async()=>{const[b]=await q.query('SELECT metadata FROM hz_fop_collected_batches');return readStockConsumptionSnapshot(q,batch,b.metadata,['TO1','TO2'])}
 it('persists exact records and makes replay a no-op',async()=>{
  expect(await replaceStockConsumptionSnapshot(q,batch,'100000',[stock()],captured)).toMatchObject({changed:true,recordCount:1,affectedOrders:['TO1','TO2']})
  expect((await snapshot())?.records[0]).toMatchObject({recordId:'R1',skuId:'S1',status:'0',quantity:'4'})
  expect(await replaceStockConsumptionSnapshot(q,batch,'100000',[stock()],captured)).toMatchObject({changed:false,affectedOrders:[]})
 })
 it('updates status without multiplying quantity and invalidates old/new order associations',async()=>{
  await replaceStockConsumptionSnapshot(q,batch,'100000',[stock()],captured)
  expect((await replaceStockConsumptionSnapshot(q,batch,'100000',[stock('1')],'2026-11-18T18:01:00Z')).affectedOrders).toEqual(['TO1'])
  expect((await snapshot())?.records).toHaveLength(1)
  expect((await snapshot())?.records[0]).toMatchObject({quantity:'4',status:'1'})
  expect((await replaceStockConsumptionSnapshot(q,batch,'100000',[stock('1',{hzkj_sale_order_billno:'TO2'})],'2026-11-18T18:02:00Z')).affectedOrders.sort()).toEqual(['TO1','TO2'])
 })
 it('removes released/deleted children on complete replacement and affects the prior order',async()=>{
  await replaceStockConsumptionSnapshot(q,batch,'100000',[stock()],captured)
  expect(await replaceStockConsumptionSnapshot(q,batch,'100000',[{...stock(),hzkj_sale_order_use:[]}],'2026-11-18T18:01:00Z')).toMatchObject({affectedOrders:['TO1'],recordCount:0})
  expect((await snapshot())?.records).toEqual([])
 })
 it('rejects stale snapshots and conflicting facts captured at the same time',async()=>{
  await replaceStockConsumptionSnapshot(q,batch,'100000',[stock('1')],captured)
  await expect(replaceStockConsumptionSnapshot(q,batch,'100000',[stock()],captured)).rejects.toThrow('consumption_capture_version_conflict')
  await expect(replaceStockConsumptionSnapshot(q,batch,'100000',[],'2026-11-18T17:59:00Z')).rejects.toThrow('consumption_capture_stale')
  expect((await snapshot())?.records[0]).toMatchObject({status:'1',quantity:'4'})
  expect(await replaceStockConsumptionSnapshot(q,batch,'100000',[stock('1')],'2026-11-18T18:03:00Z')).toMatchObject({changed:false,affectedOrders:[]})
  await expect(replaceStockConsumptionSnapshot(q,batch,'100000',[stock()],'2026-11-18T18:02:00Z')).rejects.toThrow('consumption_capture_stale')
 })
 it('keeps missing SKU as an explicit data gap and rejects an omitted collection before replacing facts',async()=>{
  await replaceStockConsumptionSnapshot(q,batch,'100000',[stock('1',{hzkj_sales_order_sku_id:undefined})],captured)
  expect((await snapshot())?.records[0]).toMatchObject({skuId:null,issues:['consumption_sku_missing']})
  await expect(replaceStockConsumptionSnapshot(q,batch,'100000',[{id:'B1',org_id:'100000'}],captured)).rejects.toThrow('consumption_collection_missing')
  expect((await snapshot())?.records).toHaveLength(1)
 })
})
