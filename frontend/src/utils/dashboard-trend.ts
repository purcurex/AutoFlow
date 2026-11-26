import type { DashboardTrendResult,TrendPoint } from '@/api/local-dashboard-analytics'
import { formatKnownCurrency } from './currency'
export type TrendMetric='orders'|'quantity'|'amount'|'registrations'
export function trendPoints(data:DashboardTrendResult):TrendPoint[]{
 const points=new Map(data.points.map(p=>[p.period,p])),result:TrendPoint[]=[]
 const date=new Date(`${data.grain==='month'?data.from.slice(0,7)+'-01':data.from}T00:00:00Z`)
 while(date.toISOString().slice(0,10)<=data.to){
  const period=date.toISOString().slice(0,data.grain==='month'?7:10)
  result.push(points.get(period)??{period,orderCount:0,registrationCount:0,quantity:'0',amount:'0'})
  if(data.grain==='month')date.setUTCMonth(date.getUTCMonth()+1);else date.setUTCDate(date.getUTCDate()+1)
 }
 return result
}
export function trendChart(data:DashboardTrendResult,metric:TrendMetric,label:string,dark=false){
 const points=trendPoints(data),money=metric==='amount'
 const value=(p:TrendPoint)=>metric==='registrations'?p.registrationCount??p.orderCount:metric==='orders'?p.orderCount:metric==='quantity'?p.quantity:p.amount
 const format=(v:unknown)=>v==null?'—':money?formatKnownCurrency(Number(v),data.currency??'USD'):Number(v).toLocaleString('zh-CN')
 return {tooltip:{trigger:'axis' as const,renderMode:'richText' as const,confine:true,formatter:(raw:unknown)=>{
  const p=(Array.isArray(raw)?raw[0]:raw) as {dataIndex:number};const row=points[p.dataIndex];if(!row)return ''
  return [`${row.period}${data.grain==='month'?'（所选日期内）':''}`,`${label}：${format(value(row))}`,...(metric==='amount'||metric==='quantity'?[`订单数：${row.orderCount.toLocaleString('zh-CN')}`]:[])].join('\n')
 }},grid:{left:16,right:24,top:38,bottom:22,containLabel:true},xAxis:{type:'category' as const,boundaryGap:false,data:points.map(p=>p.period),axisLabel:{hideOverlap:true}},
 yAxis:{type:'value' as const,...(money?{axisLabel:{formatter:format}}:{minInterval:1})},
 series:[{name:label,type:'line' as const,smooth:false,connectNulls:false,showSymbol:points.length<=40,symbolSize:6,lineStyle:{width:2},itemStyle:{color:dark?'#91a6ff':'#5c72d4'},areaStyle:{color:dark?'rgba(145,166,255,0.08)':'rgba(92,114,212,0.06)'},data:points.map(p=>value(p)==null?null:Number(value(p)))}]}
}
