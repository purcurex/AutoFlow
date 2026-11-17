import { sameTimestampScope, sourceTime, sourceId, validateTimestampDocument, type TimestampSource, type TimestampScope, type TimestampQuery, type TimestampDocument } from './timestamp-sync'
type ObjectMap=Record<string,any>
type Action={path:string;body:ObjectMap}
export interface TimestampProfile {
 version:1; verified:boolean; verificationReference:string; tenantId:string; companyId:string; entityCode:string; orgNumber:string
 sourceTimezone:string; fullDetails:boolean; companyWide:boolean; stableKeyset:boolean; readOnly:boolean
 actions:Record<'clock'|'full'|'created'|'modified'|'exists',Action>
 response:{success:string;company:string;tenant:string;rows:string;complete:string;clock:string;exists:string}
 document:{id:string;company:string;created:string;modified:string;requiredArrays:string[]}
}
const at=(obj:unknown,path:string):any=>{
 if(typeof path!=='string'||!path||path.split('.').some(x=>!/^\w+$/.test(x)||['__proto__','prototype','constructor'].includes(x)))throw Error('timestamp_profile_path_invalid')
 return path.split('.').reduce((value:any,key)=>value&&Object.prototype.hasOwnProperty.call(value,key)?value[key]:undefined,obj)
}
function bind(value:unknown,vars:ObjectMap):unknown{
 if(typeof value==='string'&&/^\{\{\w+\}\}$/.test(value)){const key=value.slice(2,-2);if(!Object.prototype.hasOwnProperty.call(vars,key))throw Error('timestamp_template_unknown_variable');return vars[key]}
 if(typeof value==='string'&&value.includes('{{'))throw Error('timestamp_template_requires_exact_value')
 if(Array.isArray(value))return value.map(x=>bind(x,vars))
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>{if(['__proto__','constructor','prototype'].includes(k)||/token|secret|password/i.test(k))throw Error('timestamp_template_invalid_key');return [k,bind(v,vars)]}))
 return value
}
/** Explicit mappings to existing read APIs. No default URLs or guessed server filter syntax. */
export class TimestampHttpSource implements TimestampSource {
 constructor(private readonly profile:TimestampProfile,private readonly auth:{paused:()=>boolean;token:()=>Promise<string>;identity:string;tokenHeader?:string},private readonly request:typeof fetch=fetch){}
 assertReady(scope:TimestampScope){
  if(this.auth.paused())throw Error('fop_queries_paused')
  const p=this.profile
  if(p?.version!==1||!p.verified||!p.verificationReference?.trim()||!p.fullDetails||!p.companyWide||!p.stableKeyset||!p.readOnly)throw Error('timestamp_profile_unverified')
  if(!sameTimestampScope({...p,batchId:scope.batchId},scope))throw Error('timestamp_profile_scope_mismatch')
  if(!p.orgNumber||!p.sourceTimezone||!Array.isArray(p.document?.requiredArrays))throw Error('timestamp_profile_invalid')
  if(!this.auth.identity?.trim()||/[\r\n]/.test(this.auth.identity)||!['access_token','accessToken','accesstoken'].includes(this.auth.tokenHeader??'access_token'))throw Error('timestamp_credentials_not_configured')
  for(const name of ['clock','full','created','modified','exists'] as const){
   const action=p.actions?.[name]
   if(!action||!/^\/kapi\/[A-Za-z0-9_/-]+$/.test(action.path)||! /^(query|get|list|exists|read)/i.test(action.path.split('/').slice(-1)[0]??'')||!action.body||Array.isArray(action.body))throw Error('timestamp_profile_endpoint_invalid')
  }
 }
 private time(value:unknown):string|null{
  if(value===null||value===undefined||value==='')return null
  if(typeof value!=='string')throw Error('timestamp_invalid_time')
  let time=value.replace(' ','T')
  if(!/(Z|[+-]\d\d:\d\d)$/.test(time))time+=this.profile.sourceTimezone
  sourceTime(time);return time
 }
 private document(raw:ObjectMap,scope:TimestampScope):TimestampDocument{
  const m=this.profile.document
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('timestamp_document_invalid')
  for(const path of m.requiredArrays)if(!Array.isArray(at(raw,path)))throw Error('timestamp_partial_details')
  const d={id:sourceId(at(raw,m.id)),companyId:at(raw,m.company),createdAt:this.time(at(raw,m.created)),modifiedAt:this.time(at(raw,m.modified)),raw}
  validateTimestampDocument(d,scope);return d
 }
 private async call(scope:TimestampScope,actionName:keyof TimestampProfile['actions'],vars:ObjectMap={}){
  this.assertReady(scope)
  const action=this.profile.actions[actionName]
  const body=bind(action.body,{tenantId:scope.tenantId,companyId:scope.companyId,orgNumber:this.profile.orgNumber,entityCode:scope.entityCode,from:null,to:null,afterTime:null,afterId:null,limit:1,id:null,...vars})
  const token=await this.auth.token();this.assertReady(scope)
  if(!token||/[\r\n]/.test(token))throw Error('timestamp_credentials_not_configured')
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});reject(Error('timestamp_http_timeout'))},15000)})
  const read=async()=>{
   const response=await this.request('https://hyperzone.test.kdgalaxy.com'+action.path,{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json','x-acgw-identity':this.auth.identity,[this.auth.tokenHeader??'access_token']:token},body:JSON.stringify(body)})
   if(!response.ok||response.redirected||!response.body){void response.body?.cancel();throw Error('timestamp_http_failed')}
   if(Number(response.headers.get('content-length'))>8*1024*1024){void response.body.cancel();throw Error('timestamp_response_too_large')}
   reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0
   for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024)throw Error('timestamp_response_too_large');chunks.push(value)}
   const result=JSON.parse(Buffer.concat(chunks).toString('utf8'))
   if(at(result,this.profile.response.success)!==true || result.errorCode!==undefined&&!['0',0].includes(result.errorCode))throw Error('timestamp_source_rejected')
   if(at(result,this.profile.response.company)!==scope.companyId||at(result,this.profile.response.tenant)!==scope.tenantId)throw Error('timestamp_response_scope_invalid')
   return result
  }
  try{return await Promise.race([read(),timeout])}finally{clearTimeout(timer);controller.abort();void reader?.cancel().catch(()=>{})}
 }
 async clock(scope:TimestampScope){const value=this.time(at(await this.call(scope,'clock'),this.profile.response.clock));if(!value)throw Error('timestamp_source_clock_missing');return value}
 async page(scope:TimestampScope,query:TimestampQuery){
  const result=await this.call(scope,query.mode,{from:query.from??null,to:query.to??null,afterTime:query.after?.time??null,afterId:query.after?.id??null,limit:query.limit})
  const rows=at(result,this.profile.response.rows),complete=at(result,this.profile.response.complete)
  if(!Array.isArray(rows)||typeof complete!=='boolean')throw Error('timestamp_page_invalid')
  return {scope,rows:rows.map(raw=>this.document(raw,scope)),complete}
 }
 async exists(scope:TimestampScope,id:string){
  const result=await this.call(scope,'exists',{id:sourceId(id)}),exists=at(result,this.profile.response.exists)
  if(exists===false)return {scope,id,state:'absent' as const}
  const rows=at(result,this.profile.response.rows)
  if(exists!==true||!Array.isArray(rows)||rows.length!==1)throw Error('timestamp_existence_unconfirmed')
  const document=this.document(rows[0],scope)
  if(document.id!==id)throw Error('timestamp_existence_unconfirmed')
  return {scope,id,state:'present' as const,document}
 }
}
