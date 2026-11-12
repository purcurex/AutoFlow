#!/usr/bin/env node
'use strict'
// Deliberately separate from application startup/workers. Requires an explicit one-shot invocation.
const fs=require('node:fs'),path=require('node:path'),{parseEnv}=require('node:util'),{randomUUID,createHash}=require('node:crypto')
const root=path.resolve(__dirname,'..'),backend=path.join(root,'backend')
require('ts-node').register({project:path.join(backend,'tsconfig.json'),transpileOnly:true})
require('reflect-metadata')
const {DataSource}=require('typeorm')
const {KingdeeFopDataProvider}=require(path.join(backend,'src/modules/fop-data/fop-kingdee.provider'))
const {importCollectedOrders,validateCollectedPage}=require(path.join(backend,'src/modules/fop-data/collected-order-import'))
const readEnv=file=>parseEnv(fs.readFileSync(file,'utf8'))
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'})
const sha=text=>createHash('sha256').update(text).digest('hex')
function args(argv){
 const result={}
 for(let i=0;i<argv.length;i++){
  const key=argv[i]
  if(['--fresh','--authorize-one-shot'].includes(key))result[key.slice(2)]=true
  else if(['--import','--output','--env','--db-env'].includes(key)){if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('invalid_arguments');result[key.slice(2)]=path.resolve(argv[++i])}
  else throw Error('invalid_arguments')
 }
 if(Boolean(result.fresh)===Boolean(result.import)||result.fresh&&!result['authorize-one-shot'])throw Error('explicit_fresh_authorization_required')
 return result
}
async function main(){
 const a=args(process.argv.slice(2)),config=readEnv(a.env||path.join(backend,'.env.fop.local')),db=readEnv(a['db-env']||path.join(backend,'.env.workbench.local'))
 // Persistent files must still disable all background work; only this private provider receives a temporary override.
 if(db.FOP_QUERIES_PAUSED!=='true'||db.WORKBENCH_SYNC_ENABLED!=='false'||db.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false')throw Error('persistent_pause_required')
 if(!db.DB_HOST||!db.DB_PORT||!db.DB_USERNAME||!db.DB_PASSWORD||!db.DB_DATABASE||/mock/i.test(db.DB_DATABASE))throw Error('explicit_real_database_required')
 const ds=new DataSource({type:'postgres',host:db.DB_HOST,port:Number(db.DB_PORT),username:db.DB_USERNAME,password:db.DB_PASSWORD,database:db.DB_DATABASE,ssl:db.DB_SSL==='true'?{rejectUnauthorized:true}:false,logging:false,synchronize:false})
 await ds.initialize()
 let output=a.import||a.output||path.join(root,'.runtime',`fop-collected-${new Date().toISOString().replace(/[:.]/g,'-')}`),manifest,context,provider
 try{
  if(!(await ds.query("SELECT to_regclass('public.hz_fop_collected_orders') AS name"))[0].name)throw Error('collected_migration_required')
  const admins=await ds.query("SELECT id,organization_workspace_owner_id FROM users WHERE email='admin@hzdrop.com' AND account_disabled=false AND business_role='admin'")
  if(admins.length!==1)throw Error('enabled_local_administrator_required')
  const owner=admins[0].organization_workspace_owner_id||admins[0].id
  if(a.fresh){
   if(config.FOP_KINGDEE_USERNAME!=='limingsong'||config.FOP_KINGDEE_TENANT_ID!=='hyperzone.test'||config.FOP_KINGDEE_ORGANIZATION_IDS!=='100000')throw Error('authorized_connection_mismatch')
   fs.mkdirSync(output,{mode:0o700})
   provider=new KingdeeFopDataProvider({get:k=>k==='FOP_QUERIES_PAUSED'?'false':config[k]})
   const connection=await provider.getConnectionContext()
   if(connection.subject.tenantId!=='hyperzone.test'||connection.currentOrganization.id!=='100000'||connection.subject.userId!==config.FOP_KINGDEE_USER_ID||!connection.resources.includes('orders'))throw Error('authenticated_subject_or_company_mismatch')
   context={tenantId:connection.subject.tenantId,userId:connection.subject.userId,companyId:connection.currentOrganization.id}
   // Verify directory context through the existing strict adapter; do not change bindings/grants.
   let cursor,scopeVersion,directoryRows=0,directoryPages=0,activeOperator=false
   do{
    if(++directoryPages>100)throw Error('directory_page_limit')
    const p=await provider.listBindingEmployees(cursor,scopeVersion)
    directoryRows+=p.items.length
    activeOperator ||= p.items.some(e=>e.username==='limingsong'&&e.state==='active'&&[e.id,e.masterId].includes(context.userId))
    cursor=p.nextCursor;scopeVersion=p.scopeVersion
   }while(cursor)
   if(!activeOperator)throw Error('active_integration_employee_required')
   manifest={version:1,captureId:randomUUID(),startedAt:new Date().toISOString(),context,directory:{pages:directoryPages,rows:directoryRows,verified:true},pages:[],complete:false}
  }else{
   manifest=JSON.parse(fs.readFileSync(path.join(output,'manifest.json'),'utf8'));context=manifest.context
   if(manifest.version!==1||!manifest.complete||!Array.isArray(manifest.pages)||!manifest.pages.length||!manifest.captureId||!manifest.startedAt||context?.tenantId!=='hyperzone.test'||context?.companyId!=='100000'||!manifest.directory?.verified)throw Error('invalid_completed_capture')
  }
  async function* pages(){
   let after=null,index=0
   do{
    if(++index>10000)throw Error('capture_page_limit')
    const name=`raw-orders-page-${String(index).padStart(4,'0')}.json`
    let rawText,data
    if(a.fresh){
     data=await provider.call('FOP_KINGDEE_QUERY_URL',{query:{tenantId:context.tenantId,userId:context.userId,organizationIds:[context.companyId],scopeRole:'admin',queue:'review',rawWorkbenchFacts:true,page:1,pageSize:100,...(after?{afterOrderId:after}:{})}})
     rawText=JSON.stringify({status:true,errorCode:'0',data})
     fs.writeFileSync(path.join(output,name),rawText,{mode:0o600,flag:'wx'})
     manifest.pages.push({file:name,sha256:sha(rawText),rows:data.items?.length})
    }else{
     const entry=manifest.pages[index-1]
     if(!entry||entry.file!==name)throw Error('capture_page_sequence_mismatch')
     rawText=fs.readFileSync(path.join(output,name),'utf8')
     if(sha(rawText)!==entry.sha256)throw Error('capture_hash_mismatch')
     const envelope=JSON.parse(rawText)
     if(envelope.status!==true||String(envelope.errorCode)!=='0')throw Error('capture_envelope_failed')
     data=envelope.data
    }
    const checked=validateCollectedPage(data,context,index,after);after=checked.next
    yield {data,rawText}
    if(index%25===0)process.stdout.write(JSON.stringify({stage:'staging',pages:index,rows:manifest.pages.slice(0,index).reduce((n,p)=>n+p.rows,0)})+'\n')
   }while(after)
   if(a.fresh){manifest.complete=true;manifest.completedAt=new Date().toISOString();save(path.join(output,'manifest.json'),manifest)}
   else if(index!==manifest.pages.length)throw Error('capture_extra_pages')
  }
  const result=await importCollectedOrders(ds,pages(),{...context,workspaceOwnerId:owner,captureId:manifest.captureId,startedAt:manifest.startedAt,warehouseMap:JSON.parse(config.FOP_KINGDEE_WAREHOUSE_MAP||'{}'),metadata:{source:'legacy_employee_orders_page',directoryVerified:true}})
  const report={...result,capturedAt:manifest.startedAt,completedAt:new Date().toISOString(),mode:'collected',readOnly:true,consistentSnapshot:false,automaticCallsEnabled:false,formalReplicaActivated:false}
  const reportFile=path.join(output,`import-report-${Date.now()}.json`);save(reportFile,report)
  process.stdout.write(JSON.stringify({...report,output})+'\n')
 }finally{await ds.destroy()}
}
main().catch(error=>{const code=typeof error.message==='string'&&/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'collected_initialization_failed';process.stderr.write(JSON.stringify({error:code})+'\n');process.exitCode=1})
