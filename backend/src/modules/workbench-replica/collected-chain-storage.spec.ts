import { createHash } from 'node:crypto'
import { chainContentHash, chainSourceSignature, rebuildCollectedChain } from './collected-chain-storage'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DataSource, QueryRunner } from 'typeorm'
import { WORKBENCH_UP_SQL } from '../../database/workbench-schema.sql'
import { WorkbenchCollectedOrders1794411000000 } from '../../database/migrations/1794411000000-WorkbenchCollectedOrders'
import { CollectedEntities1794480000000 } from '../../database/migrations/1794480000000-CollectedEntities'
import { CollectedAnalyticsFacts1794500000000 } from '../../database/migrations/1794500000000-CollectedAnalyticsFacts'
import { CollectedBusinessChain1794580000000 } from '../../database/migrations/1794580000000-CollectedBusinessChain'
import { BusinessChainRelationIndexes1794581000000 } from '../../database/migrations/1794581000000-BusinessChainRelationIndexes'
it('schedule receipts do not invalidate facts while actual capture changes still do',()=>{
 const batch={id:'b',source_as_of:'now',metadata:{timestampSync:{orders:{watermark:'one'}}}}
 const expected=chainSourceSignature(batch)
 expect(chainSourceSignature({...batch,metadata:{...batch.metadata,timestampSchedule:{lastStatus:'running',nextAttemptAt:'later'}}})).toBe(expected)
 expect(chainSourceSignature({...batch,metadata:{timestampSync:{orders:{watermark:'two'}}}})).not.toBe(expected)
 expect(batch.metadata).not.toHaveProperty('timestampSchedule')
})

const database=process.env.CHAIN_STORAGE_TEST_DB
const integration=database&&/^hz_ddl_validation_[a-z0-9_]+$/.test(database)?describe:describe.skip
integration('business chain selective PostgreSQL writes',()=>{
 let db:DataSource,q:QueryRunner,schema:string,batch:string
 const captured='2026-11-18T00:00:00Z'
 beforeAll(async()=>{
  db=await new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,
   password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim(),synchronize:false}).initialize()
  q=db.createQueryRunner();await q.connect();schema='chain_writes_'+randomUUID().replaceAll('-','')
  await q.query(`CREATE SCHEMA ${schema}`);await q.query(`SET search_path TO ${schema}`)
  await q.query('CREATE TABLE users(id uuid PRIMARY KEY)')
  await q.query(WORKBENCH_UP_SQL.replaceAll('"public".',`"${schema}".`))
  await new WorkbenchCollectedOrders1794411000000().up(q)
  await new CollectedEntities1794480000000().up(q)
  await new CollectedAnalyticsFacts1794500000000().up(q)
  await new CollectedBusinessChain1794580000000().up(q)
  await new BusinessChainRelationIndexes1794581000000().up(q)
  await q.query(`CREATE TABLE chain_write_audit(table_name text,operation text,row_data jsonb);
   CREATE FUNCTION record_chain_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    INSERT INTO chain_write_audit VALUES(TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END);
    RETURN coalesce(NEW,OLD);
   END $$`)
  for(const table of ['hz_fop_source_documents','hz_fop_source_lines','hz_fop_fulfillment_orders','hz_fop_allocations','hz_fop_document_relations','hz_fop_order_relation_paths'])
   await q.query(`CREATE TRIGGER record_writes AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION record_chain_write()`)
 },30000)
 afterAll(async()=>{if(q){if(q.isTransactionActive)await q.rollbackTransaction();await q.query('SET search_path TO public');if(schema)await q.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await q.release()}await db?.destroy()})
 beforeEach(async()=>{
  await q.startTransaction();batch=randomUUID();const owner=randomUUID()
  await q.query('INSERT INTO users(id) VALUES($1)',[owner])
  await q.query("INSERT INTO hz_fop_collected_batches(id,workspace_owner_id,tenant_id,company_id,state,source_as_of) VALUES($1,$2,'tenant','100000','active',$3)",[batch,owner,captured])
  for(const id of ['1','2']){
   const order={id,billno:'TO'+id,org_id:'100000',hzkj_orders_billentry:[{id:'line'+id,hzkj_qty:'1'}]}
   const allocation={id:'a'+id,billno:'PH'+id,org_id:'100000',hzkj_order_id:id,hzkj_order_no:'TO'+id,billstatus:'A',hzkj_alloc_entry:[]}
   await q.query("INSERT INTO hz_fop_collected_orders(batch_id,source_id,order_number,search_text,display,raw) VALUES($1,$2,$3,'','{}',$4)",[batch,id,order.billno,JSON.stringify(order)])
   await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'allocation',$2,'','{}',$3,$4)",[batch,allocation.id,JSON.stringify(allocation),captured])
  }
  await rebuildCollectedChain(q.manager,batch);await q.query('TRUNCATE chain_write_audit')
 })
 afterEach(async()=>{if(q?.isTransactionActive)await q.rollbackTransaction()})
 const writes=():Promise<Array<{table_name:string;operation:string;row_data:Record<string,any>}>>=>q.query('SELECT table_name,operation,row_data FROM chain_write_audit ORDER BY table_name,operation')
 const change=async(id:string,fields:object)=>q.query("UPDATE hz_fop_collected_entities SET raw=raw||$3::jsonb WHERE batch_id=$1 AND entity_type='allocation' AND source_id=$2",[batch,id,JSON.stringify(fields)])
 it('reuses an unchanged graph without rewriting any documents, lines, relations or paths',async()=>{
  expect(await rebuildCollectedChain(q.manager,batch)).toHaveProperty('reused',true)
  expect(await writes()).toEqual([])
 })
 it('changes one source document without updating unchanged rows or rebuilding paths',async()=>{
  await change('a1',{billstatus:'C'});await rebuildCollectedChain(q.manager,batch)
  const rows=await writes()
  expect(rows.map(r=>[r.table_name,r.operation,r.row_data.source_id])).toEqual([['hz_fop_source_documents','UPDATE','a1']])
  expect((await q.query('SELECT count(*)::int n FROM hz_fop_order_relation_paths'))[0].n).toBe(2)
 })
 it('deletes only disappeared paths before relations and retains unrelated composite-key paths',async()=>{
  const before=await q.query('SELECT * FROM hz_fop_order_relation_paths ORDER BY order_document_id')
  await q.query("DELETE FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='allocation' AND source_id='a1'",[batch]);await rebuildCollectedChain(q.manager,batch)
  const after=await q.query('SELECT * FROM hz_fop_order_relation_paths')
  expect(after).toHaveLength(1);expect(before).toContainEqual(after[0])
  const events=(await writes()).filter(r=>r.table_name==='hz_fop_order_relation_paths')
  expect(events).toHaveLength(1);expect(events[0].operation).toBe('DELETE')
  expect(events[0].row_data.relation_id).not.toBe(after[0].relation_id)
  expect((await q.query('SELECT count(*)::int n FROM hz_fop_order_relation_paths p JOIN hz_fop_document_relations r ON r.company_id=p.company_id AND r.dataset_id=p.dataset_id AND r.id=p.relation_id'))[0].n).toBe(1)
  expect((await q.query("SELECT count(*)::int n FROM hz_fop_source_documents WHERE entity_code='hzkj_alloc_bill' AND source_id='a1'"))[0].n).toBe(0)
 })
 it('adds a path without rewriting the existing graph',async()=>{
  const allocation={id:'a3',billno:'PH3',org_id:'100000',hzkj_order_id:'1',hzkj_order_no:'TO1',billstatus:'A',hzkj_alloc_entry:[]}
  await q.query("INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,search_text,display,raw,captured_at) VALUES($1,'allocation','a3','','{}',$2,$3)",[batch,JSON.stringify(allocation),captured])
  await rebuildCollectedChain(q.manager,batch)
  expect((await writes()).map(r=>[r.table_name,r.operation])).toEqual([
   ['hz_fop_allocations','INSERT'],['hz_fop_document_relations','INSERT'],['hz_fop_order_relation_paths','INSERT'],['hz_fop_source_documents','INSERT'],
  ])
  expect((await q.query('SELECT count(*)::int n FROM hz_fop_order_relation_paths'))[0].n).toBe(3)
 })
 it('removes only the obsolete root when the same relation ID has another path',async()=>{
  const [first,second]=await q.query('SELECT * FROM hz_fop_order_relation_paths ORDER BY order_document_id')
  await q.query('INSERT INTO hz_fop_order_relation_paths VALUES($1,$2,$3,$4,$5)',[first.company_id,first.dataset_id,second.order_document_id,first.relation_id,'obsolete-root'])
  await q.query('TRUNCATE chain_write_audit');await change('a1',{billstatus:'C'});await rebuildCollectedChain(q.manager,batch)
  const events=(await writes()).filter(r=>r.table_name==='hz_fop_order_relation_paths')
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({operation:'DELETE',row_data:{order_document_id:second.order_document_id,relation_id:first.relation_id}})
  expect(await q.query('SELECT * FROM hz_fop_order_relation_paths ORDER BY order_document_id')).toEqual([first,second])
 })
 it('repairs a changed path basis without replacing its key or touching other paths',async()=>{
  const [target]=await q.query('SELECT * FROM hz_fop_order_relation_paths ORDER BY order_document_id LIMIT 1')
  await q.query('UPDATE hz_fop_order_relation_paths SET basis=$1 WHERE company_id=$2 AND dataset_id=$3 AND order_document_id=$4 AND relation_id=$5',['stale',target.company_id,target.dataset_id,target.order_document_id,target.relation_id])
  await q.query('TRUNCATE chain_write_audit');await change('a1',{billstatus:'C'});await rebuildCollectedChain(q.manager,batch)
  const events=(await writes()).filter(r=>r.table_name==='hz_fop_order_relation_paths')
  expect(events.map(r=>[r.operation,r.row_data])).toEqual([['UPDATE',target]])
 })
})
it('hashes a large collection item by item while preserving the original JSON hash',()=>{
 const ordered=[{name:'中文😀',raw:{id:'1',empty:null}},{raw:{id:'2',nested:['x',0,false]}}]
 const links={receipt:'order'},count=2
 const expected=createHash('sha256').update(JSON.stringify([3,ordered,links,count])).digest('hex')
 const original=JSON.stringify
 const spy=jest.spyOn(JSON,'stringify').mockImplementation(((v:any,...rest:any[])=>{
  if(v===ordered||Array.isArray(v)&&v.includes(ordered))throw Error('whole_collection_stringify_forbidden')
  return (original as any)(v,...rest)
 }) as any)
 try{expect(chainContentHash(ordered,links,count)).toBe(expected)}finally{spy.mockRestore()}
 expect(chainContentHash([],{},0)).toBe(createHash('sha256').update('[3,[],{},0]').digest('hex'))
})

it('production offline graph records the provided production origin and organization',async()=>{
 const {collectedDeploymentScope}=await import('./collected-chain-storage')
 expect(collectedDeploymentScope({metadata:{deploymentScope:{environment:'production',baseUrl:'https://fop.example.invalid',orgNumber:'prod-org'}}})).toEqual({environment:'production',baseUrl:'https://fop.example.invalid',orgNumber:'prod-org'})
})
