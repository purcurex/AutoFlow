<script setup lang="ts">
import { useChartQuerySchedule } from '@/composables/useChartQuerySchedule'
import { warehouseName } from '@/utils/warehouse'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import EChart from '@/components/charts/EChart.vue'
import FreightTrendDialog from './FreightTrendDialog.vue'
import FreightDetailsDialog from './FreightDetailsDialog.vue'
import { getLocalFreight, type LocalFreightQuery, type LocalFreightResult, type FreightDimension, type FreightMeasure, type LocalFreightDetailsQuery } from '@/api/local-freight'
import { businessYears } from '@/utils/business-years'
import { formatCurrency } from '@/utils/currency'
import { onSessionReset } from '@/utils/session'
import { useAnalyticsRefresh } from '@/composables/useAnalyticsRefresh'
import { salespersonGroupedChart } from '@/utils/salesperson-revenue-chart'
import type { AnalyticsRow } from '@/api/local-dashboard-analytics'
import '@/components/order-volume/order-volume.css'
import './freight.css'
const props=withDefaults(defineProps<{revision?:number}>(),{revision:0})
const {locale}=useI18n()
const t=(cn:string,en:string)=>String(locale.value).startsWith('zh')?cn:en
const businessToday=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10)
const today=ref(businessToday()),currentYear=computed(()=>Number(today.value.slice(0,4)))
const year=ref(currentYear.value),grain=ref<LocalFreightQuery['grain']>('week'),weekOf=ref(today.value),warehouse=ref(''),dimension=ref<FreightDimension>('carrier'),compare=ref(false)
const detail=ref<{query:LocalFreightDetailsQuery;name:string}>()
const data=ref<LocalFreightResult>(),busy=ref(false),error=ref(''),selected=ref('')
const dimensions=computed(()=>[{id:'carrier',name:t('物流服务商','Carrier')},{id:'channel',name:t('物流渠道','Channel')},{id:'owner',name:t('业务员','Salesperson')},{id:'department',name:t('业务部门','Department')},{id:'country',name:t('国家','Country')},{id:'warehouse',name:t('仓库','Warehouse')},{id:'customer',name:t('客户','Customer')}])
const query=computed<LocalFreightQuery>(()=>({grain:grain.value,year:year.value,...grain.value==='week'?{weekOf:weekOf.value}:{},...warehouse.value?{warehouse:warehouse.value}:{},currency:'CNY',dimension:dimension.value}))
const money=(n:string|number|null)=>n===null?'—':formatCurrency(Number(n),data.value?.currency??'CNY',String(locale.value))
const number=(n:string|number)=>Number(n).toLocaleString(String(locale.value),{maximumFractionDigits:3})
const percent=(n:number|null)=>n===null?'—':`${n>0?'+':''}${n.toFixed(2)}%`
const warehouseOptions=ref<{id:string;name:string}[]>([])
let request=0,updatingClock=false
function updateClock(){
 const oldToday=today.value,oldYear=currentYear.value,next=businessToday()
 if(next===oldToday)return
 updatingClock=true
 const followsToday=year.value===oldYear&&weekOf.value===oldToday
 today.value=next
 if(followsToday){year.value=currentYear.value;weekOf.value=next}
 updatingClock=false
}
const filterQuery=useChartQuerySchedule(()=>load(),()=>{request++;busy.value=true})
const refresh=useAnalyticsRefresh(()=>load(),()=>busy.value,true)
async function load(force=false){
 filterQuery.cancel()
 updateClock()
 const id=++request;busy.value=true;error.value='';selected.value='';detail.value=undefined
 const submitted={...query.value}
 const baseKey=(q:LocalFreightQuery)=>JSON.stringify({...q,dimension:undefined,allDimensions:undefined})
 if(!data.value||baseKey(data.value.query)!==baseKey(submitted))data.value=undefined
 try{const result=await getLocalFreight(submitted,{force});if(id===request){data.value={...result,query:submitted,series:result.series.map(s=>submitted.dimension==='warehouse'?{...s,label:warehouseName(s.label)}:s)};refresh.updated(result)}}
 catch{if(id===request){data.value=undefined;warehouseOptions.value=[];error.value=t('运费数据加载失败，请重试或检查查询权限。','Unable to load freight data. Retry or check access.')}}
 finally{if(id===request)busy.value=false}
}
watch(year,v=>{weekOf.value=v===currentYear.value?today.value:`${v}-12-31`},{flush:'sync'})
watch(query,(_next,previous)=>{if(!updatingClock){detail.value=undefined;if(previous)filterQuery.schedule();else void load()}},{immediate:true})
watch(()=>props.revision,()=>load(true))
const off=onSessionReset(()=>{request++;data.value=undefined;detail.value=undefined;error.value='';selected.value='';busy.value=false;warehouseOptions.value=[]})
onBeforeUnmount(()=>{request++;off()})
watch(data,v=>{if(v){warehouseOptions.value=v.warehouseOptions??v.warehouses.map(id=>({id,name:id}))}})
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const ownerChart=computed(()=>{
 const d=data.value;if(d?.query.dimension!=='owner'||!d?.departmentSeries)return undefined
 const measures=new Map<string,FreightMeasure>()
 const rows:AnalyticsRow[]=[...d.departmentSeries.map(s=>({...s,dimension:'department'})),...d.series.map(s=>({...s,dimension:'person'}))].map(s=>{
  measures.set(`${s.dimension}:${s.id}`,s.totals)
  return {dimension:s.dimension,id:s.id,label:s.label,englishName:s.englishName,departmentId:s.departmentId,departmentName:s.departmentName,currency:d.currency,amount:compare.value?s.totals.delta:s.totals.amount,orderCount:s.billCount,quantity:null}
 })
 return salespersonGroupedChart(rows,'amount',{amount:compare.value?t('运费变化','Freight change'):t('实际运费','Actual freight'),count:t('发运单量','Dispatches'),...(compare.value?{extraTooltip:(row:AnalyticsRow)=>comparisonText(measures.get(`${row.dimension}:${row.id}`),'\n')}:{})})
})
function comparisonText(value:FreightMeasure|undefined,separator='<br>'){
 if(!value)return '—'
 return [`${t('当期','Current')}：${money(value.amount)}`,`${t('上期','Previous')}：${money(value.previousAmount)}`,`${t('差额','Change')}：${money(value.delta)}`,`${t('环比','Period comparison')}：${percent(value.percent)}`].join(separator)
}
function chart(group?:string){
 const d=data.value;if(!d)return {}
 const rows=group?d.series.filter(s=>s.id===group):d.series
 return {tooltip:{trigger:'axis',confine:true,formatter:(items:any[])=>items.map(x=>`${escape(String(x.seriesName))}: ${compare.value?comparisonText(rows[x.seriesIndex]?.values[x.dataIndex]):money(x.value??null)}`).join('<br>')},
  legend:{type:'scroll',bottom:0},grid:{left:75,right:24,top:25,bottom:65},xAxis:{type:'category',data:d.periods.map(p=>p.label)},
  yAxis:{type:'value',name:compare.value?`${t('差额','Change')} · ${d.currency}`:d.currency,axisLabel:{formatter:(v:number)=>v.toLocaleString(String(locale.value))}},
  series:rows.map(s=>({id:s.id,name:s.label,type:group&&!compare.value?'line':'bar',data:s.values.map(v=>compare.value?v.delta===null?null:Number(v.delta):Number(v.amount)),emphasis:{focus:'series'}}))}
}
const option=computed(()=>ownerChart.value?.option??chart()),trend=computed(()=>chart(selected.value)),selectedName=computed(()=>data.value?.series.find(s=>s.id===selected.value)?.label??'')
function openDetails(dimensionId?:string,periodId?:string){
 const d=data.value;if(!d?.canViewDetails||busy.value)return
 const series=d.series.find(s=>s.id===dimensionId),period=d.periods.find(p=>p.id===periodId)
 detail.value={query:{...d.query,...dimensionId?{dimensionId}:{},...periodId?{periodId}:{}},name:[series?.label??t('当前范围','Current scope'),period?.label].filter(Boolean).join(' · ')}
}
function selectChart(event:{seriesIndex?:number;dataIndex?:number}){
 if(event.dataIndex===undefined)return
 if(ownerChart.value){const target=ownerChart.value.targets[event.dataIndex];if(target?.dimension==='person')openDetails(target.id);else if(target?.dimension==='department'&&data.value?.canViewDetails&&!busy.value)detail.value={query:{...data.value.query,departmentId:target.id},name:target.name};return}
 const series=data.value?.series[event.seriesIndex??0],period=data.value?.periods[event.dataIndex]
 if(series&&period)openDetails(series.id,period.id)
}
const displayPeriods=computed(()=>data.value?.periods.map((p,index)=>({...p,index})).reverse()??[])
</script>
<template>
 <section class="ov-panel freight-analysis local-freight" data-module="freight" data-source="local" :aria-busy="busy">
  <header><h2>{{t('物流运费分析','Logistics freight analysis')}}</h2><small v-if="data">{{t('最近同步','Last synced')}} {{new Date(data.asOf).toLocaleString(String(locale),{timeZone:'Asia/Shanghai'})}} · UTC+8</small></header>
  <div class="filters">
   <label>{{t('年份','Year')}}<select v-model="year" aria-label="运费年份"><option v-for="y in businessYears(currentYear)" :key="y" :value="y">{{y}}</option></select></label>
   <label>{{t('仓库','Warehouse')}}<select v-model="warehouse" aria-label="运费仓库"><option value="">{{t('全部仓库','All warehouses')}}</option><option v-for="w in warehouseOptions" :key="w.id" :value="w.id">{{warehouseName(w.name || w.id)}}</option></select></label>
   <label>{{t('统计维度','Group by')}}<select v-model="dimension" aria-label="运费统计维度"><option v-for="d in dimensions" :key="d.id" :value="d.id">{{d.name}}</option></select></label>
   <button class="query" :disabled="busy" @click="load(true)">{{t('查询','Query')}}</button>
  </div>
  <div class="filters secondary">
   <label>{{t('时间轴','Period')}}<select v-model="grain" aria-label="运费时间轴"><option value="week">{{t('按周','Weekly')}}</option><option value="month">{{t('按月','Monthly')}}</option><option value="year">{{t('按年','Yearly')}}</option></select></label>
   <label v-if="grain==='week'">{{t('截至周','Through week')}}<input v-model="weekOf" type="date" :min="year===2026?'2026-06-01':`${year}-01-01`" :max="year===currentYear?today:`${year}-12-31`"></label>
   <label :title="t('上期为零或无可比数据时，增长率显示—；未结束周期按相同已覆盖天数比较。','Growth rate is unavailable for a zero or missing baseline; partial periods compare equal elapsed days.')"><input v-model="compare" type="checkbox">{{t('环比','Period comparison')}}</label>
  </div>
  <p v-if="busy&&!data" class="ov-empty" role="status">{{t('正在统计实际运费…','Loading actual freight…')}}</p>
  <p v-else-if="error" class="ov-error" role="alert">{{error}} <button @click="load(true)">{{t('重试','Retry')}}</button></p>
  <template v-else-if="data">
   <dl class="freight-metrics" :aria-label="t('运费汇总','Freight summary')">
    <div class="freight-metric freight-metric-primary"><dt>{{t('实际运费合计','Actual freight')}}</dt><dd data-freight-total>{{money(data.totals.amount)}}</dd></div>
    <div class="freight-metric" :title="t('当前范围内计入运费统计的已确认发运单','Confirmed dispatches included in this freight total')"><dt>{{t('单量','Dispatches')}}</dt><dd>{{number(data.billCount)}} <span class="metric-unit">{{t('单','bills')}}</span></dd></div>
    <div class="freight-metric" :title="t('汇总已填写有效计费重量的单据，未填写的重量不计入','Sum of known valid chargeable weights; missing weights are excluded')"><dt>{{t('合计计费重量','Chargeable weight')}}</dt><dd>{{number(data.weightKg)}} <span class="metric-unit">kg</span></dd><span class="metric-detail">{{t('计重','Weighed')}} {{number(data.weightBillCount)}} / {{number(data.billCount)}} {{t('单','bills')}}</span></div>
    <div class="freight-metric"><dt>{{t('平均每单运费','Cost per dispatch')}}</dt><dd>{{money(data.averagePerBill)}}</dd></div>
    <div class="freight-metric" :title="t('有有效计费重量单据的运费合计 ÷ 对应计费重量合计','Freight cost of weight-known dispatches ÷ their total chargeable weight')"><dt>{{t('每公斤运费','Cost per kg')}}</dt><dd>{{money(data.costPerKg)}}</dd></div>
   </dl>
   <div class="freight-notes">
    <span :title="t('按实际运费确认时间统计；未结束周期与上期相同已覆盖天数比较。','Grouped by freight confirmation date; partial periods compare equal elapsed days.')">{{t('按运费确认时间 · 人民币','Freight confirmation date · CNY')}} · {{data.periods[0]?.from}} — {{data.periods[data.periods.length-1]?.to}}<template v-if="compare"> · {{t('差额 / 增长率','Change / Growth rate')}}</template></span>
    <span v-if="data.quality.missingCurrencyCount||data.quality.missingDateCount" class="freight-quality">{{t('未计入：','Excluded: ')}}<span v-if="data.quality.missingCurrencyCount">{{t('币种缺失','Missing currency')}} {{number(data.quality.missingCurrencyCount)}} {{t('单','bills')}}</span><template v-if="data.quality.missingCurrencyCount&&data.quality.missingDateCount"> · </template><span v-if="data.quality.missingDateCount" :title="t('当前仓库全部日期范围内缺少费用确认时间的单据','Bills missing freight confirmation date across all dates in this warehouse')">{{t('确认时间缺失','Missing confirmation date')}} {{number(data.quality.missingDateCount)}} {{t('单','bills')}}</span></span>
   </div>
   <p v-if="compare&&data.values.every(v=>v.previousAmount===null)" class="comparison-note">{{t('上期无可比数据','No comparable previous period')}}</p>
   <div v-if="ownerChart" class="owner-legend"><span><i class="department-swatch"/>{{t('部门汇总','Department')}}</span><span><i class="person-swatch"/>{{t('业务员','Salesperson')}}</span></div>
   <div class="freight-chart" :class="{'owner-groups':ownerChart}"><EChart :option="option" @select="selectChart" :style="ownerChart?{minWidth:`${ownerChart.minWidth}px`}:undefined" :label="t('实际物流运费统计','Actual freight statistics')" /></div>
   <div v-if="data.canViewDetails" class="freight-trend-actions"><button class="ov-link" :disabled="busy" @click="openDetails()">{{t('查看发运单明细 / 导出','Dispatch details / Export')}}</button><button v-for="s in data.series" :key="s.id" class="ov-link" :disabled="busy" @click="openDetails(s.id)">{{s.label}} · {{t('明细','Details')}}</button></div>
   <div class="freight-trend-actions"><span>{{t('分组趋势','Group trends')}}</span><button v-for="s in data.series" :key="s.id" class="ov-link" @click="selected=s.id">{{s.label}} ↗</button></div>
   <details><summary>{{t('运费统计表','Freight statistics')}}</summary><div class="ov-table-scroll"><table class="ov-table"><thead><tr><th>{{t('统计周期','Period')}}</th><th>{{compare?t('合计差额','Total change'):t('合计','Total')}}</th><th v-for="s in data.series" :key="s.id">{{s.label}}</th></tr></thead><tbody><tr v-for="p in displayPeriods" :key="p.id"><th>{{p.label}} <small v-if="p.partial">{{t('非完整周期','Partial')}}</small></th><td>{{money(compare?data.values[p.index]!.delta:data.values[p.index]!.amount)}}<small v-if="compare">{{percent(data.values[p.index]!.percent)}}</small></td><td v-for="s in data.series" :key="s.id">{{money(compare?s.values[p.index]!.delta:s.values[p.index]!.amount)}}<small v-if="compare">{{percent(s.values[p.index]!.percent)}}</small></td></tr></tbody></table></div></details>
   <FreightDetailsDialog v-if="detail" :query="detail.query" :name="detail.name" @close="detail=undefined" />
   <FreightTrendDialog v-if="selected" :name="selectedName" scope="CNY · UTC+8" @close="selected=''"><div class="freight-chart"><EChart :option="trend" :label="selectedName" /></div></FreightTrendDialog>
  </template>
 </section>
</template>
<style scoped>
.local-freight{container-type:inline-size;margin-top:22px;padding:24px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface);color:var(--color-text)}
.comparison-note{font-size:12px;color:var(--color-text-secondary);margin:12px 0}.owner-groups{overflow-x:auto;overflow-y:hidden;padding-bottom:12px}.owner-legend{display:flex;gap:18px;margin:12px 0;color:var(--color-text-secondary);font-size:12px}.owner-legend span{display:flex;align-items:center;gap:6px}.owner-legend i{width:10px;height:10px;border-radius:2px}.department-swatch{background:var(--color-primary)}.person-swatch{background:#37a3a3}
header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px}h2{font-size:16px;font-weight:600}header small{color:var(--color-text-secondary);font-size:12px}.filters{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.secondary{margin-top:18px}label{display:inline-flex;align-items:center;gap:8px;font-size:12px}select,input[type=date],button.query{height:34px;padding:7px 9px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-surface);color:inherit;font-size:12px}.query{background:var(--color-primary)!important;color:white!important}.ov-table th,.ov-table td{white-space:nowrap}.ov-table small{display:block}summary{cursor:pointer;padding:12px 0}:global(.dark .local-freight){color-scheme:dark}
/* Keep labels, values and secondary counts aligned independently of text length. */
.freight-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;margin:24px 0 12px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-border);overflow:hidden}
.freight-metric{min-width:0;padding:16px 18px;display:flex;flex-direction:column;align-items:flex-start;gap:9px;background:var(--color-surface)}
.freight-metric dt{font-size:12px;line-height:18px;color:var(--color-text-secondary)}
.freight-metric dd{margin:0;font-size:clamp(18px,2.4cqi,26px);font-weight:650;line-height:1.3;letter-spacing:-.025em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.freight-metric-primary dd{color:var(--color-chart-link)}
.metric-unit{font-size:12px;font-weight:400;letter-spacing:0;color:var(--color-text-secondary)}
.metric-detail{font-size:11px;line-height:16px;color:var(--color-text-secondary);font-variant-numeric:tabular-nums}
.freight-notes{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px 20px;font-size:11px;line-height:1.7;color:var(--color-text-secondary)}
.freight-quality{color:var(--color-chart-muted)}
@container(max-width:760px){.freight-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.freight-metric{padding:14px}.freight-metric dd{font-size:21px}}
@container(max-width:460px){.freight-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.freight-metric-primary{grid-column:1/-1}.freight-metric dd{font-size:22px}}
</style>
