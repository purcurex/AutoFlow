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
 async function capture(entity:string,raws:any[]){const s={...scope,entityCode:entity};const prior=await db.query('SELECT 1 FROM hz_fop_timestamp_state WHERE batch_id=$1 AND entity_code=$2',[scope.batchId,entity]);return new TimestampPagedSync(new TimestampPostgresStore(db),{assertReady:()=>{},page:async()=>({scope:s,rows:raws.map(raw=>({id:raw.id,companyId:'100000',createdAt:'2026-11-15T00:00:00Z',modifiedAt:'2026-11-15T00:01:00Z',raw})),totalCount:raws.length,lastPage:true})},()=> new Date(Date.parse('2026-11-15T00:06:00Z')+(++tick)*1000).toISOString()).run(s,prior.length?'reconcile':'initialize')}
 const rows=(table:string)=>db.query('SELECT * FROM '+table+' WHERE batch_id=$1',[scope.batchId])
 beforeAll(async()=>{
  db=await new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim(),synchronize:false}).initialize()
  const [{ready}]=await db.query("SELECT to_regclass('hz_fop_timestamp_state') IS NOT NULL AS ready");if(ready)return;const q=db.createQueryRunner();try{await q.query('CREATE TABLE public.users(id uuid PRIMARY KEY)');for(const M of [AddWorkbenchSchemeA1794393001000,WorkbenchCollectedOrders1794411000000,CollectedEntities1794480000000,CollectedAnalyticsFacts1794500000000,CollectedBusinessChain1794580000000,TimestampQueryReplica1794770000000])await new M().up(q)}finally{await q.release()}
 })
 afterAll(async()=>{await db?.destroy()})
 beforeEach(async()=>{scope={batchId:randomUUID(),tenantId:'tenant',companyId:'100000',entityCode:'hzkj_orders'};const owner=randomUUID();await db.query('INSERT INTO users(id) VALUES($1)',[owner]);await db.query("INSERT INTO hz_fop_collected_batches(id,workspace_owner_id,tenant_id,company_id,state,source_as_of) VALUES($1,$2,'tenant','100000','active',now())",[scope.batchId,owner])})
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

 it('never assigns a partially resolved merged purchase amount or missing purchase lines to the surviving owner',async()=>{
  const header=(id:string,owner:string)=>({...order(id,owner),hzkj_orders_billentry:[{id:id+'1',seq:1,hzkj_qty:'2'}]})
  await capture('hzkj_orders',[header('1','7'),header('2','9')])
  const raw={id:'80',billno:'P80',organizationId:'100000',hzkj_cancelstatus:'A',hzkj_pay_status:'0',hzkj_purchase_channel:'2',hzkj_billentry:[{id:'81',hzkj_salbillnumber:'SO1',hzkj_salbillentryid:'11',hzkj_qty:'2'},{id:'82',hzkj_salbillnumber:'SO2',hzkj_salbillentryid:'21',hzkj_qty:'2'}]}
  const display={id:'80',association:{state:'verified'},rows:['1','2'].map((id,i)=>({orderId:id,ownerEmployeeId:i?'9':'7',lines:[{fulfillmentLineId:id+'1',purchaseLineId:String(81+i),quantity:2,shippedQuantity:null}]}))}
  await db.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at) VALUES($1,'purchase','80',$2,$3,'',now())",[scope.batchId,JSON.stringify(display),JSON.stringify(raw)])
  await db.query("INSERT INTO hz_fop_collected_analytics_facts(batch_id,entity_type,source_id,company_id,document_number,facts,raw,captured_at) VALUES($1,'purchase','80','100000','P80',$2,$3,now())",[scope.batchId,JSON.stringify({businessEligible:true,association:{sourceOrderIds:['1','2']}}),JSON.stringify(raw)])
  await capture('hzkj_orders',[order('1','7')])
  const fact=(await rows('hz_fop_collected_analytics_facts')).find((r:any)=>r.source_id==='80');expect(fact.owner_employee_id).toBeNull();expect(fact.facts.sourceOwnershipVerified).toBe(false)
  const p=(await rows('hz_fop_collected_entities')).find((r:any)=>r.source_id==='80');expect(p.display.rows[0].ownerEmployeeId).toBeNull();expect(p.display.rows[0].lines[0].fulfillmentLineId).toBeNull();expect(p.display.rows[1].ownerEmployeeId).toBe('9')
 })
 it('retains a purchase payment action proven by independent raw after a header refresh',async()=>{
  const rawOrder={...order('1'),hzkj_orders_billentry:[{id:'11',seq:1,hzkj_qty:'2'}]};await capture('hzkj_orders',[rawOrder])
  const raw={id:'80',billno:'P80',organizationId:'100000',hzkj_cancelstatus:'A',hzkj_pay_status:'0',hzkj_purchase_channel:'2',hzkj_billentry:[{id:'81',hzkj_salbillnumber:'SO1',hzkj_salbillentryid:'11',hzkj_qty:'2'}]},display={id:'80',association:{state:'verified'},rows:[{orderId:'1',ownerEmployeeId:'7',lines:[{fulfillmentLineId:'11',purchaseLineId:'81',quantity:2}]}]}
  await db.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,display,raw,search_text,captured_at) VALUES($1,'purchase','80',$2,$3,'',now())",[scope.batchId,JSON.stringify(display),JSON.stringify(raw)])
  await capture('hzkj_orders',[{...rawOrder,hzkj_operator_id:'9'}]);expect((await rows('hz_fop_collected_orders'))[0].display.procurementStage).toBe('payment_pending')
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
  expect(p.display.rows[0].lines[0]).toMatchObject({fulfillmentLineId:'12',quantity:1});expect((await rows('hz_fop_collected_orders'))[0].display.procurementStage).toBe('unknown')
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
