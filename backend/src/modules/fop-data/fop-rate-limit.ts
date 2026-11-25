import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

export type RateConfig = { get(key:string): string | undefined }
export type RatePolicy = { limits:number[]; intervalMs:number; maxWaitMs:number }
type Bucket = [number,number]
export type BudgetState = { recent?:number[]; minutes?:Bucket[]; hours?:Bucket[]; nextAt?:number; blockedUntil?:number; billingBlocked?:boolean; strikes?:number }
export type Admission = { allowed:boolean; retryAfterMs:number; reason:string }
export type Restriction = { kind:'rate'|'billing'|'unavailable'; delayMs:number }
export interface BudgetStore {
  reserve(scope:string, policy:RatePolicy):Promise<Admission>
  restrict(scope:string, restriction:Restriction):Promise<void>
}
const MINUTE=60000,HOUR=3600000,DAY=86400000
export function ratePolicy(config:RateConfig):RatePolicy {
  const defaults=[16,400,8000,160000], ceilings=[20,500,10000,200000]
  const limits=['QPS','QPM','QPH','QPD'].map((name,i)=>{
    const raw=config.get('FOP_RATE_LIMIT_'+name), value=raw===undefined||raw===''?defaults[i]:Number(raw)
    if(!Number.isSafeInteger(value)||value<1||value>ceilings[i])throw Error('fop_rate_limit_configuration_invalid')
    return value
  })
  const intervalMs=Number(config.get('FOP_RATE_LIMIT_INTERVAL_MS')||500)
  if(!Number.isSafeInteger(intervalMs)||intervalMs<500||intervalMs>60000)throw Error('fop_rate_limit_configuration_invalid')
  return {limits,intervalMs,maxWaitMs:5000}
}
/** Conservative rolling buckets: edge minutes/hours are fully counted, never under-counted. */
export function admitRequest(previous:BudgetState,now:number,policy:RatePolicy):Admission & {state:BudgetState} {
  const state:BudgetState={...previous,recent:(previous.recent??[]).filter(t=>t>now-MINUTE),
    minutes:(previous.minutes??[]).filter(([t])=>t>=Math.floor((now-HOUR)/MINUTE)*MINUTE),
    hours:(previous.hours??[]).filter(([t])=>t>=Math.floor((now-DAY)/HOUR)*HOUR)}
  const denied=(retryAfterMs:number,reason:string)=>({allowed:false,retryAfterMs:Math.max(1,retryAfterMs),reason,state})
  if(state.billingBlocked)return denied(DAY,'billing')
  if((state.blockedUntil??0)>now)return denied(state.blockedUntil!-now,'cooldown')
  const windows=[state.recent!.filter(t=>t>now-1000).map(t=>[t,1] as Bucket),state.recent!.map(t=>[t,1] as Bucket),state.minutes!,state.hours!]
  const durations=[1000,MINUTE,HOUR+MINUTE,DAY+HOUR]
  // Check every window: use the longest delay when multiple budgets are exhausted.
  let retry=0,reason=''
  windows.forEach((buckets,i)=>{
    let count=buckets.reduce((sum,[,n])=>sum+n,0)
    if(count<policy.limits[i])return
    for(const [t,n] of buckets){count-=n;if(count<policy.limits[i]){const wait=t+durations[i]-now;if(wait>retry){retry=wait;reason=['qps','qpm','qph','qpd'][i]}break}}
  })
  if(retry>0)return denied(retry,reason)
  if((state.nextAt??0)>now)return denied(state.nextAt!-now,'spacing')
  state.recent!.push(now)
  const increment=(buckets:Bucket[],width:number)=>{const start=Math.floor(now/width)*width,last=buckets[buckets.length-1];if(last?.[0]===start)last[1]++;else buckets.push([start,1])}
  // Copy buckets before mutation, so caller snapshots remain immutable.
  state.minutes=state.minutes!.map(b=>[...b]);state.hours=state.hours!.map(b=>[...b])
  increment(state.minutes,MINUTE);increment(state.hours,HOUR);state.nextAt=now+policy.intervalMs
  return {allowed:true,retryAfterMs:0,reason:'',state}
}
export function sourceRestriction(status:number,body:unknown,retryAfter:string|null,now=Date.now(),strikes=0):Restriction|null {
  const envelope=body&&typeof body==='object'?body as Record<string,unknown>:{}
  const code=String(envelope.errorCode??'')
  const message=[envelope.messagecn,envelope.message,envelope.msg].filter(v=>typeof v==='string').join(' ')
  if(code==='2055'||/请求被计费策略拦截|billing.*(?:limit|quota)/i.test(message))return {kind:'billing',delayMs:DAY}
  const raw=retryAfter?.trim()??''
  const ms=/^\d+$/.test(raw)?Number(raw)*1000:/^[A-Za-z]{3}, /.test(raw)?Date.parse(raw)-now:NaN
  const backoff=Math.min(DAY,MINUTE*2**Math.min(strikes,11))
  const wait=Number.isSafeInteger(ms)&&ms>0?ms:backoff
  if(status===429||['2526','2528','429'].includes(code)||/请求被(?:参数|基础)流控限制|rate.?limit|too many requests/i.test(message))return {kind:'rate',delayMs:wait}
  if(status===503&&Number.isFinite(ms)&&ms>0)return {kind:'unavailable',delayMs:wait}
  return null
}
function deferred(admission:Admission,status=429):Response {
  return new Response(JSON.stringify({status:false,errorCode:admission.reason==='billing'?'FOP_BILLING_BLOCKED':'FOP_RATE_DEFERRED',message:'FOP request deferred',reason:admission.reason}),
    {status,headers:{'content-type':'application/json','retry-after':String(Math.ceil(admission.retryAfterMs/1000)),'x-fop-admission':admission.reason}})
}
/** Bounded peek catches native gateway errors returned with either HTTP 200 or 519. */
async function errorEnvelope(response:Response,signal?:AbortSignal|null):Promise<unknown> {
  if(!response.body)return null
  const reader=response.clone().body!.getReader(),chunks:Uint8Array[]=[];let size=0
  const stop=()=>{void reader.cancel().catch(()=>{})}
  const timer=setTimeout(stop,2000)
  signal?.addEventListener('abort',stop,{once:true})
  try {
    for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536)return null;chunks.push(part.value)}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }catch{return null}finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);stop()}
}
export function createBudgetedFetch(store:BudgetStore,network:typeof fetch,policy:RatePolicy):typeof fetch {
  return async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input)),scope=url.origin.toLowerCase()
    const signal=init?.signal??(input instanceof Request?input.signal:undefined)
    const started=Date.now()
    for(;;){
      signal?.throwIfAborted()
      let admission:Admission
      try{admission=await store.reserve(scope,policy)}catch{return deferred({allowed:false,retryAfterMs:60000,reason:'budget_unavailable'},503)}
      signal?.throwIfAborted()
      if(admission.allowed)break
      if(admission.reason!=='spacing'||Date.now()-started+admission.retryAfterMs>policy.maxWaitMs)return deferred(admission)
      await delay(admission.retryAfterMs,undefined,{signal:signal??undefined})
    }
    // Every physical attempt, including OAuth, failures and retries, is charged before sending.
    // A redirect is another physical request (and may replay a POST); never follow it implicitly.
    const response=await network(input,{...init,redirect:'error'})
    const restriction=sourceRestriction(response.status,await errorEnvelope(response,signal),response.headers.get('retry-after'))
    if(!restriction)return response
    try{await store.restrict(scope,restriction)}catch{void response.body?.cancel().catch(()=>{});return deferred({allowed:false,retryAfterMs:60000,reason:'budget_unavailable'},503)}
    void response.body?.cancel().catch(()=>{})
    return deferred({allowed:false,retryAfterMs:restriction.delayMs,reason:restriction.kind},restriction.kind==='billing'?403:restriction.kind==='unavailable'?503:429)
  }
}

type DbClient={query(sql:string,parameters?:unknown[]):Promise<{rows:any[]}>;release():void}
type DbPool={connect():Promise<DbClient>}
export class PostgresBudgetStore implements BudgetStore {
  constructor(private readonly pool:DbPool){}
  private async change<T>(scope:string,operation:(state:BudgetState,now:number)=>{state:BudgetState;result:T}):Promise<T>{
    const c=await this.pool.connect()
    try{
      await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='5s'")
      await c.query('INSERT INTO hz_fop_api_budgets(scope) VALUES($1) ON CONFLICT DO NOTHING',[scope])
      const {rows}=await c.query('SELECT state FROM hz_fop_api_budgets WHERE scope=$1 FOR UPDATE',[scope])
      const {rows:clock}=await c.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::float8 AS now')
      const next=operation(rows[0].state,Number(clock[0].now))
      await c.query('UPDATE hz_fop_api_budgets SET state=$2::jsonb,updated_at=clock_timestamp() WHERE scope=$1',[scope,JSON.stringify(next.state)])
      await c.query('COMMIT');return next.result
    }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error}finally{c.release()}
  }
  reserve(scope:string,policy:RatePolicy){return this.change(scope,(state,now)=>{const next=admitRequest(state,now,policy);return {state:next.state,result:{allowed:next.allowed,retryAfterMs:next.retryAfterMs,reason:next.reason}}})}
  async restrict(scope:string,restriction:Restriction){await this.change(scope,(state,now)=>{
    const strikes=restriction.kind==='rate'?Math.min(12,(state.strikes??0)+1):state.strikes??0
    // Persist escalation across processes/restarts; do not shorten a server-supplied cooldown.
    const wait=Math.max(restriction.delayMs,restriction.kind==='rate'?Math.min(DAY,MINUTE*2**Math.max(0,strikes-1)):0)
    return {state:{...state,strikes,blockedUntil:Math.max(state.blockedUntil??0,now+wait),billingBlocked:state.billingBlocked||restriction.kind==='billing'},result:undefined}
  })}
}
const stores=new Map<string,PostgresBudgetStore>()
/** A single shared PostgreSQL ledger per source origin, independent of account/company/API route. */
export function fopBudgetedFetch(config:RateConfig,network:typeof fetch=fetch):typeof fetch {
  const policy=ratePolicy(config)
  const options={host:config.get('DB_HOST'),port:Number(config.get('DB_PORT')||5432),user:config.get('DB_USERNAME'),password:config.get('DB_PASSWORD'),database:config.get('DB_DATABASE'),
    ssl:config.get('DB_SSL')==='true'?{rejectUnauthorized:config.get('DB_SSL_REJECT_UNAUTHORIZED')!=='false'}:false}
  // No fallback to another database or per-process counters when deployment settings are incomplete.
  if(!options.host||!options.user||!options.database)return createBudgetedFetch({reserve:async()=>{throw Error('database_not_configured')},restrict:async()=>{}},network,policy)
  const key=createHash('sha256').update(JSON.stringify(options)).digest('hex')
  let store=stores.get(key)
  if(!store){
    const {Pool}=require('pg')
    const pool=new Pool({...options,max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,allowExitOnIdle:true})
    pool.on('error',()=>{/* Fail closed on the next admission; never log connection credentials. */})
    store=new PostgresBudgetStore(pool);stores.set(key,store)
  }
  return createBudgetedFetch(store,network,policy)
}
