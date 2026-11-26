import type { AnalyticsRow, LocalAnalyticsResult,TrendTarget } from '@/api/local-dashboard-analytics'
import { formatKnownCurrency, currencyLabel } from './currency'
import { compareBusinessDepartments, salespersonRows } from './salesperson-revenue-chart'
export function signedComparisonPercent(current:number|null|undefined,previous:number|null|undefined){
 if(current==null||previous==null||!Number.isFinite(current)||!Number.isFinite(previous)||previous===0)return '—'
 const percent=(current-previous)/Math.abs(previous)*100
 return `${percent>0?'+':''}${percent.toFixed(2)}%`
}
export type ComparisonMode='week'|'month'
export function periodDates(mode:ComparisonMode,anchor:string,max:string){
 const d=new Date(`${anchor}T00:00:00Z`),day=86400000,iso=(n:number)=>new Date(n).toISOString().slice(0,10)
 const from=mode==='week'?iso(+d-((d.getUTCDay()+6)%7)*day):`${anchor.slice(0,7)}-01`
 const end=mode==='week'?iso(Date.parse(from)+6*day):iso(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0))
 return {from,to:end<max?end:max}
}
/** Display both periods while requests retain the current-period boundaries. */
export function comparisonDates(mode:ComparisonMode,anchor:string,max:string){
 const current=periodDates(mode,anchor,max),d=new Date(`${current.from}T00:00:00Z`)
 const iso=(n:number)=>new Date(n).toISOString().slice(0,10)
 const previousFrom=mode==='week'?iso(+d-7*86400000):iso(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1))
 const last=iso(+d-86400000)
 const previousTo=mode==='week'||current.to===iso(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0))?last:`${previousFrom.slice(0,7)}-${String(Math.min(Number(current.to.slice(-2)),Number(last.slice(-2)))).padStart(2,'0')}`
 return {current,previous:{from:previousFrom,to:previousTo},from:previousFrom,to:current.to}
}
export function comparisonChart(result:LocalAnalyticsResult,dimension:string,metric:string,monetary:boolean){
 const comparison=result.comparison
 if(!comparison?.available||!comparison.previousData)return undefined
 const previous=comparison.previousData
 const totals=dimension==='person'?result.departmentSummary??result:result
 const previousTotals=dimension==='person'?previous.departmentSummary??previous:previous
 if(monetary&&(totals.missingAmountCount||totals.missingCurrencyCount||previousTotals.missingAmountCount||previousTotals.missingCurrencyCount))return undefined
 const time=['day','month'].includes(dimension),dim=time?'day':dimension
 const registration=result.chartId==='registrations'
 const personRows=[...result.rows,...previous.rows].filter(r=>r.dimension==='person')
 const grouped=dimension==='person'&&!result.summaryOnly&&personRows.every(r=>r.departmentId||r.id==='unknown')&&salespersonRows([...result.rows,...previous.rows]).some(r=>r.dimension==='department')
 const select=(rows:AnalyticsRow[])=>(grouped?salespersonRows(rows):rows).filter(r=>r.dimension===dim||grouped&&r.dimension==='department').map(r=>grouped&&r.dimension==='department'?{...r,id:`dept:${r.id}`} : r)
 const a=select(result.rows),b=select(previous.rows)
 const value=(r:AnalyticsRow|undefined)=>!r?0:monetary?(r.amount===null?null:Number(r.amount)):registration?r.registrationCount??r.orderCount:metric==='quantity'?(r.quantity===null?null:Number(r.quantity)):r.orderCount
 const dateAt=(start:string,index:number)=>new Date(Date.parse(start)+index*86400000).toISOString().slice(0,10)
 const days=(p:{from:string;to:string})=>Math.round((Date.parse(p.to)-Date.parse(p.from))/86400000)+1
 let keys=time?Array.from({length:Math.max(days(comparison.current),days(comparison.previous))},(_,i)=>String(i)):[...new Set([...a,...b].map(r=>r.id))].sort((x,y)=>Number(value(a.find(r=>r.id===y))??0)-Number(value(a.find(r=>r.id===x))??0))
 if(dimension==='department')keys.sort((x,y)=>compareBusinessDepartments((a.find(r=>r.id===x)??b.find(r=>r.id===x))!.label,(a.find(r=>r.id===y)??b.find(r=>r.id===y))!.label))
 if(grouped){
  const departments=[...new Set([...a,...b].filter(r=>r.dimension==='department').map(r=>r.id))].sort((x,y)=>compareBusinessDepartments((a.find(r=>r.id===x)??b.find(r=>r.id===x))!.label,(a.find(r=>r.id===y)??b.find(r=>r.id===y))!.label))
  keys=departments.flatMap((dept,index)=>[...(index?[`gap:${dept}`]:[]),dept,...keys.filter(id=>[...a,...b].some(r=>r.id===id&&r.dimension==='person'&&`dept:${r.departmentId??'unknown'}`===dept))])
 }
 const ids=time||dimension==='person'?keys:keys.slice(0,20)
 const codes=monetary?[...new Set([...a,...b].map(r=>r.currency).filter((x):x is string=>!!x))]:['count']
 const label=(id:string)=>{if(id.startsWith('gap:'))return '';const r=[...a,...b].find(r=>r.id===id);if(grouped)return r?.dimension==='department'?r.label:r?.englishName||(r?.id==='unknown'?'未绑定业务员':'—');return dimension==='person'&&r?.departmentName?`${r.departmentName}\n${r.englishName||r.label}`:r?.label??id}
 const series=codes.flatMap(code=>[true,false].map(prior=>{
  const period=prior?comparison.previous:comparison.current,data=prior?b:a
  return {name:`${prior?'上期':'本期'}${monetary&&codes.length>1?`（${currencyLabel(code)}）`:''}`,type:time?'line' as const:'bar' as const,barMaxWidth:28,lineStyle:{type:prior?'dashed' as const:'solid' as const},itemStyle:{color:prior?'#91a7d6':'#5368be'},connectNulls:false,
   data:ids.map(id=>id.startsWith('gap:')||time&&Number(id)>=days(period)?null:value(data.find(r=>r.id===(time?dateAt(period.from,Number(id)):id)&&(!monetary||r.currency===code))))}
 }))
 const trendTargets:(TrendTarget|null)[]=ids.map(id=>{const row=[...a,...b].find(r=>r.id===id);if(time||!row||id==='unknown'||id.startsWith('gap:'))return null;return {dimension:row.dimension as TrendTarget['dimension'],id:grouped&&row.dimension==='department'?id.slice(5):id,name:label(id)}})
 return {trendTargets,legend:{show:true,top:0,data:series.map(s=>s.name)},tooltip:{trigger:'axis' as const,renderMode:'richText' as const,formatter:(raw:unknown)=>{
  const points=(Array.isArray(raw)?raw:[raw]) as {dataIndex:number;seriesIndex:number;value:number|null;seriesName:string}[]
  const index=points[0]?.dataIndex??0
  if(result.chartId==='customer_orders'&&['customer','person'].includes(dimension)){
   const id=ids[index],currentRow=a.find(r=>r.id===id),previousRow=b.find(r=>r.id===id)
   const owner=currentRow??previousRow
   if(!owner)return ''
   const name=(dimension==='customer'?owner.customerOwnerName:owner.label)?.trim()||'未绑定业务员'
   return [...(owner.dimension==='department'?[owner.label,'部门汇总']:[`业务员：${name}`]),...points.flatMap(p=>{
    const row=p.seriesIndex%2?currentRow:previousRow
    const orders=`${p.seriesName}订单数：${(row?.orderCount??0).toLocaleString('zh-CN')}`
    return metric==='quantity'?[orders,`${p.seriesName}商品件数：${p.value==null?'—':p.value.toLocaleString('zh-CN')}`]:[orders]
   }),`订单数环比：${signedComparisonPercent(currentRow?.orderCount??0,previousRow?.orderCount??0)}`,...(metric==='quantity'?[`商品件数环比：${signedComparisonPercent(value(currentRow),value(previousRow))}`]:[])].join('\n')
  }
  return [time?'同期进度':`${[...a,...b].find(r=>r.id===ids[index])?.departmentName??''} ${label(ids[index]??'')}`.trim(),...points.map(p=>{
   const period=p.seriesIndex%2?comparison.current:comparison.previous
   const actual=time&&Number(ids[index])<days(period)?dateAt(period.from,Number(ids[index])):''
   const row=(p.seriesIndex%2?a:b).find(r=>r.id===ids[p.dataIndex]&&r.currency===codes[Math.floor(p.seriesIndex/2)])
   const count=result.chartId==='salesperson_receipts'&&['person','department'].includes(dimension)?`\n${p.seriesName}订单量：${(row?.orderCount??0).toLocaleString('zh-CN')} 笔`:''
   return `${p.seriesName}${actual?` ${actual}`:''}：${p.value==null?'—':monetary?formatKnownCurrency(p.value,codes[Math.floor(p.seriesIndex/2)]):p.value.toLocaleString('zh-CN')}${count}`
  }),...codes.map((code,i)=>`${monetary?'金额':registration?'注册客户数':metric==='quantity'?'商品件数':'订单数'}环比${codes.length>1?`（${code}）`:''}：${signedComparisonPercent(series[i*2+1]?.data[index],series[i*2]?.data[index])}`)].join('\n')
 }},grid:{left:18,right:20,bottom:60,top:45,containLabel:true},xAxis:{type:'category' as const,data:ids.map(id=>time?`第${Number(id)+1}天`:label(id)),axisLabel:{rotate:grouped?0:ids.length>8?25:0,...(grouped?{interval:0}:{})}},yAxis:{type:'value' as const,minInterval:monetary?undefined:1,...(monetary&&codes.length===1&&codes[0]==='USD'?{axisLabel:{formatter:(v:number)=>formatKnownCurrency(v,'USD')}}:{})},series}
}
