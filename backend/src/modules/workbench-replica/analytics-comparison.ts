import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import { analyticsWindow } from './collected-analytics-query'
export type ComparisonMode = 'week' | 'month'
const day = 86400000
const date = (ms:number) => new Date(ms).toISOString().slice(0,10)
/** Calendar periods in UTC+8; dates here are calendar labels, not server-local dates. */
export function comparisonWindows(mode:ComparisonMode, to:string, capturedAt:string, now=Date.now()) {
 const cutoff=Math.min(now,Date.parse(capturedAt))
 const limit=date(cutoff+8*3600000)
 const endDate=to<limit?to:limit
 const anchor=new Date(`${endDate}T00:00:00Z`)
 if(!Number.isFinite(anchor.getTime()))throw new BadRequestException('Invalid comparison date')
 const fullMonth=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+1,0)).getUTCDate()===anchor.getUTCDate()&&to<limit
 const from=mode==='week'?date(anchor.getTime()-((anchor.getUTCDay()+6)%7)*day):`${endDate.slice(0,7)}-01`
 const requested=new Date(`${to}T00:00:00Z`)
 const requestedStart=mode==='week'?date(+requested-((requested.getUTCDay()+6)%7)*day):`${to.slice(0,7)}-01`
 if(endDate<requestedStart)throw new ServiceUnavailableException({code:'comparison_window_not_captured',message:'Data has not reached the selected comparison period'})
 const current=analyticsWindow({from:from<'2026-01-01'?'2026-01-01':from,to:endDate})
 if(endDate===limit)current.end=new Date(Math.min(Date.parse(current.end),cutoff)).toISOString()
 const prevStart=mode==='week'?date(Date.parse(from)-7*day):date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()-1,1))
 const prevLast=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth(),0)).getUTCDate()
 const prevTo=mode==='week'?date(Date.parse(from)-day):`${prevStart.slice(0,7)}-${String(fullMonth?prevLast:Math.min(anchor.getUTCDate(),prevLast)).padStart(2,'0')}`
 const previous={from:prevStart,to:prevTo,start:new Date(`${prevStart}T00:00:00+08:00`).toISOString(),end:new Date(Date.parse(`${prevTo}T00:00:00+08:00`)+day).toISOString(),timezone:'Asia/Shanghai'}
 if(mode==='month'&&endDate===limit){const time=(cutoff+8*3600000)%day;previous.end=new Date(Date.parse(`${prevTo}T00:00:00+08:00`)+time).toISOString()}
 return {mode,current,previous}
}
/** Combine parameterized aggregates into ONE SQL statement, sharing its MVCC snapshot. */
export function comparisonStatement(current:{sql:string;params:unknown[]},previous:{sql:string;params:unknown[]}) {
 const offset=current.params.length
 const marker='), filtered AS ('
 const split=current.sql.indexOf(marker),previousSplit=previous.sql.indexOf(marker)
 if(split>=0&&previousSplit>=0&&current.sql.slice(0,split)===previous.sql.slice(0,previousSplit)&&current.params.every((v,i)=>[3,4].includes(i)||JSON.stringify(v)===JSON.stringify(previous.params[i]))){
  const common=current.sql.slice(0,split+1).replace('source AS (','source AS MATERIALIZED (')
  const a='WITH '+current.sql.slice(split+3)
  const b=('WITH '+previous.sql.slice(previousSplit+3)).replace(/\$(\d+)/g,(_,n)=>'$'+(Number(n)===4?offset+1:Number(n)===5?offset+2:Number(n)))
  return {sql:`${common} SELECT c.analytics,p.analytics AS previous FROM (${a}) c CROSS JOIN (${b}) p`,params:[...current.params,previous.params[3],previous.params[4]]}
 }
 return {sql:`SELECT c.analytics, p.analytics AS previous FROM (${current.sql}) c CROSS JOIN (${previous.sql.replace(/\$(\d+)/g,(_,n)=>'$'+(Number(n)+offset))}) p`,params:[...current.params,...previous.params]}
}
export function comparisonMetrics(current:any,previous:any,chartId:string){
 const money=['department_receipts','salesperson_receipts'].includes(chartId)
 const codes=money?[...new Set<string>([...(current.amountsByCurrency??[]),...(previous.amountsByCurrency??[])].map(x=>x.currency))]:['count',...(chartId==='registrations'?[]:['quantity'])]
 return codes.map(code=>{
  const value=(r:any):number|null=> money?(r.missingAmountCount||r.missingCurrencyCount?null:Number(r.amountsByCurrency?.find((a:any)=>a.currency===code)?.amount??0)):code==='quantity'?(r.totalQuantity==null?null:Number(r.totalQuantity)):Number(r.registrationCount??r.orderCount??0)
  const a=value(current),b=value(previous),delta=a===null||b===null?null:Number((a-b).toFixed(8))
  return {key:code,current:a,previous:b,delta,percent:delta===null||b===0?null:Number((delta/Math.abs(b!)*100).toFixed(2)),status:delta===null?'unavailable':b===0?(a===0?'flat':'new'):'comparable'}
 })
}
