import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { collectedWhere } from './collected-workbench-query'
const { Client } = require('pg')
const { refreshSalesSourceStatuses } = require('../../../../scripts/workbench-sales-source-status.cjs')
const integration=process.env.RUN_COLLECTED_SALES_SQL_TEST==='1'?describe:describe.skip

integration('sales status materialization and paged reads in isolated PostgreSQL TEMP tables',()=>{
 let client:any,db:any
 beforeAll(async()=>{
  const env=parseEnv(readFileSync(resolve(__dirname,'../../../.env.workbench.local'),'utf8'))
  if(env.DB_HOST!=='127.0.0.1'||env.DB_PORT!=='55432'||env.DB_DATABASE!=='autoflow_local_demo')throw Error('Only explicitly configured local test connection allowed')
  client=new Client({host:env.DB_HOST,port:+env.DB_PORT,user:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE})
  await client.connect();await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='15s'")
  db={query:async(sql:string,params?:unknown[])=>(await client.query(sql,params)).rows}
  // These names shadow public tables for this session only; ROLLBACK drops everything.
  await db.query(`CREATE TEMP TABLE hz_fop_collected_batches(id text,company_id text,source_as_of timestamptz,metadata jsonb);
   CREATE TEMP TABLE hz_fop_collected_orders(batch_id text,source_id text,order_number text,raw_order_status text,owner_employee_id text,raw jsonb,display jsonb NOT NULL);
   CREATE TEMP TABLE hz_fop_collected_analytics_facts(batch_id text,entity_type text,source_id text,company_id text,document_number text,raw jsonb,facts jsonb,captured_at timestamptz)`)
  await db.query(`INSERT INTO hz_fop_collected_batches VALUES('b','100000','2026-11-11T00:00:00Z','{}')`)
  for(const [id,status,owner,fulfillment]of [['a','no','alice','fulfilled'],['b','1','alice','partial'],['c','1','bob',null],['d','2','alice',null]]){
   await db.query(`INSERT INTO hz_fop_collected_orders VALUES('b',$1,$2,$3,$4,'{}','{"keep":"original"}')`,[id,'TO'+id,status,owner])
   await db.query(`INSERT INTO hz_fop_collected_analytics_facts VALUES('b','fulfillment',$1,'100000',$2,$3,'{"scope":{"verified":true}}','2026-11-12T00:00:00Z')`,[id,'TO'+id,JSON.stringify({hzkj_orderstatus:status,hzkj_fulfillment_status:fulfillment})])
  }
 })
 afterAll(async()=>{if(client){await client.query('ROLLBACK');await client.end()}})
 it('materializes idempotently, scopes list/count/selected reads before pagination, and clears stale supplements without rewriting raw',async()=>{
  expect(await refreshSalesSourceStatuses(db,'b',{dryRun:true})).toMatchObject({supplemented:4,sourceFulfilled:1,dryRun:true})
  expect((await db.query("SELECT display FROM hz_fop_collected_orders WHERE source_id='a'"))[0].display).toEqual({keep:'original'})
  expect(await refreshSalesSourceStatuses(db,'b')).toMatchObject({changed:4})
  expect(await refreshSalesSourceStatuses(db,'b')).toMatchObject({changed:0})
  const query=(ids:string[]|null,extra:Record<string,unknown>={})=>collectedWhere('b',ids,{queue:'unpaid',...extra})
  const q=query(null),self=query(['alice']),selected=query(['alice'],{mode:'selected',orderIds:['a','b','c']})
  expect(await db.query(`SELECT source_id FROM hz_fop_collected_orders WHERE ${q.where} ORDER BY source_id LIMIT 1 OFFSET 1`,q.params)).toEqual([{source_id:'c'}])
  expect(await db.query(`SELECT count(*)::int AS total FROM hz_fop_collected_orders WHERE ${q.where}`,q.params)).toEqual([{total:2}])
  for(const scoped of [self,selected])expect(await db.query(`SELECT source_id FROM hz_fop_collected_orders WHERE ${scoped.where}`,scoped.params)).toEqual([{source_id:'b'}])
  const empty=query([]);expect(await db.query(`SELECT source_id FROM hz_fop_collected_orders WHERE ${empty.where}`,empty.params)).toEqual([])
  await db.query("DELETE FROM hz_fop_collected_analytics_facts WHERE source_id='a'")
  expect(await refreshSalesSourceStatuses(db,'b')).toMatchObject({changed:1,supplemented:3})
  expect((await db.query("SELECT raw,display FROM hz_fop_collected_orders WHERE source_id='a'"))[0]).toEqual({raw:{},display:{keep:'original'}})
 })
})
