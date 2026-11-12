import { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { WorkbenchCollectedOrders1794411000000 } from '../../database/migrations/1794411000000-WorkbenchCollectedOrders'
import { importCollectedOrders, type CollectedPage } from './collected-order-import'
const describeDb=process.env.COLLECTED_DATABASE_TEST==='true'?describe:describe.skip
describeDb('collected import database publication',()=>{
 let admin:DataSource,ds:DataSource
 const schema=`collected_test_${randomUUID().replace(/-/g,'')}`
 const context={workspaceOwnerId:randomUUID(),tenantId:'test',userId:'10',companyId:'100000',startedAt:'2026-11-12T00:00:00Z'}
 const row=(id:string)=>({id,billno:`TO-${id}`,hzkj_org:{id:'100000'},hzkj_orders_billentry:[{hzkj_qty:'2'}]})
 const page=(ids:string[],more=false,index=1):CollectedPage=>{const data={workbenchFactsSchemaVersion:1,queue:'review',subject:{tenantId:'test',userId:'10'},organizationIds:['100000'],page:1,pageSize:100,items:ids.map(row),hasMore:more,nextAfterOrderId:more?ids[ids.length-1]:null};return {data,rawText:JSON.stringify(data)}}
 async function* pages(...p:CollectedPage[]){yield* p}
 beforeAll(async()=>{
  const env=parseEnv(readFileSync(resolve(__dirname,'../../../.env.workbench.local'),'utf8'))
  if(!['127.0.0.1','localhost'].includes(env.DB_HOST||''))throw Error('local_test_only')
  const config={type:'postgres' as const,host:env.DB_HOST,port:Number(env.DB_PORT),username:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE,synchronize:false,logging:false}
  admin=await new DataSource(config).initialize();await admin.query(`CREATE SCHEMA ${schema}`)
  ds=await new DataSource({...config,extra:{options:`-c search_path=${schema}`}}).initialize()
  const q=ds.createQueryRunner();try{await q.connect();await new WorkbenchCollectedOrders1794411000000().up(q)}finally{await q.release()}
 })
 afterAll(async()=>{if(ds?.isInitialized)await ds.destroy();if(admin?.isInitialized){await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.destroy()}})
 it('publishes complete pages, leaves failed partial capture invisible, and reuses completed capture',async()=>{
  const captureId=randomUUID()
  const first=await importCollectedOrders(ds,pages(page(['9007199254740993123'])),{...context,captureId})
  expect(first.rowCount).toBe(1)
  expect((await ds.query("SELECT state FROM hz_fop_collected_batches WHERE id=$1",[first.batchId]))[0].state).toBe('active')
  await expect(importCollectedOrders(ds,pages(page(['9007199254740993124'],true)),{...context,captureId:randomUUID()})).rejects.toThrow('collected_incomplete_capture')
  expect((await ds.query("SELECT count(*)::int AS n FROM hz_fop_collected_batches WHERE state='active'"))[0].n).toBe(1)
  expect((await ds.query("SELECT count(*)::int AS n FROM hz_fop_collected_batches WHERE state='failed'"))[0].n).toBe(1)
  const rerun=await importCollectedOrders(ds,pages(page(['9007199254740993123'])),{...context,captureId})
  expect(rerun).toMatchObject({reused:true,batchId:first.batchId})
  const second=await importCollectedOrders(ds,pages(page(['9007199254740993124'],true),page(['9007199254740993125'],false,2)),{...context,captureId:randomUUID()})
  expect(second.rowCount).toBe(2)
  expect((await ds.query("SELECT state FROM hz_fop_collected_batches WHERE id=$1",[first.batchId]))[0].state).toBe('superseded')
  expect((await ds.query("SELECT count(*)::int AS n FROM hz_fop_collected_orders WHERE batch_id=$1 AND total_amount IS NULL AND currency_code IS NULL",[second.batchId]))[0].n).toBe(2)
 })
})
