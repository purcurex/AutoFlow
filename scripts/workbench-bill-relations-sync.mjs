#!/usr/bin/env node
// Explicit repair uses the same durable queue and generation guards as automatic sync.
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {readSyncConfig,syncDatabaseOptions,syncRuntimeRequire,syncScope} from './workbench-sync-runtime.mjs'
import {prepareTimestampPagedExecution} from './workbench-timestamp-sync.mjs'
import {scheduledProfile,scheduledPageQuery} from './workbench-scheduled-sync.mjs'
import {runQuery} from './fop-workbench-openapi.mjs'
import {getToken} from './fop-openapi-smoke.mjs'
import {seedRelationCompensation,refreshRelations} from './workbench-automatic-relations.mjs'
async function main(){
 const args=process.argv.slice(2);if(args[0]!=='--execute'||args.length>2)throw Error('usage: --execute [exact-order-number]')
 const c=readSyncConfig(),r=createRequire(resolve('backend/package.json')),rt=syncRuntimeRequire(c),scope=syncScope(c)
 if(c.FOP_QUERIES_PAUSED==='true')throw Error('fop_queries_paused')
 const db=await new(r('typeorm').DataSource)(syncDatabaseOptions(c)).initialize(),q=db.createQueryRunner()
 try{await q.connect();const key=`timestamp-scheduled:${scope.tenantId}:${scope.companyId}`;const [lock]=await q.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) acquired',[key]);if(!lock.acquired)throw Error('timestamp_scope_busy')
 const bs=await db.query("SELECT id FROM hz_fop_collected_batches WHERE state='active' AND tenant_id=$1 AND company_id=$2",[scope.tenantId,scope.companyId]);if(bs.length!==1)throw Error('active_batch_ambiguous')
 const {KingdeeFopDataProvider}=rt('fop-data/fop-kingdee.provider'),{normalizeApiRelations}=rt('workbench-replica/collected-api-relations');let last=0
 const request=async(...p)=>{await new Promise(r=>setTimeout(r,Math.max(0,500-(Date.now()-last))));last=Date.now();return fetch(...p)}
 const provider=new KingdeeFopDataProvider({get:k=>c[k]},request),enabled=()=>readSyncConfig().FOP_QUERIES_PAUSED!=='true'
 const prepared=await prepareTimestampPagedExecution(c,scheduledProfile('hzkj_orders',c),{getConnection:()=>provider.getConnectionContext(),acquireToken:v=>getToken(v,request),query:(v,p)=>scheduledPageQuery({parameters:p,enabled,query:()=>runQuery(v,p,request)})})
 await seedRelationCompensation(db,bs[0].id)
 if(args[1])await db.query('UPDATE hz_fop_relation_refresh SET requested_version=requested_version+1,next_attempt_at=now() WHERE batch_id=$1 AND root_number=$2',[bs[0].id,args[1]])
 console.log(JSON.stringify(await refreshRelations({db,batchId:bs[0].id,query:prepared.query,normalize:normalizeApiRelations,number:args[1]??null,enabled})))
 await q.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key])
 }finally{await q.release();await db.destroy()}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve('scripts/workbench-bill-relations-sync.mjs'))main().catch(e=>{console.error(e.message);process.exitCode=1})
