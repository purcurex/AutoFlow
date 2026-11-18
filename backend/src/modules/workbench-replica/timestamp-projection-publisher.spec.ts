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
const database=process.env.TIMESTAMP_PROJECTION_TEST_DB
const integration=database&&/^hz_timestamp_test_\d+$/.test(database)?describe:describe.skip
integration('ordinary timestamp atomic local publication',()=>{
 let db:DataSource,scope:any,tick=0
 const order=(id:string,owner='7')=>({id,billno:'SO'+id,hzkj_operator_id:owner,hzkj_customer_id:'8',billstatus:'C',hzkj_orders_billentry:[]})
 const dispatch=(id:string,root='1')=>({id,billno:'D'+id,org_id:'100000',hzkj_order_no:'SO'+root,hzkj_customer_id:'8',billstatus:'C',hzkj_logistics_orderno:'TRACK'+id,hzkj_logisticstrackentry:[]})
 const purchase=(root='1')=>({id:'80',billno:'P80',org_id:'100000',billstatus:'C',hzkj_cancelstatus:'A',hzkj_pay_status:'0',hzkj_purchase_channel:'2',hzkj_billentry:[{id:'81',hzkj_salbillnumber:'SO'+root,hzkj_qty:'2'}]})
 async function capture(entity:string,raws:any[]){const s={...scope,entityCode:entity};const prior=await db.query('SELECT 1 FROM hz_fop_timestamp_state WHERE batch_id=$1 AND entity_code=$2',[scope.batchId,entity]);return new TimestampPagedSync(new TimestampPostgresStore(db),{assertReady:()=>{},page:async()=>({scope:s,rows:raws.map(raw=>({id:raw.id,companyId:'100000',createdAt:'2026-11-15T00:00:00Z',modifiedAt:'2026-11-15T00:01:00Z',raw})),totalCount:raws.length,lastPage:true})},()=> new Date(Date.parse('2026-11-15T00:06:00Z')+(++tick)*1000).toISOString()).run(s,prior.length?'reconcile':'initialize')}
 const rows=(table:string)=>db.query('SELECT * FROM '+table+' WHERE batch_id=$1',[scope.batchId])
 beforeAll(async()=>{
  db=await new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim(),synchronize:false}).initialize()
  const [{ready}]=await db.query("SELECT to_regclass('hz_fop_timestamp_state') IS NOT NULL AS ready");const [{projected}]=await db.query("SELECT to_regclass('hz_fop_exception_versions') IS NOT NULL AS projected");if(ready&&projected)return;const q=db.createQueryRunner();try{if(!ready){await q.query('CREATE TABLE public.users(id uuid PRIMARY KEY)');for(const M of [AddWorkbenchSchemeA1794393001000,WorkbenchCollectedOrders1794411000000,CollectedEntities1794480000000,CollectedAnalyticsFacts1794500000000,CollectedBusinessChain1794580000000,TimestampQueryReplica1794770000000])await new M().up(q)}if(!projected){await q.startTransaction();await new PersistedExceptionState1794980000000().up(q);await q.commitTransaction()}}finally{if(q.isTransactionActive)await q.rollbackTransaction();await q.release()}
 })
 afterAll(async()=>{await db?.destroy()})
 beforeEach(async()=>{scope={batchId:randomUUID(),tenantId:'tenant',companyId:'100000',entityCode:'hzkj_orders'};const owner=randomUUID();await db.query('INSERT INTO users(id) VALUES($1)',[owner]);await db.query("INSERT INTO hz_fop_collected_batches(id,workspace_owner_id,tenant_id,company_id,state,source_as_of) VALUES($1,$2,'tenant','100000','active',now())",[scope.batchId,owner])})
 it('keeps physical classification unchanged when only virtual line statuses change',async()=>{
  const physical={id:'11',seq:1,hzkj_local_sku_number:'REAL',hzkj_qty:'2',hzkj_entrypurc_status:'0',hzkj_purcqty:'0',hzkj_instock_qty:'0'}
  const virtual={id:'12',seq:2,hzkj_local_sku_number:'HZ000020-001',hzkj_qty:'10',hzkj_entrypurc_status:'3',hzkj_purcqty:'10',hzkj_instock_qty:'10'}
  const header={...order('1'),hzkj_orderstatus:'2',hzkj_receipt_status:'1',hzkj_delivery_status:'1',hzkj_orders_billentry:[physical,virtual]}
  await capture('hzkj_orders',[header]);const before=(await rows('hz_fop_collected_orders'))[0].display
  expect(before.businessStatus).toMatchObject({purchase:'unpurchased',outbound:'unknown'})
  expect(before.items.find((l:any)=>l.id==='12').isVirtual).toBe(true)
  await capture('hzkj_orders',[{...header,hzkj_orders_billentry:[physical,{...virtual,hzkj_entrypurc_status:'4',hzkj_instock_qty:'0'}]}])
  const after=(await rows('hz_fop_collected_orders'))[0].display
  expect(after.businessStatus.purchase).toBe(before.businessStatus.purchase)
  expect(after.procurementQueueFlags).toEqual(before.procurementQueueFlags)
  expect(after.fulfillmentProgress.outbound).toBe('unknown')
 })
 it('publishes line outbound facts atomically and rejects a later omission without losing them',async()=>{
  const physical={id:'11',seq:1,hzkj_local_sku_number:'REAL',hzkj_qty:'2',hzkj_outbound_status:'0',hzkj_outbound_qty:0}
  const virtual={id:'12',seq:2,hzkj_local_sku_number:'HZ000020-001',hzkj_qty:'1',hzkj_outbound_status:'1',hzkj_outbound_qty:1}
  const header={...order('1'),hzkj_orderstatus:'2',hzkj_receipt_status:'1',hzkj_delivery_status:'1',hzkj_orders_billentry:[physical,virtual]}
  await capture('hzkj_orders',[header]);const [before]=await rows('hz_fop_collected_orders')
  expect(before.display.businessStatus.outbound).toBe('pending')
  const graph=await db.query("SELECT l.payload FROM hz_fop_source_lines l JOIN hz_fop_source_documents d ON d.id=l.document_id JOIN hz_fop_collected_chains c ON c.dataset_id=d.dataset_id WHERE c.batch_id=$1 AND d.source_id='1' AND l.source_entry_id='11'",[scope.batchId])
  expect(graph[0].payload.hzkj_outbound_qty).toBe(0)
  const missing:any={...physical};delete missing.hzkj_outbound_qty
  expect((await capture('hzkj_orders',[{...header,hzkj_orders_billentry:[missing,virtual]}])).publicationPending).toBe(true)
  expect((await rows('hz_fop_collected_orders'))[0]).toEqual(before)
  await capture('hzkj_orders',[{...header,hzkj_orders_billentry:[{...physical,hzkj_outbound_status:'1',hzkj_outbound_qty:2},virtual]}])
  expect((await rows('hz_fop_collected_orders'))[0].display.businessStatus.outbound).toBe('completed')
 })
 // These fixtures exercise the local publication contract, not purchase API range support.
 it('recovers captured source-number purchases when their parent arrives, then replays without rewriting',async()=>{
  const raw={...purchase(),hzkj_billentry:[{id:'81',hzkj_srcbillnumber:'TO1',hzkj_srcbillentity:'hzkj_orders',hzkj_qty:'2'}]}
  expect((await capture('hzkj_purorderbill',[raw])).publicationPending).toBe(true)
  await capture('hzkj_orders',[{...order('1'),billno:'TO1'}])
  const [linked]=await rows('hz_fop_collected_entities')
  expect(linked?.display.rows[0]).toMatchObject({orderId:'1',ownerEmployeeId:'7',associationState:'verified'})
  expect((await rows('hz_fop_timestamp_projection_tasks')).find((r:any)=>r.entity_code==='hzkj_purorderbill').state).toBe('applied')
  expect((await capture('hzkj_purorderbill',[raw])).changed).toBe(0)
  expect((await rows('hz_fop_collected_entities'))[0]).toEqual(linked)
 })
 it('does not reassign a purchase when its authoritative source number disappears from a partial payload',async()=>{
  await capture('hzkj_orders',[{...order('1'),billno:'TO1'},{...order('2','9'),billno:'TO2'}])
  const raw={...purchase(),hzkj_billentry:[{id:'81',hzkj_srcbillnumber:'TO1',hzkj_salbillnumber:'TO2',hzkj_qty:'2'}]}
  await capture('hzkj_purorderbill',[raw]);const [before]=await rows('hz_fop_collected_entities')
  const partial={...raw,hzkj_billentry:[{id:'81',hzkj_salbillnumber:'TO2',hzkj_qty:'2'}]}
  expect((await capture('hzkj_purorderbill',[partial])).publicationPending).toBe(true)
  expect((await rows('hz_fop_collected_entities'))[0]).toEqual(before)
  expect((await capture('hzkj_purorderbill',[])).publicationPending).toBe(true)
  expect((await rows('hz_fop_collected_entities'))[0]).toEqual(before)
  const cleared={...partial,hzkj_billentry:[{...partial.hzkj_billentry[0],hzkj_srcbillnumber:null}]}
  expect((await capture('hzkj_purorderbill',[cleared])).publicationPending).toBe(false)
  expect((await rows('hz_fop_collected_entities'))[0].display.rows[0]).toMatchObject({orderId:'2',ownerEmployeeId:'9'})
 })

 it('removes the old owner and graph path when a source-only purchase link is explicitly cleared',async()=>{
  await capture('hzkj_orders',[{...order('1'),billno:'TO1'}])
  const raw={...purchase(),hzkj_billentry:[{id:'81',hzkj_srcbillnumber:'TO1',hzkj_qty:'2'}]}
  await capture('hzkj_purorderbill',[raw])
  await capture('hzkj_purorderbill',[{...raw,hzkj_billentry:[{id:'81',hzkj_srcbillnumber:null,hzkj_qty:'2'}]}])
  expect((await rows('hz_fop_collected_entities'))[0].display.rows[0]).toMatchObject({orderId:null,ownerEmployeeId:null,associationState:'unresolved'})
  const paths=await db.query("SELECT count(*)::int n FROM hz_fop_document_relations r JOIN hz_fop_source_documents d ON d.id=r.to_document_id JOIN hz_fop_collected_chains c ON c.dataset_id=d.dataset_id WHERE c.batch_id=$1 AND d.source_id='80'",[scope.batchId])
  expect(paths[0].n).toBe(0)
  await capture('hzkj_purorderbill',[raw])
  expect((await rows('hz_fop_collected_entities'))[0].display.rows[0]).toMatchObject({orderId:'1',ownerEmployeeId:'7'})
 })
 it('recovers all shipping dependencies captured before their parent and leaves repeated replay unchanged',async()=>{
  await capture('hzkj_deliver_order',[{id:'5',billno:'N5',org_id:'100000',hzkj_deliver_billno:'D4',entryentity:[]}])
  await capture('hzkj_deliver_bill',[dispatch('4')])
  await capture('hzkj_alloc_bill',[{id:'3',billno:'A3',org_id:'100000',hzkj_order_id:'1',hzkj_order_no:'SO1',billstatus:'C',hzkj_alloc_entry:[]}])
  expect((await rows('hz_fop_timestamp_projection_tasks')).every((r:any)=>r.state==='pending')).toBe(true)
  await capture('hzkj_orders',[order('1')])
  expect((await rows('hz_fop_timestamp_projection_tasks')).every((r:any)=>r.state==='applied')).toBe(true)
  const entities=await rows('hz_fop_collected_entities')
  expect(entities.map((r:any)=>r.owner_employee_id)).toEqual(['7','7','7'])
  expect((await capture('hzkj_deliver_bill',[])).publicationPending).toBe(false)
  expect(await rows('hz_fop_collected_entities')).toEqual(entities)
  await capture('hzkj_orders',[order('1','9')])
  expect((await rows('hz_fop_collected_entities')).map((r:any)=>r.owner_employee_id)).toEqual(['9','9','9'])
  expect((await rows('hz_fop_collected_analytics_facts')).find((r:any)=>r.entity_type==='dispatch').owner_employee_id).toBe('9')
 })
 it('preserves an allocation on omitted parent ID, clears an explicit null, then recovers current ownership',async()=>{
  await capture('hzkj_orders',[order('1')])
  const raw={id:'3',billno:'A3',org_id:'100000',hzkj_order_id:'1',hzkj_order_no:'SO1',billstatus:'C',hzkj_alloc_entry:[]}
  await capture('hzkj_alloc_bill',[raw]);const [before]=await rows('hz_fop_collected_entities')
  const missing:any={...raw};delete missing.hzkj_order_id
  expect((await capture('hzkj_alloc_bill',[missing])).publicationPending).toBe(true)
  expect((await rows('hz_fop_collected_entities'))[0]).toEqual(before)
  await capture('hzkj_alloc_bill',[{...raw,hzkj_order_id:null}])
  expect((await rows('hz_fop_collected_entities'))[0]).toMatchObject({owner_employee_id:null,display:{sourceOrderId:null,association:{state:'unresolved'}}})
  await capture('hzkj_orders',[order('1','9')])
  await capture('hzkj_alloc_bill',[raw])
  expect((await rows('hz_fop_collected_entities'))[0]).toMatchObject({owner_employee_id:'9',display:{sourceOrderId:'1',association:{state:'verified'}}})
 })
 it('retains a purchase arriving before its parent and repairs it without recapturing the purchase',async()=>{
  expect((await capture('hzkj_purorderbill',[purchase()])).publicationPending).toBe(true)
  const [pending]=await rows('hz_fop_collected_entities')
  expect(pending.raw.hzkj_billentry[0].hzkj_salbillnumber).toBe('SO1')
  expect(pending.display.rows[0]).toMatchObject({orderId:null,ownerEmployeeId:null})
  await capture('hzkj_orders',[order('1')])
  const [linked]=await rows('hz_fop_collected_entities')
  expect(linked.display.rows[0]).toMatchObject({orderId:'1',ownerEmployeeId:'7'})
  expect(linked.display.rows[0].lines[0].fulfillmentLineId).toBeNull()
  expect((await rows('hz_fop_timestamp_projection_tasks')).find((r:any)=>r.entity_code==='hzkj_purorderbill').state).toBe('applied')
  expect((await capture('hzkj_purorderbill',[purchase()])).changed).toBe(0)
  expect((await rows('hz_fop_collected_entities'))[0]).toEqual(linked)
 })
 it('preserves many-to-many purchase rows and uncaptured purchases during a partial incremental batch',async()=>{
  await capture('hzkj_orders',[order('1'),order('2','9')])
  const merged={...purchase(),hzkj_billentry:[...purchase().hzkj_billentry,{...purchase('2').hzkj_billentry[0],id:'82'},{...purchase().hzkj_billentry[0],id:'83'}]}
  const second={...purchase(),id:'90',billno:'P90',hzkj_billentry:[{...purchase().hzkj_billentry[0],id:'91'}]}
  await capture('hzkj_purorderbill',[merged,second])
  const before=await rows('hz_fop_collected_entities'),group=before.find((r:any)=>r.source_id==='80')
  expect(group.display.rows).toHaveLength(2)
  expect(group.display.rows.find((r:any)=>r.orderId==='1').lines).toHaveLength(2)
  expect(group.display.rows.find((r:any)=>r.orderId==='2').ownerEmployeeId).toBe('9')
  const paymentFact=(await rows('hz_fop_collected_analytics_facts')).find((r:any)=>r.entity_type==='purchase'&&r.source_id==='80')
  expect(paymentFact.owner_employee_id).toBeNull()
  await capture('hzkj_purorderbill',[{...merged,hzkj_billentry:[merged.hzkj_billentry[1]]}])
  const after=await rows('hz_fop_collected_entities')
  expect(after.find((r:any)=>r.source_id==='90')).toEqual(before.find((r:any)=>r.source_id==='90'))
  expect(after.find((r:any)=>r.source_id==='80').display.rows.map((r:any)=>r.orderId)).toEqual(['2'])
  const task=(await rows('hz_fop_timestamp_projection_tasks')).find((r:any)=>r.entity_code==='hzkj_purorderbill'&&r.source_id==='80')
  expect(task.previous_raw).toEqual(merged)
  await capture('hzkj_purorderbill',[])
  expect((await rows('hz_fop_collected_entities')).find((r:any)=>r.source_id==='90')).toEqual(before.find((r:any)=>r.source_id==='90'))
 })
 it('refreshes purchase facts and both order roots when a purchase moves or clears its entries',async()=>{
  const header=(id:string)=>({...order(id,id==='1'?'7':'9'),hzkj_orders_billentry:[{id:id+'1',seq:1,hzkj_qty:'2'}]})
  await capture('hzkj_orders',[header('1'),header('2')])
  const full=(root:string)=>({...purchase(root),hzkj_billentry:[{...purchase(root).hzkj_billentry[0],hzkj_salbillentryid:root+'1'}]})
  await capture('hzkj_purorderbill',[full('1')])
  expect((await rows('hz_fop_collected_orders')).find((r:any)=>r.source_id==='1').display.procurementProgress.supplierPayment).toBe('unpaid')
  await capture('hzkj_purorderbill',[{...full('2'),hzkj_pay_status:'1',hzkj_ship_status:'1'}])
  const all=await rows('hz_fop_collected_orders'),[p]=await rows('hz_fop_collected_entities')
  expect(all.find((r:any)=>r.source_id==='1').display.procurementProgress.supplierPayment).toBe('unknown')
  expect(all.find((r:any)=>r.source_id==='2').display.procurementProgress.supplierPayment).toBe('paid')
  expect(p.display.purchase.payment).toBe('paid');expect(p.display.rows[0].ownerEmployeeId).toBe('9')
  await capture('hzkj_purorderbill',[{...full('2'),hzkj_billentry:[]}])
  expect((await rows('hz_fop_collected_entities'))[0].display.rows).toEqual([])
  expect((await rows('hz_fop_collected_orders')).find((r:any)=>r.source_id==='2').display.procurementProgress.supplierPayment).toBe('unknown')
  const paths=await db.query("SELECT count(*)::int n FROM hz_fop_document_relations r JOIN hz_fop_source_documents d ON d.id=r.to_document_id JOIN hz_fop_collected_chains c ON c.dataset_id=d.dataset_id WHERE c.batch_id=$1 AND d.source_id='80'",[scope.batchId])
  expect(paths[0].n).toBe(0)
 })
 it('does not erase relationships on missing entries or sales reference fields, and accepts explicit clearing',async()=>{
  await capture('hzkj_orders',[order('1')]);await capture('hzkj_purorderbill',[purchase()])
  const [before]=await rows('hz_fop_collected_entities')
  const missing:any={...purchase()};delete missing.hzkj_billentry
  expect((await capture('hzkj_purorderbill',[missing])).publicationPending).toBe(true)
  expect((await rows('hz_fop_collected_entities'))[0]).toEqual(before)
  expect((await capture('hzkj_purorderbill',[{...purchase(),hzkj_billentry:[{id:'81',hzkj_qty:'2'}]}])).publicationPending).toBe(true)
  expect((await rows('hz_fop_collected_entities'))[0]).toEqual(before)
  await capture('hzkj_purorderbill',[{...purchase(),hzkj_billentry:[{id:'81',hzkj_salbillnumber:null,hzkj_srcbillnumber:'SO1',hzkj_srcbillentity:'hzkj_orders',hzkj_srcbillid:'1',hzkj_qty:'2'}]}])
  expect((await rows('hz_fop_collected_entities'))[0].display.rows[0].ownerEmployeeId).toBeNull()
 })
 it('retains number-based purchase ownership when optional line references are omitted or cleared',async()=>{
  await capture('hzkj_orders',[{...order('1'),hzkj_orders_billentry:[{id:'11',seq:1,hzkj_qty:'2'}]}])
  const full={...purchase(),hzkj_billentry:[{...purchase().hzkj_billentry[0],hzkj_salbillentryid:'11'}]}
  await capture('hzkj_purorderbill',[full]);const [before]=await rows('hz_fop_collected_entities')
  expect((await capture('hzkj_purorderbill',[purchase()])).publicationPending).toBe(false)
  expect((await rows('hz_fop_collected_entities'))[0].display.rows[0]).toMatchObject({orderId:'1',ownerEmployeeId:'7',associationState:'verified',lines:[{fulfillmentLineId:null}]})
  await capture('hzkj_purorderbill',[{...purchase(),hzkj_billentry:[{...purchase().hzkj_billentry[0],hzkj_salbillentryid:null}]}])
  const [after]=await rows('hz_fop_collected_entities')
  expect(after.display.rows[0]).toMatchObject({orderId:'1',ownerEmployeeId:'7',lines:[{fulfillmentLineId:null}]})
 })
 it('revalidates all number-based dependencies when a duplicate order number appears and is later renamed',async()=>{
  await capture('hzkj_orders',[order('1')]);await capture('hzkj_purorderbill',[purchase()]);await capture('hzkj_deliver_bill',[dispatch('4')])
  await capture('hzkj_orders',[{...order('2','9'),billno:'SO1'}])
  const duplicate=await rows('hz_fop_collected_entities')
  expect(duplicate.find((r:any)=>r.entity_type==='purchase').display.rows[0].ownerEmployeeId).toBeNull()
  expect(duplicate.find((r:any)=>r.entity_type==='dispatch').owner_employee_id).toBeNull()
  expect((await rows('hz_fop_collected_orders')).find((r:any)=>r.source_id==='1').display.dispatchDocuments).toEqual([])
  await capture('hzkj_orders',[order('2','9')])
  const recovered=await rows('hz_fop_collected_entities')
  expect(recovered.find((r:any)=>r.entity_type==='purchase').display.rows[0].ownerEmployeeId).toBe('7')
  expect(recovered.find((r:any)=>r.entity_type==='dispatch').owner_employee_id).toBe('7')
 })
 it('rebinds delivery notices when dispatch numbers change or become unique again',async()=>{
  await capture('hzkj_orders',[order('1')]);await capture('hzkj_deliver_bill',[dispatch('4')])
  await capture('hzkj_deliver_order',[{id:'5',billno:'N5',org_id:'100000',hzkj_deliver_billno:'D4',entryentity:[]}])
  await capture('hzkj_deliver_bill',[{...dispatch('6'),billno:'D4'}])
  expect((await rows('hz_fop_collected_entities')).find((r:any)=>r.source_id==='5').owner_employee_id).toBeNull()
  await capture('hzkj_deliver_bill',[dispatch('6')])
  expect((await rows('hz_fop_collected_entities')).find((r:any)=>r.source_id==='5').owner_employee_id).toBe('7')
  await capture('hzkj_deliver_bill',[{...dispatch('4'),billno:'D7'}])
  expect((await rows('hz_fop_collected_entities')).find((r:any)=>r.source_id==='5').owner_employee_id).toBeNull()
 })
 it('repairs receipt lineage from retained entry links when the purchase arrives later and removes obsolete owners',async()=>{
  await capture('hzkj_orders',[order('1'),order('2','9')])
  await db.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at) VALUES($1,'native_links','receiptLinks','{}',$2,'',now())",[scope.batchId,JSON.stringify({values:{'91':'81'}})])
  const raw={id:'90',billno:'N90',organizationId:'100000',entryentity:[{id:'91',hzkj_material:{number:'OWN-SKU',name:'Receipt product'},hzkj_qty:'2'}]}
  const display={id:'90',sourceOrderIds:[],ownerEmployeeIds:[],lines:[{id:'91',purchaseLineId:null,sourceOrderId:null,sku:'OWN-SKU',name:'Receipt product'}]}
  await db.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at) VALUES($1,'receipt_notice','90',$2,$3,'',now())",[scope.batchId,JSON.stringify(display),JSON.stringify(raw)])
  const notice=async()=>(await rows('hz_fop_collected_entities')).find((r:any)=>r.source_id==='90')
  await capture('hzkj_purorderbill',[purchase()])
  expect((await notice()).display).toMatchObject({sourceOrderIds:['1'],ownerEmployeeIds:['7'],lines:[{purchaseLineId:'81',sourceOrderId:'1',sku:'OWN-SKU',name:'Receipt product'}]})
  await capture('hzkj_purorderbill',[purchase('2')])
  expect((await notice()).display).toMatchObject({sourceOrderIds:['2'],ownerEmployeeIds:['9'],lines:[{sourceOrderId:'2'}]})
  await capture('hzkj_purorderbill',[{...purchase('2'),hzkj_billentry:[]}])
  expect((await notice()).display).toMatchObject({sourceOrderIds:[],ownerEmployeeIds:[],lines:[{sourceOrderId:null,sku:'OWN-SKU'}]})
 })
 it('blocks an incomplete later payload instead of erasing stored outbound status',async()=>{
  await capture('hzkj_orders',[{...order('1'),hzkj_delivery_status:'0'}])
  await capture('hzkj_orders',[order('1','9')])
  const [preserved]=await rows('hz_fop_collected_orders')
  expect(preserved.raw_delivery_status).toBe('0');expect(preserved.owner_employee_id).toBe('7')
  const [task]=await db.query('SELECT state,reason FROM hz_fop_timestamp_projection_tasks WHERE batch_id=$1',[scope.batchId])
  expect(task).toMatchObject({state:'pending',reason:'timestamp_projection_missing_outbound_status'})
  await capture('hzkj_orders',[{...order('1','9'),hzkj_delivery_status:'2'}])
  expect((await rows('hz_fop_collected_orders'))[0].raw_delivery_status).toBe('2')
  await capture('hzkj_orders',[{...order('1','9'),hzkj_delivery_status:null}])
  expect((await rows('hz_fop_collected_orders'))[0].raw_delivery_status).toBeNull()
 })
 it('preserves a verified localized store name across null native responses but clears it when the store changes',async()=>{
  const header={...order('1'),hzkj_shop_id:'201',hzkj_shop_name:null}
  await capture('hzkj_orders',[header])
  const storeNameCapture={source:'employee-orders/page',language:'zh_CN',companyId:'100000',shopId:'201',name:'Edelsound',sourceOrderId:'1',sourceOrderNumber:'SO1',capturedAt:'2026-11-15T00:05:00Z',responseSha256:'a'.repeat(64)}
  await db.query('UPDATE hz_fop_collected_orders SET display=display||$2::jsonb WHERE batch_id=$1',[scope.batchId,JSON.stringify({storeName:'Edelsound',storeNameZhCN:'Edelsound',storeNameCapture})])
  await capture('hzkj_orders',[{...header,hzkj_operator_id:'9'}])
  const [retained]=await rows('hz_fop_collected_orders')
  expect(retained.display.storeName).toBe('Edelsound');expect(retained.search_text).toContain('edelsound')
  expect(retained.raw.hzkj_shop.name).toBeNull();expect(retained.owner_employee_id).toBe('9')
  await capture('hzkj_orders',[{...header,hzkj_shop_id:'202'}])
  const [reassigned]=await rows('hz_fop_collected_orders')
  expect(reassigned.display.storeName).toBe('');expect(reassigned.display.storeNameCapture).toBeUndefined()
 })
 it('publishes all four entities, analytics and graph atomically, then cleans old links on dispatch reassignment',async()=>{
  await capture('hzkj_orders',[order('1'),order('2','9')])
  await capture('hzkj_alloc_bill',[{id:'3',billno:'A3',org_id:'100000',hzkj_order_id:'1',hzkj_order_no:'SO1',billstatus:'C',hzkj_alloc_entry:[]}])
  await capture('hzkj_deliver_bill',[dispatch('4')])
  const result=await capture('hzkj_deliver_order',[{id:'5',billno:'N5',org_id:'100000',hzkj_deliver_billno:'D4',entryentity:[]}])
  expect(result.publicationPending).toBe(false)
  expect((await rows('hz_fop_collected_entities')).map((r:any)=>r.owner_employee_id)).toEqual(['7','7','7'])
  expect((await rows('hz_fop_collected_orders')).find((r:any)=>r.source_id==='1').display.dispatchDocuments[0].trackingNumbers[0].number).toBe('TRACK4')
  await capture('hzkj_deliver_bill',[dispatch('4','2')])
  const orders=await rows('hz_fop_collected_orders'),entities=await rows('hz_fop_collected_entities')
  expect(orders.find((r:any)=>r.source_id==='1').display.dispatchDocuments).toEqual([])
  expect(orders.find((r:any)=>r.source_id==='2').display.dispatchDocuments).toHaveLength(1)
  expect(entities.find((r:any)=>r.entity_type==='delivery_notice').owner_employee_id).toBe('9')
  expect((await rows('hz_fop_collected_analytics_facts')).find((r:any)=>r.entity_type==='dispatch').owner_employee_id).toBe('9')
  const paths=await db.query("SELECT root.source_id AS root,target.source_id AS target FROM hz_fop_order_relation_paths p JOIN hz_fop_collected_chains c ON c.dataset_id=p.dataset_id JOIN hz_fop_source_documents root ON root.id=p.order_document_id JOIN hz_fop_document_relations r ON r.id=p.relation_id JOIN hz_fop_source_documents target ON target.id=r.to_document_id WHERE c.batch_id=$1 AND target.source_id='4'",[scope.batchId])
  expect(paths.map((p:any)=>p.root)).toEqual(['2'])
 })
 it('leaves uncaptured records intact, defeats legacy native overlay and clears ownership fence after rebuilding',async()=>{
  await capture('hzkj_orders',[order('1'),order('2')]);await capture('hzkj_deliver_bill',[dispatch('4')])
  const before=(await rows('hz_fop_collected_orders')).find((r:any)=>r.source_id==='2')
  await db.query("UPDATE hz_fop_collected_orders SET raw=raw||$2::jsonb WHERE batch_id=$1 AND source_id='1'",[scope.batchId,JSON.stringify({native_allocation:order('1','99')})])
  await capture('hzkj_orders',[order('1','9')])
  expect((await rows('hz_fop_collected_orders')).find((r:any)=>r.source_id==='2')).toEqual(before)
  expect((await rows('hz_fop_collected_entities'))[0].owner_employee_id).toBe('9')
  const [b]=await db.query('SELECT metadata FROM hz_fop_collected_batches WHERE id=$1',[scope.batchId]);expect(b.metadata.timestampOwnershipPending).toBeUndefined()
  const [fact]=await db.query("SELECT f.owner_employee_id FROM hz_fop_fulfillment_orders f JOIN hz_fop_source_documents d ON d.id=f.document_id JOIN hz_fop_collected_chains c ON c.dataset_id=f.dataset_id WHERE c.batch_id=$1 AND d.source_id='1'",[scope.batchId]);expect(fact.owner_employee_id).toBe('9')
 })
 it('publishes complete records while keeping omitted indispensable relation fields pending',async()=>{
  await capture('hzkj_orders',[order('1')]);const invalid=dispatch('5');delete (invalid as any).hzkj_order_no
  const result=await capture('hzkj_deliver_bill',[dispatch('4'),invalid]);expect(result.pendingProjection).toBe(1);expect(result.publicationPending).toBe(true)
  expect(await rows('hz_fop_collected_entities')).toHaveLength(1)
  const tasks=await rows('hz_fop_timestamp_projection_tasks');expect(tasks.find((r:any)=>r.source_id==='5').reason).toBe('timestamp_projection_missing_hzkj_order_no')
 })
 it('rolls back mirror, local display, graph, analytics, tasks and W if final metadata fails',async()=>{
  await capture('hzkj_orders',[order('1')]);await capture('hzkj_deliver_bill',[dispatch('4')])
  const tables=['hz_fop_collected_orders','hz_fop_collected_entities','hz_fop_collected_analytics_facts','hz_fop_timestamp_documents','hz_fop_timestamp_projection_tasks','hz_fop_timestamp_state','hz_fop_collected_chains']
  const before=await Promise.all(tables.map(rows))
  await db.query(`CREATE FUNCTION test_publication_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.metadata->'timestampSync'->'hzkj_orders'->>'runId' IS DISTINCT FROM OLD.metadata->'timestampSync'->'hzkj_orders'->>'runId' AND EXISTS(SELECT 1 FROM hz_fop_collected_orders WHERE batch_id=NEW.id AND owner_employee_id='9') THEN RAISE EXCEPTION 'test_publication_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_publication_failure BEFORE UPDATE ON hz_fop_collected_batches FOR EACH ROW EXECUTE FUNCTION test_publication_failure()`)
  try{await expect(capture('hzkj_orders',[order('1','9')])).rejects.toThrow('test_publication_failure');expect(await Promise.all(tables.map(rows))).toEqual(before)}finally{await db.query('DROP TRIGGER test_publication_failure ON hz_fop_collected_batches; DROP FUNCTION test_publication_failure()')}

 })
 it('rolls back a purchase reassignment with its dependent displays, analytics and checkpoint on commit failure',async()=>{
  await capture('hzkj_orders',[order('1'),order('2','9')]);await capture('hzkj_purorderbill',[purchase()])
  const tables=['hz_fop_collected_orders','hz_fop_collected_entities','hz_fop_collected_analytics_facts','hz_fop_timestamp_documents','hz_fop_timestamp_projection_tasks','hz_fop_timestamp_state','hz_fop_collected_chains']
  const stableRows=async()=>Promise.all(tables.map(async t=>(await rows(t)).sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))))
  const before=await stableRows()
  await db.query(`CREATE FUNCTION test_purchase_publication_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.metadata->'timestampSync'->'hzkj_purorderbill'->>'runId' IS DISTINCT FROM OLD.metadata->'timestampSync'->'hzkj_purorderbill'->>'runId' THEN RAISE EXCEPTION 'test_purchase_publication_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_purchase_publication_failure BEFORE UPDATE ON hz_fop_collected_batches FOR EACH ROW EXECUTE FUNCTION test_purchase_publication_failure()`)
  try{await expect(capture('hzkj_purorderbill',[purchase('2')])).rejects.toThrow('test_purchase_publication_failure');expect(await stableRows()).toEqual(before)}finally{await db.query('DROP TRIGGER test_purchase_publication_failure ON hz_fop_collected_batches; DROP FUNCTION test_purchase_publication_failure()')}
 })
 it('removes replaced header lines without deleting lines of uncaptured orders',async()=>{
  const withLine=(id:string)=>({...order(id),hzkj_orders_billentry:[{id:id+'1',seq:1,hzkj_qty:'2',hzkj_local_sku_id:'80'}]})
  await capture('hzkj_orders',[withLine('1'),withLine('2')]);await capture('hzkj_orders',[order('1')])
  const lines=await db.query('SELECT d.source_id,l.source_entry_id FROM hz_fop_source_lines l JOIN hz_fop_source_documents d ON d.id=l.document_id JOIN hz_fop_collected_chains c ON c.dataset_id=l.dataset_id WHERE c.batch_id=$1',[scope.batchId])
  expect(lines).toEqual([{source_id:'2',source_entry_id:'21'}])
 })
 it('a failed graph rebuild rolls back already written display and final metadata',async()=>{
  await capture('hzkj_orders',[order('1')]);const before=await rows('hz_fop_collected_orders'),watermark=await rows('hz_fop_timestamp_state'),chain=await rows('hz_fop_collected_chains')
  await db.query(`CREATE FUNCTION test_graph_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload->'raw'->>'hzkj_operator_id'='9' THEN RAISE EXCEPTION 'test_graph_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_graph_failure BEFORE INSERT OR UPDATE ON hz_fop_source_documents FOR EACH ROW EXECUTE FUNCTION test_graph_failure()`)
  try{await expect(capture('hzkj_orders',[order('1','9')])).rejects.toThrow('test_graph_failure');expect(await rows('hz_fop_collected_orders')).toEqual(before);expect(await rows('hz_fop_timestamp_state')).toEqual(watermark);expect(await rows('hz_fop_collected_chains')).toEqual(chain)}finally{await db.query('DROP TRIGGER test_graph_failure ON hz_fop_source_documents; DROP FUNCTION test_graph_failure()')}
 })
 it('an empty capture preserves existing records and reports local publication complete with no pending tasks',async()=>{
  await capture('hzkj_orders',[order('1')]);const before=await rows('hz_fop_collected_orders');const result=await capture('hzkj_orders',[])
  expect(result.publicationPending).toBe(false);expect(await rows('hz_fop_collected_orders')).toEqual(before)
  const [batch]=await db.query('SELECT * FROM hz_fop_collected_batches WHERE id=$1',[scope.batchId]);expect((await rows('hz_fop_collected_chains'))[0].source_signature).toBe(chainSourceSignature(batch))
 })

 it('retains order ownership without entry identity and never assigns a merged purchase total to one owner',async()=>{
  const header=(id:string,owner:string)=>({...order(id,owner),hzkj_orders_billentry:[{id:id+'1',seq:1,hzkj_qty:'2'}]})
  await capture('hzkj_orders',[header('1','7'),header('2','9')])
  const raw={id:'80',billno:'P80',organizationId:'100000',hzkj_cancelstatus:'A',hzkj_pay_status:'0',hzkj_purchase_channel:'2',hzkj_billentry:[{id:'81',hzkj_salbillnumber:'SO1',hzkj_salbillentryid:'11',hzkj_qty:'2'},{id:'82',hzkj_salbillnumber:'SO2',hzkj_salbillentryid:'21',hzkj_qty:'2'}]}
  const display={id:'80',association:{state:'verified'},rows:['1','2'].map((id,i)=>({orderId:id,ownerEmployeeId:i?'9':'7',lines:[{fulfillmentLineId:id+'1',purchaseLineId:String(81+i),quantity:2,shippedQuantity:null}]}))}
  await db.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at) VALUES($1,'purchase','80',$2,$3,'',now())",[scope.batchId,JSON.stringify(display),JSON.stringify(raw)])
  await db.query("INSERT INTO hz_fop_collected_analytics_facts(batch_id,entity_type,source_id,company_id,document_number,facts,raw,captured_at) VALUES($1,'purchase','80','100000','P80',$2,$3,now())",[scope.batchId,JSON.stringify({businessEligible:true,association:{sourceOrderIds:['1','2']}}),JSON.stringify(raw)])
  await capture('hzkj_orders',[order('1','7')])
  const fact=(await rows('hz_fop_collected_analytics_facts')).find((r:any)=>r.source_id==='80');expect(fact.owner_employee_id).toBeNull();expect(fact.facts.sourceOwnershipVerified).toBe(false)
  const p=(await rows('hz_fop_collected_entities')).find((r:any)=>r.source_id==='80');expect(p.display.rows[0].ownerEmployeeId).toBe('7');expect(p.display.rows[0].lines[0].fulfillmentLineId).toBeNull();expect(p.display.rows[1].ownerEmployeeId).toBe('9')
 })
 it('recovers a previously unresolved order-number purchase on the next parent refresh',async()=>{
  await capture('hzkj_orders',[order('1','7')])
  const raw={id:'80',billno:'P80',organizationId:'100000',hzkj_cancelstatus:'A',hzkj_pay_status:'0',hzkj_purchase_channel:'2',hzkj_billentry:[{id:'81',hzkj_salbillnumber:'SO1',hzkj_salbillid:'0',hzkj_salbillentryid:'0',hzkj_srcbillentity:'hzkj_purapplybill',hzkj_srcbillid:'99',hzkj_qty:'2'}]}
  await db.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at) VALUES($1,'purchase','80',$2,$3,'',now())",[scope.batchId,JSON.stringify({id:'80',rows:[{orderId:null,orderNumber:'SO1',lines:[]}]}),JSON.stringify(raw)])
  await capture('hzkj_orders',[{...order('1','9'),hzkj_purchase_status:'4'}])
  const p=(await rows('hz_fop_collected_entities')).find((r:any)=>r.source_id==='80')
  expect(p.display.rows[0]).toMatchObject({orderId:'1',ownerEmployeeId:'9',associationState:'verified'})
  expect(p.display.rows[0].lines[0]).toMatchObject({fulfillmentLineId:null,quantity:2})
  expect((await rows('hz_fop_collected_orders'))[0].raw.hzkj_purchase_status).toBe('4')
 })
 it('retains a purchase payment action proven by independent raw after a header refresh',async()=>{
  const rawOrder={...order('1'),hzkj_orders_billentry:[{id:'11',seq:1,hzkj_qty:'2'}]};await capture('hzkj_orders',[rawOrder])
  const raw={id:'80',billno:'P80',organizationId:'100000',hzkj_cancelstatus:'A',hzkj_pay_status:'0',hzkj_purchase_channel:'2',hzkj_billentry:[{id:'81',hzkj_salbillnumber:'SO1',hzkj_salbillentryid:'11',hzkj_qty:'2'}]},display={id:'80',association:{state:'verified'},rows:[{orderId:'1',ownerEmployeeId:'7',lines:[{fulfillmentLineId:'11',purchaseLineId:'81',quantity:2}]}]}
  await db.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at) VALUES($1,'purchase','80',$2,$3,'',now())",[scope.batchId,JSON.stringify(display),JSON.stringify(raw)])
  await capture('hzkj_orders',[{...rawOrder,hzkj_operator_id:'9'}]);expect((await rows('hz_fop_collected_orders'))[0].display.procurementProgress.supplierPayment).toBe('unpaid')
 })

 it('keeps mixed stock and fulfillment receipt totals unassigned instead of dropping the stock owner',async()=>{
  await capture('hzkj_orders',[order('1')])
  await db.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at) VALUES($1,'stock','90','{}',$2,'',now())",[scope.batchId,JSON.stringify({id:'90',billno:'ST90',organizationId:'100000',hzkj_operator_id:'9',hzkj_orders_billentry:[]})])
  const raw={id:'91',billno:'R91',organizationId:'100000',entryentity:[{id:'92',hzkj_entry_src_type:'A',hzkj_src_order:'SO1'},{id:'93',hzkj_entry_src_type:'C',hzkj_src_order:'ST90'}]}
  await db.query("INSERT INTO hz_fop_collected_analytics_facts(batch_id,entity_type,source_id,company_id,document_number,facts,raw,captured_at) VALUES($1,'receipt','91','100000','R91',$2,$3,now())",[scope.batchId,JSON.stringify({businessEligible:true,association:{sourceOrderIds:['1','90']}}),JSON.stringify(raw)])
  await capture('hzkj_orders',[order('1','8')]);const fact=(await rows('hz_fop_collected_analytics_facts')).find((r:any)=>r.source_id==='91');expect(fact.owner_employee_id).toBeNull();expect(fact.facts.sourceOwnershipVerified).toBe(false)
 })

 it('clears an ownership fence only after a previously blocked dependency and its verified parent are both published',async()=>{
  await capture('hzkj_orders',[order('1')]);const invalid=dispatch('4');delete (invalid as any).hzkj_order_no
  await capture('hzkj_deliver_bill',[invalid]);await capture('hzkj_orders',[order('1','9')])
  const batch=async()=>(await db.query('SELECT metadata FROM hz_fop_collected_batches WHERE id=$1',[scope.batchId]))[0]
  expect((await batch()).metadata.timestampOwnershipPending).toBe(true)
  await capture('hzkj_deliver_bill',[dispatch('4')]);expect((await batch()).metadata.timestampOwnershipPending).toBeUndefined()
  expect((await rows('hz_fop_collected_entities'))[0].owner_employee_id).toBe('9')
  expect((await rows('hz_fop_collected_orders'))[0].display.dataQuality).toMatchObject({mode:'collected',syncMode:'timestamp',readOnly:true})
 })

 it('uses current purchase raw entry pair and quantity instead of stale display coverage',async()=>{
  const header={...order('1'),hzkj_orders_billentry:[{id:'11',seq:1,hzkj_qty:'2'},{id:'12',seq:2,hzkj_qty:'2'}]};await capture('hzkj_orders',[header])
  const raw={id:'80',billno:'P80',organizationId:'100000',hzkj_cancelstatus:'A',hzkj_pay_status:'1',hzkj_purchase_channel:'2',hzkj_ship_status:'1',hzkj_billentry:[{id:'81',hzkj_salbillnumber:'SO1',hzkj_salbillentryid:'12',hzkj_qty:'1'}]},display={id:'80',association:{state:'verified'},rows:[{orderId:'1',ownerEmployeeId:'7',lines:[{fulfillmentLineId:'11',purchaseLineId:'81',quantity:2}]}]}
  await db.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at) VALUES($1,'purchase','80',$2,$3,'',now())",[scope.batchId,JSON.stringify(display),JSON.stringify(raw)])
  await capture('hzkj_orders',[{...header,hzkj_operator_id:'9'}]);const p=(await rows('hz_fop_collected_entities'))[0]
  expect(p.display.rows[0].lines[0]).toMatchObject({fulfillmentLineId:'12',quantity:1});expect((await rows('hz_fop_collected_orders'))[0].display.timestampProcurementBasis.lineCoverageVerified).toBe(false)
 })
 it('does not authorize whole analytics from a different newer partial entity version',async()=>{
  const header=(id:string,owner:string)=>({...order(id,owner),hzkj_orders_billentry:[{id:id+'1',seq:1,hzkj_qty:'2'}]});await capture('hzkj_orders',[header('1','7'),header('2','9')])
  const full={id:'80',billno:'P80',organizationId:'100000',hzkj_billentry:[{id:'81',hzkj_salbillnumber:'SO1',hzkj_salbillentryid:'11',hzkj_qty:'2'},{id:'82',hzkj_salbillnumber:'SO2',hzkj_salbillentryid:'21',hzkj_qty:'2'}]}
  await db.query("INSERT INTO hz_fop_collected_analytics_facts(batch_id,entity_type,source_id,company_id,document_number,facts,raw,captured_at) VALUES($1,'purchase','80','100000','P80',$2,$3,'2026-11-01')",[scope.batchId,JSON.stringify({businessEligible:true,association:{sourceOrderIds:['1','2']}}),JSON.stringify(full)])
  await db.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at) VALUES($1,'purchase','80','{}',$2,'',now())",[scope.batchId,JSON.stringify({...full,hzkj_billentry:[full.hzkj_billentry[0]]})])
  await capture('hzkj_orders',[{...header('1','7'),billstatus:'B'}]);const fact=(await rows('hz_fop_collected_analytics_facts')).find((r:any)=>r.source_id==='80');expect(fact.owner_employee_id).toBeNull();expect(fact.facts.effective).toBe(false)
 })
 it('retains proven current demand links but never reuses an old synthetic demand quantity',async()=>{
  const header={...order('1'),hzkj_orders_billentry:[{id:'11',seq:1,hzkj_qty:'2'}]};await capture('hzkj_orders',[header])
  await db.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at) VALUES($1,'purchase_demand','uncreated',$2,$3,'',now())",[scope.batchId,JSON.stringify({id:'uncreated',kind:'uncreated',stage:'uncreated',rows:[{orderId:'1',ownerEmployeeId:'7',lines:[{fulfillmentLineId:'11',quantity:2}]}]}),JSON.stringify({source:'native_parent_lines_and_linked_purchase_lines',parentIds:['1']})])
  await capture('hzkj_orders',[{...header,hzkj_operator_id:'9'}]);const e=(await rows('hz_fop_collected_entities')).find((r:any)=>r.source_id==='timestamp_uncreated_unknown')
  expect((await rows('hz_fop_collected_entities')).filter((r:any)=>r.entity_type==='purchase_demand')).toHaveLength(1)
  const [{pending}]=await db.query("SELECT count(*)::int pending FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='purchase_demand' AND display->>'stage'='uncreated'",[scope.batchId]);expect(pending).toBe(0)
  expect(e.display.stage).toBe('unknown');expect(e.display.rows[0].ownerEmployeeId).toBe('9');expect(e.display.rows[0].lines[0]).toMatchObject({fulfillmentLineId:'11',quantity:null})
 })

 it('moves only changed demand rows to unknown and preserves uncaptured demand queue membership',async()=>{
  const header=(id:string)=>({...order(id),hzkj_orders_billentry:[{id:id+'1',seq:1,hzkj_qty:'2'}]});await capture('hzkj_orders',[header('1'),header('2')])
  const demandRows=['1','2'].map(id=>({orderId:id,ownerEmployeeId:'7',lines:[{fulfillmentLineId:id+'1',quantity:2,shippedQuantity:0}]}))
  await db.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at) VALUES($1,'purchase_demand','uncreated',$2,$3,'',now())",[scope.batchId,JSON.stringify({id:'uncreated',kind:'uncreated',stage:'uncreated',rows:demandRows}),JSON.stringify({source:'native_parent_lines_and_linked_purchase_lines',parentIds:['1','2']})])
  await capture('hzkj_orders',[{...header('1'),hzkj_operator_id:'9'}]);const entities=await rows('hz_fop_collected_entities'),old=entities.find((r:any)=>r.source_id==='uncreated'),unknown=entities.find((r:any)=>r.source_id==='timestamp_uncreated_unknown')
  expect(old.display.stage).toBe('uncreated');expect(old.display.rows).toHaveLength(1);expect(old.display.rows[0]).toMatchObject(demandRows[1]);expect(unknown.display.rows).toHaveLength(1);expect(unknown.display.rows[0].ownerEmployeeId).toBe('9');expect(unknown.display.stage).toBe('unknown')
 })

})
