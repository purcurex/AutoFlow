import { sourceTime, sourceId, sameTimestampScope, validateTimestampDocument, type TimestampScope, type TimestampDocument } from './timestamp-sync'
import { type TimestampNumberedSource, type TimestampNumberedQuery } from './timestamp-paged-sync'

export const TIMESTAMP_PAGED_OPERATIONS={
 'hzkj_orders':{operation:'order-list',entries:['hzkj_orders_billentry']},
 'hzkj_alloc_bill':{operation:'allocation',entries:['hzkj_alloc_entry']},
 'hzkj_deliver_bill':{operation:'dispatch',entries:['hzkj_logisticstrackentry']},
 'hzkj_deliver_order':{operation:'delivery-notice',entries:['entryentity']},
} as const
export interface TimestampPagedProfile {
 version:2; protocol:'ordinary_modified_pages'; tenantId:string;companyId:string;entityCode:string;orgNumber:string
 packageVersion:'2026-11-16'; readOnly:true; acknowledgeEventualConsistency:boolean
}
type QueryTransport=(parameters:Record<string,unknown>)=>Promise<{report:{success:boolean};rows:unknown[];raw:string|null}>
/** Parse the observed native AND grammar, never predicates embedded in quoted values.
 * This binds the company filter only; it is not evidence of account-wide source coverage. */
export function assertCompanyConjunction(filter:unknown,companyId:string,orgNumber:string):void {
 const fail=():never=>{throw Error('timestamp_response_scope_invalid')}
 if(typeof filter!=='string'||filter.length>16000)fail()
 let rest=(filter as string).trim()
 // Native QFilter.toString() wraps the complete expression in square brackets.
 if(rest.startsWith('[')&&rest.endsWith(']'))rest=rest.slice(1,-1)
 const tokens:string[]=[]
 while(rest.trim()){
  const match=/^\s*('(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_.]*|[0-9]+|>=|<=|<>|=|>|<|\(|\)|,)/.exec(rest)
  if(!match)fail()
  tokens.push(match![1]);rest=rest.slice(match![0].length)
 }
 let i=0,proven=false
 const peek=(token:string)=>tokens[i]?.toLowerCase()===token
 const literal=():string=>{
  const token=tokens[i++]
  if(!token||!/^(?:[0-9]+|'(?:[^']|'')*')$/.test(token))fail()
  return token.startsWith("'")?token.slice(1,-1).replace(/''/g,"'"):token
 }
 const expression=(depth:number):void=>{
  if(depth>32)fail()
  const term=()=>{
   if(peek('(')){i++;expression(depth+1);if(!peek(')'))fail();i++;return}
   const field=tokens[i++]?.toLowerCase()
   // These are the fields present in the four published query responses.
   if(!['org','org.id','org.number','hzkj_billtype.number','modifytime','createtime','1'].includes(field))fail()
   const op=tokens[i++]?.toLowerCase();let values:string[]
   if(op==='in'){
    if(!peek('('))fail();i++;values=[literal()]
    while(peek(',')){i++;values.push(literal())}
    if(!peek(')'))fail();i++
   }else{if(!['=','>=','<=','>','<','<>'].includes(op))fail();values=[literal()]}
   if(field==='org'||field==='org.id'){
    if(!['=','in'].includes(op)||values.length!==1||values[0]!==companyId)fail()
    proven=true
   }
   if(field==='org.number'&&(!['=','in'].includes(op)||values.length!==1||values[0]!==orgNumber))fail()
   if(field==='1'&&(op!=='='||values.length!==1||values[0]!=='1'))fail()
  }
  term();while(peek('and')){i++;term()}
 }
 expression(0)
 if(i!==tokens.length||!proven)fail()
}
/** Uses the existing bounded/paused OpenAPI transport. Tenant is configuration context, not a fabricated server proof. */
export class TimestampPagedSource implements TimestampNumberedSource {
 get ordering():'modified'|'id'{return this.profile.entityCode==='hzkj_orders'?'id':'modified'}
 private directory:{key:string;ids:string[]}|null=null
 constructor(private readonly profile:TimestampPagedProfile,private readonly paused:()=>boolean,private readonly query:QueryTransport,private readonly identityBasis?:Record<string,unknown>){}
 captureIdentityBasis(){return this.identityBasis??null}
 assertReady(scope:TimestampScope){
  if(this.paused())throw Error('fop_queries_paused')
  const p=this.profile
  if(p?.version!==2||p.protocol!=='ordinary_modified_pages'||p.packageVersion!=='2026-11-16'||p.readOnly!==true||p.acknowledgeEventualConsistency!==true||!Object.prototype.hasOwnProperty.call(TIMESTAMP_PAGED_OPERATIONS,p.entityCode))throw Error('timestamp_profile_unverified')
  if(!sameTimestampScope({...p,batchId:scope.batchId},scope)||!/^[A-Za-z0-9_.-]{1,100}$/.test(p.tenantId)||!/^[1-9]\d{0,18}$/.test(p.companyId)||!/^[A-Za-z0-9_.-]{1,100}$/.test(p.orgNumber))throw Error('timestamp_profile_scope_mismatch')
 }
 private time(value:unknown):string|null{
  if(value===null||value===undefined||value==='')return null
  if(typeof value!=='string')throw Error('timestamp_invalid_time')
  let time=value.replace(' ','T');if(!/(Z|[+-]\d\d:\d\d)$/.test(time))time+='+08:00'
  sourceTime(time);return time
 }
 async page(scope:TimestampScope,q:TimestampNumberedQuery){
  this.assertReady(scope)
  if(!Number.isInteger(q.pageNo)||q.pageNo<1||q.pageNo>1000||!Number.isInteger(q.pageSize)||q.pageSize<1||q.pageSize>100||sourceTime(q.from)>=sourceTime(q.to))throw Error('timestamp_page_invalid')
  const definition=TIMESTAMP_PAGED_OPERATIONS[this.profile.entityCode as keyof typeof TIMESTAMP_PAGED_OPERATIONS]
  // DTS DateTime examples use UTC+8 wall-clock seconds; the persisted W uses the exact same instant.
  const wall=(v:string)=>{const t=sourceTime(v);if(t%1000000000n!==0n)throw Error('timestamp_window_precision');return new Date(Number(t/1000000n)+8*3600000).toISOString().slice(0,19).replace('T',' ')}
  if(this.profile.entityCode==='hzkj_orders'){
   const key=JSON.stringify([scope,q.from,q.to,q.pageSize])
   if(q.pageNo===1){
    this.directory=null
    const result=await this.query({operation:'fulfillment-ids',orgNumber:this.profile.orgNumber,startModifytime:wall(q.from),endModifytime:wall(q.to),saveResponse:true})
    this.assertReady(scope)
    if(!result.report.success||!result.raw)throw Error('timestamp_source_rejected')
    const d=JSON.parse(result.raw).data
    if(d?.tenantId!==scope.tenantId||d.organizationId!==scope.companyId||d.orgNumber!==this.profile.orgNumber||d.formId!=='hzkj_orders'||!Array.isArray(d.ids)||!/^\d+$/.test(String(d.total))||BigInt(d.total)!==BigInt(d.ids.length)||d.ids.length>100000)throw Error('timestamp_directory_scope_invalid')
    const ids=d.ids.map(sourceId)
    if(ids.some((id:string,i:number)=>i>0&&BigInt(id)<=BigInt(ids[i-1])))throw Error('timestamp_directory_invalid')
    this.directory={key,ids}
   }
   if(!this.directory||this.directory.key!==key)throw Error('timestamp_directory_required')
   const ids=this.directory.ids.slice((q.pageNo-1)*q.pageSize,q.pageNo*q.pageSize),totalCount=this.directory.ids.length
   if(!ids.length){if(q.pageNo!==1||totalCount!==0)throw Error('timestamp_page_invalid');return {scope,rows:[],totalCount,lastPage:true}}
   const result=await this.query({operation:'order-list',orgNumber:this.profile.orgNumber,ids,pageNo:1,pageSize:q.pageSize,saveResponse:true})
   this.assertReady(scope)
   if(!result.report.success||!result.raw)throw Error('timestamp_source_rejected')
   const data=JSON.parse(result.raw).data
   if(!data||data.totalCount!==ids.length||data.lastPage!==true||data.pageNo!==1||data.pageSize!==q.pageSize||!Array.isArray(data.rows)||data.rows.length!==ids.length)throw Error('timestamp_id_batch_incomplete')
   const byId=new Map<string,any>()
   for(const raw of data.rows){if(!raw||typeof raw.id!=='string'||!ids.includes(raw.id)||byId.has(raw.id)||raw.org_id!==undefined&&raw.org_id!==scope.companyId||raw.org_number!==undefined&&raw.org_number!==this.profile.orgNumber)throw Error('timestamp_document_scope_invalid');byId.set(raw.id,raw)}
   const rows:TimestampDocument[]=ids.map((id:string)=>{
    const raw=byId.get(id)
    for(const entry of definition.entries)if(raw[entry]!==null&&!Array.isArray(raw[entry]))throw Error('timestamp_partial_details')
    const row={id,companyId:scope.companyId,createdAt:this.time(raw.createtime),modifiedAt:this.time(raw.modifytime),raw}
    validateTimestampDocument(row,scope)
    if(!row.modifiedAt||sourceTime(row.modifiedAt)<sourceTime(q.from)||sourceTime(row.modifiedAt)>=sourceTime(q.to))throw Error('timestamp_row_outside_window')
    return row
   })
   return {scope,rows,totalCount,lastPage:q.pageNo*q.pageSize>=totalCount}
  }
  const result=await this.query({operation:definition.operation,orgNumber:this.profile.orgNumber,startModifytime:wall(q.from),endModifytime:wall(q.to),pageNo:q.pageNo,pageSize:q.pageSize,saveResponse:true})
  this.assertReady(scope)
  if(!result?.report?.success||!result.raw)throw Error('timestamp_source_rejected')
  let envelope:any;try{envelope=JSON.parse(result.raw)}catch{throw Error('timestamp_page_invalid')}
  const data=envelope.data
  if(envelope.status!==true||!['0',0].includes(envelope.errorCode)||!data||data.pageNo!==q.pageNo||data.pageSize!==q.pageSize||!Array.isArray(data.rows)||!Number.isSafeInteger(data.totalCount)||data.totalCount<0||typeof data.lastPage!=='boolean')throw Error('timestamp_page_invalid')
  // Existing queries expose applied filters. This checks requested company binding only;
  // it does not certify integration-account coverage, tenant scope or a snapshot.
  assertCompanyConjunction(data.filter,scope.companyId,this.profile.orgNumber)
  const rows:TimestampDocument[]=data.rows.map((raw:any)=>{
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('timestamp_document_invalid')
   if(raw.org_id!==undefined&&raw.org_id!==scope.companyId||raw.org_number!==undefined&&raw.org_number!==this.profile.orgNumber)throw Error('timestamp_document_scope_invalid')
   // Native API serializes empty collections as explicit null; omission is still incomplete.
   for(const key of definition.entries)if(raw[key]!==null&&!Array.isArray(raw[key]))throw Error('timestamp_partial_details')
   const row={id:sourceId(raw.id),companyId:scope.companyId,createdAt:this.time(raw.createtime),modifiedAt:this.time(raw.modifytime),raw}
   validateTimestampDocument(row,scope);return row
  })
  return {scope,rows,totalCount:data.totalCount,lastPage:data.lastPage}
 }
}
