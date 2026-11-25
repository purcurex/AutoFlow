import {mkdirSync,rmSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {catalogOperations,captureCatalog} from './workbench-authorized-catalog-capture.mjs'
import {importCatalogues} from './workbench-authorized-catalog-import.mjs'
import {syncScope,syncRuntimeRequire} from './workbench-sync-runtime.mjs'
import {seedRelationCompensation,refreshRelations,fatalRelationRead} from './workbench-automatic-relations.mjs'
/** Shared scheduler lock spans capture, publication, reconstruction and relation work. */
export async function runAutomaticCatalogues({config,db,batchId,prepared,enabled,getSourceBlock=()=>null,now=()=>new Date()}){
 const rt=syncRuntimeRequire(config),scope={...syncScope(config),userId:config.FOP_KINGDEE_USER_ID,orgName:config.FOP_REPLICA_ORG_NAME||((config.FOP_REPLICA_TENANT_ID==='hyperzone.test')?'杭州华智云服科技有限公司':undefined)}
 const [b]=await db.query('SELECT metadata FROM hz_fop_collected_batches WHERE id=$1 AND state=\'active\'',[batchId]);if(!b)throw Error('timestamp_batch_scope_changed')
 const state={...b.metadata?.catalogSchedule},reports=[];let changed=false
 for(const operation of catalogOperations){if(!enabled()||getSourceBlock())break
 const prior=state[operation];if(Date.parse(prior?.nextAttemptAt)>now().getTime()){reports.push({operation,status:'backoff'});continue}
 let fatal
 const dir=resolve(config.WORKBENCH_CAPTURE_DIRECTORY||'.runtime/automatic-catalog',batchId,randomUUID());mkdirSync(dir,{recursive:true,mode:0o700})
 try{
 if(operation==='customer-registrations'&&!scope.orgName)throw Error('catalog_organization_name_required')
 const manifest=await captureCatalog(prepared.query,operation,resolve(dir,operation),scope)
 if(!manifest.complete)throw Error(manifest.error||'catalog_incomplete')
 const [result]=await importCatalogues({config,db,directory:dir,only:[operation]});if(!result?.imported)throw Error(result?.error||'catalog_import_failed')
 changed ||= !result.unchanged
 const status=result.consumptionIssue?'partial':'succeeded';state[operation]={checkedAt:now().toISOString(),rows:manifest.rows,failures:0,nextAttemptAt:null,status,...(result.consumptionIssue?{error:result.consumptionIssue}:{})};reports.push({...result,status})
 }catch(error){const failures=(prior?.failures||0)+1;const code=/^[a-z_]+$/.test(error.message)?error.message:'catalog_publish_failed';state[operation]={...prior,status:'failed',failures,error:code,nextAttemptAt:new Date(now().getTime()+Math.min(120,30*2**Math.min(failures-1,2))*60000).toISOString()};reports.push({operation,status:'failed',error:code});if(fatalRelationRead(error.message))fatal=error}
 finally{rmSync(dir,{recursive:true,force:true})}
 await db.query("UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{catalogSchedule}',$2::jsonb) WHERE id=$1 AND state='active'",[batchId,JSON.stringify(state)])
 if(fatal)throw fatal
 }
 // Rebuild once per catalogue cycle, including dirty sources left by interrupted publication.
 const [{count}]=await db.query('SELECT count(*)::int count FROM hz_fop_relation_dirty_sources WHERE batch_id=$1',[batchId]);
 if(changed||count){const {rebuildCollectedChain}=rt('workbench-replica/collected-chain-storage');await db.transaction('REPEATABLE READ',q=>rebuildCollectedChain(q,batchId))}
 await seedRelationCompensation(db,batchId)
 const {normalizeApiRelations}=rt('workbench-replica/collected-api-relations')
 const relations=await refreshRelations({db,batchId,query:prepared.query,normalize:normalizeApiRelations,limit:Math.max(1,Math.min(2000,Number(config.WORKBENCH_RELATION_REFRESH_LIMIT)||500)),enabled:()=>enabled()&&!getSourceBlock()})
 return {catalogues:reports,relations}
}
