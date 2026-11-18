import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {parseEnv} from 'node:util'
import {randomUUID} from 'node:crypto'
import {DataSource,QueryRunner} from 'typeorm'
import {WorkbenchCollectedOrders1794411000000} from '../../database/migrations/1794411000000-WorkbenchCollectedOrders'
import {TimestampQueryReplica1794770000000} from '../../database/migrations/1794770000000-TimestampQueryReplica'
import {pruneTimestampPages} from './timestamp-maintenance'
const database=process.env.TIMESTAMP_PROJECTION_TEST_DB
const integration=database&&/^hz_timestamp_test_\d+$/.test(database)?describe:describe.skip
integration('bounded timestamp capture retention',()=>{
 let db:DataSource,q:QueryRunner,schema:string,batch:string,other:string
 beforeAll(async()=>{
  const e=parseEnv(readFileSync(resolve(__dirname,'../../../.env.workbench.local'),'utf8'))
  if(!['127.0.0.1','localhost'].includes(e.DB_HOST??'')||e.DB_PORT!=='55432')throw Error('isolated_database_required')
  db=await new DataSource({type:'postgres',host:e.DB_HOST,port:+e.DB_PORT,username:e.DB_USERNAME,password:e.DB_PASSWORD,database}).initialize()
  q=db.createQueryRunner();await q.connect();schema='retention_'+Date.now();await q.query(`CREATE SCHEMA ${schema}`);await q.query(`SET search_path TO ${schema},public`)
  await new WorkbenchCollectedOrders1794411000000().up(q);await new TimestampQueryReplica1794770000000().up(q)
  batch=randomUUID();other=randomUUID()
  for(const id of [batch,other])await q.query("INSERT INTO hz_fop_collected_batches(id,workspace_owner_id,tenant_id,company_id,state,source_as_of) VALUES($1,$2,'t','1','active',now())",[id,randomUUID()])
 })
 afterAll(async()=>{if(q){if(q.isTransactionActive)await q.rollbackTransaction();await q.query('SET search_path TO public');await q.query(`DROP SCHEMA ${schema} CASCADE`);await q.release()}await db?.destroy()})
 const run=async(age:number,state='applied',batchId=batch,entity='orders',mode='incremental')=>{
  const id=randomUUID();await q.query("INSERT INTO hz_fop_timestamp_runs(id,batch_id,entity_code,mode,state,started_at,finished_at) VALUES($1,$2,$3,$4,$5,now()-$6*interval '1 day',CASE WHEN $5='running' THEN NULL ELSE now()-$6*interval '1 day' END)",[id,batchId,entity,mode,state,age])
  await q.query("INSERT INTO hz_fop_timestamp_pages(run_id,page_index,query,documents,payload_hash) VALUES($1,0,'{}','[]','hash')",[id]);return id
 }
 it('deletes only eligible old payloads; retains running/recent/latest/unresolved/other-scope evidence and run receipts',async()=>{
  const old=await run(20),failed=await run(20,'failed'),recentFailure=await run(10,'failed'),recent=await run(1),running=await run(30,'running'),foreign=await run(30,'applied',other)
  const latestFull=await run(30,'applied',batch,'orders','reconcile')
  const unresolved=await run(25,'projection_pending',batch,'linked')
  await q.query("INSERT INTO hz_fop_timestamp_projection_tasks(batch_id,entity_code,source_id,run_id,state,removed) VALUES($1,'linked','1',$2,'pending',false)",[batch,unresolved])
  await run(1,'applied',batch,'linked')
  expect(await pruneTimestampPages(q,batch,1)).toEqual({deletedPages:1})
  expect(await pruneTimestampPages(q,batch,100)).toEqual({deletedPages:1})
  const retained=(await q.query('SELECT run_id FROM hz_fop_timestamp_pages')).map((r:{run_id:string})=>r.run_id)
  expect(retained).not.toContain(old);expect(retained).not.toContain(failed)
  for(const id of [recentFailure,recent,running,foreign,latestFull,unresolved])expect(retained).toContain(id)
  expect((await q.query('SELECT count(*)::int n FROM hz_fop_timestamp_runs'))[0].n).toBe(9)
 })
 it('rejects unbounded cleanup before any deletion',async()=>{
  await expect(pruneTimestampPages(q,batch,0)).rejects.toThrow('timestamp_retention_limit_invalid')
  await expect(pruneTimestampPages(q,batch,5001)).rejects.toThrow('timestamp_retention_limit_invalid')
 })
})
