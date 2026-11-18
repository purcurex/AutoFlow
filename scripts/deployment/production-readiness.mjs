import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {readSyncConfig} from '../workbench-sync-runtime.mjs'
import {scheduledPreflight} from '../workbench-scheduled-sync.mjs'
export function productionReadiness(config){
 const missingDatabase=[],missingSource=[]
 const placeholder=v=>!v?.trim()||/replace[-_ ]|待提供|待填写|example\.com|smtp\.invalid/i.test(v)
 for(const key of ['DB_HOST','DB_DATABASE','DB_USERNAME','DB_PASSWORD','JWT_SECRET','SMTP_HOST','SMTP_USER','SMTP_PASS'])if(placeholder(config[key]))missingDatabase.push(key)
 if(config.NODE_ENV!=='production')missingDatabase.push('NODE_ENV=production')
 if((config.JWT_SECRET??'').length<32)missingDatabase.push('JWT_SECRET.length>=32')
 for(const key of ['DB_SYNCHRONIZE','DB_MIGRATIONS_RUN','WORKBENCH_SYNC_ENABLED','WORKBENCH_AUTOMATIC_CALLS_ENABLED','WORKBENCH_TIMESTAMP_SYNC_ENABLED'])if(config[key]!=='false')missingDatabase.push(key+'=false')
 if(config.FOP_QUERIES_PAUSED!=='true')missingDatabase.push('FOP_QUERIES_PAUSED=true')
 if(config.WORKBENCH_READ_MODE!=='local'||config.WORKBENCH_MOCK_ENABLED!=='false')missingDatabase.push('local_non_mock_mode')
 if(config.DB_SSL==='true'&&config.DB_SSL_REJECT_UNAUTHORIZED!=='true')missingDatabase.push('DB_SSL_REJECT_UNAUTHORIZED=true')
 const keys=['FOP_REPLICA_TENANT_ID','FOP_REPLICA_COMPANY_ID','FOP_REPLICA_ORG_NUMBER','FOP_OPENAPI_BASE_URL','FOP_OPENAPI_ALLOWED_ORIGIN','FOP_KINGDEE_TENANT_ID','FOP_KINGDEE_ORGANIZATION_IDS','FOP_KINGDEE_USER_ID','FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL','FOP_KINGDEE_TOKEN_URL']
 for(const prefix of ['FOP_KINGDEE_','FOP_OPENAPI_'])for(const key of ['IDENTITY','CLIENT_ID','CLIENT_SECRET','ACCOUNT_ID','USERNAME'])keys.push(prefix+key)
 for(const key of keys)if(placeholder(config[key]))missingSource.push(key)
 if(config.WORKBENCH_TIMESTAMP_ENVIRONMENT!=='production')missingSource.push('WORKBENCH_TIMESTAMP_ENVIRONMENT=production')
 if(config.FOP_DATA_MODE!=='kingdee')missingSource.push('FOP_DATA_MODE=kingdee')
 const sourceCheck=scheduledPreflight({...config,WORKBENCH_TIMESTAMP_ENVIRONMENT:'production',FOP_QUERIES_PAUSED:'false',WORKBENCH_SYNC_ENABLED:'true',WORKBENCH_AUTOMATIC_CALLS_ENABLED:'true',WORKBENCH_TIMESTAMP_SYNC_ENABLED:'true',WORKBENCH_COLLECTED_ENABLED:'true'})
 return {databaseReady:missingDatabase.length===0,sourceConfigurationReady:missingSource.length===0&&sourceCheck.executable,missingDatabase:[...new Set(missingDatabase)],missingSource,sourceBlockers:sourceCheck.blockedReasons,upstreamCalled:false,productionAcceptancePending:true}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const report=productionReadiness(readSyncConfig());console.log(JSON.stringify(report,null,2));if(!report.databaseReady||process.argv.includes('--require-source')&&!report.sourceConfigurationReady)process.exitCode=1
}
