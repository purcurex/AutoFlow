/* Offline native fulfillment outbound-time projection; raw source remains unchanged. */
const fs=require('node:fs'),path=require('node:path'),{parseEnv}=require('node:util')
require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true})
const {orderOutboundTime}=require('../backend/src/modules/fop-data/order-outbound-time')
async function run(){
 const apply=process.argv.includes('--apply');if(!apply&&!process.argv.includes('--dry-run'))throw Error('explicit_mode_required')
 const e=parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8'))
 if(!['127.0.0.1','localhost'].includes(e.DB_HOST))throw Error('local_database_required')
 const db=new(require('pg').Client)({host:e.DB_HOST,port:+e.DB_PORT,user:e.DB_USERNAME,password:e.DB_PASSWORD,database:e.DB_DATABASE});await db.connect()
 let scanned=0,changed=0,populated=0,invalid=0
 try{await db.query('BEGIN');const batches=(await db.query("SELECT id FROM hz_fop_collected_batches WHERE state='active' FOR UPDATE")).rows
 for(const b of batches){let cursor='';while(true){const rows=(await db.query('SELECT source_id,raw,display FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id>$2 ORDER BY source_id LIMIT 500 FOR UPDATE',[b.id,cursor])).rows;if(!rows.length)break
 const updates=[];for(const r of rows){const value=orderOutboundTime(r.raw.hzkj_outbound_time);scanned++;if(value)populated++;else if(r.raw.hzkj_outbound_time)invalid++;if(r.display.outboundCompletedAt!==value){changed++;updates.push({id:r.source_id,value})}}
 if(apply&&updates.length)await db.query("UPDATE hz_fop_collected_orders o SET display=jsonb_set(o.display,'{outboundCompletedAt}',coalesce(to_jsonb(x.value),'null'::jsonb)) FROM jsonb_to_recordset($2::jsonb) x(id text,value text) WHERE o.batch_id=$1 AND o.source_id=x.id",[b.id,JSON.stringify(updates)])
 cursor=rows.at(-1).source_id}
 if(apply)await db.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{outboundTimeProjection}',to_jsonb($2::text)) WHERE id=$1",[b.id,new Date().toISOString()])}
 await db.query(apply?'COMMIT':'ROLLBACK');console.log(JSON.stringify({apply,scanned,changed,populated,invalid,fopRequests:0}))
 }catch(e){await db.query('ROLLBACK');throw e}finally{await db.end()}
}
run().catch(e=>{console.error(e.message);process.exitCode=1})
