<script setup lang="ts">
import { registrationAxis, registrationReferences, mergeRegistrationReferences } from '@/utils/registration-axis'
import ChartUpdateStatus from '@/components/charts/ChartUpdateStatus.vue'
import { peekAnalyticsQuery } from '@/utils/analytics-cache'
import { isWorkbenchScopeError } from '@/api/workbench-dashboard'
import { useChartQuerySchedule } from '@/composables/useChartQuerySchedule'
import { warehouseName } from '@/utils/warehouse'
import ComparisonSummary from './ComparisonSummary.vue'
import { comparisonChart, comparisonDates, periodDates, type ComparisonMode } from '@/utils/analytics-comparison'
import { BUSINESS_START_DATE } from '@/utils/business-years'
import { useAnalyticsRefresh } from '@/composables/useAnalyticsRefresh'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import EChart, { type ChartClick } from './EChart.vue'
import AnalyticsTrendDialog from './AnalyticsTrendDialog.vue'
import type { TrendTarget } from '@/api/local-dashboard-analytics'
import type { TrendMetric } from '@/utils/dashboard-trend'
import { getLocalDashboardAnalytics, type LocalAnalyticsQuery, type LocalChartId, type LocalAnalyticsResult } from '@/api/local-dashboard-analytics'
import { localDate } from '@/api/fop-dashboard'
import { onSessionReset } from '@/utils/session'
import { useWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import { useDateRangeQuery } from '@/composables/useDateRangeQuery'
import { formatChartCurrency, formatKnownCurrency } from '@/utils/currency'
import { compareBusinessDepartments, salespersonGroupedChart, salespersonRows } from '@/utils/salesperson-revenue-chart'
const props=defineProps<{chartId:LocalChartId;title:string;workbench?:boolean;revision?:number;availableWindow?:{from:string;to:string;asOf:string}}>()
const today=localDate(new Date())
const availableEnd=computed(()=>props.chartId==='registrations'&&props.availableWindow? [today,props.availableWindow.to].sort()[0]! : today)
const availableStart=computed(()=>[BUSINESS_START_DATE,props.chartId==='registrations'?props.availableWindow?.from??'':''].sort().at(-1)!)
const initialFrom=[`${availableEnd.value.slice(0,7)}-01`,availableStart.value??''].sort().at(-1)!
const from=ref(initialFrom),to=ref(availableEnd.value),department=ref(''),warehouse=ref('')
const comparison=ref<''|ComparisonMode>(''),comparisonAnchor=ref(availableEnd.value)
const comparisonRange=computed(()=>comparison.value?comparisonDates(comparison.value,comparisonAnchor.value,availableEnd.value):undefined)
const displayFrom=computed({get:()=>comparisonRange.value?.from??from.value,set:(value:string)=>{const end=displayTo.value;comparison.value='';from.value=value;to.value=end}})
const displayTo=computed({get:()=>comparisonRange.value?.to??to.value,set:(value:string)=>{const start=displayFrom.value;comparison.value='';from.value=start;to.value=value}})
function chooseComparison(){
 if(comparison.value){const dates=periodDates(comparison.value,comparisonAnchor.value,availableEnd.value);from.value=dates.from<availableStart.value?availableStart.value:dates.from;to.value=dates.to}
 filterQuery.schedule()
}
type DateShortcut='current'|'previous'|'last6months'
const receiptShortcut=ref<DateShortcut>('current')
function quickReceiptRange(shortcut:DateShortcut='current'){
 const current=availableEnd.value
 // Six months follows today's calendar; registration coverage may shorten either end.
 const [year,month]=(shortcut==='last6months'?today:current).split('-').map(Number)
 const start=new Date(Date.UTC(year!,month!-1-(shortcut==='previous'?1:shortcut==='last6months'?5:0),1)).toISOString().slice(0,10)
 const end=shortcut==='previous'?new Date(Date.UTC(year!,month!-1,0)).toISOString().slice(0,10):current
 return {from:start<availableStart.value?availableStart.value:start,to:end}
}
function chooseReceiptRange(shortcut:DateShortcut='current'){
 const range=quickReceiptRange(shortcut)
 if(range.from>range.to)return
 receiptShortcut.value=shortcut
 // An unchanged applied range needs no query; refresh remains available separately.
 if(!busy.value&&!error.value&&receiptRangeSelected(shortcut)&&appliedQuery?.from===range.from&&appliedQuery.to===range.to&&appliedQuery.departmentId===(department.value||undefined)&&appliedQuery.warehouseCode===(registration.value?undefined:warehouse.value||undefined)&&appliedQuery.entityType===(registration.value?undefined:entity.value)&&!appliedQuery.comparison)return
 comparison.value=''
 from.value=range.from;to.value=range.to
 void load()
}
function receiptRangeSelected(shortcut:DateShortcut='current'){
 const range=quickReceiptRange(shortcut)
 const selected=quickReceiptRange(receiptShortcut.value)
 // At the business start, several shortcuts can share the same dates; highlight one.
 if(shortcut!==receiptShortcut.value&&range.from===selected.from&&range.to===selected.to)return false
 return !comparison.value&&from.value===range.from&&to.value===range.to
}
const entity=ref<'fulfillment'|'stock'>('fulfillment'),metric=ref('orders')
const filters=ref<Pick<LocalAnalyticsResult,'departments'|'warehouses'|'currencies'>>({departments:[],warehouses:[],currencies:[]})
const warehouseChoices=computed(()=>warehouse.value&&!filters.value.warehouses.some(w=>w.id===warehouse.value)?[...filters.value.warehouses,{id:warehouse.value,name:warehouseName(warehouse.value)}]:filters.value.warehouses)
const { access }=useWorkbenchAccess()
const initialDepartmentLabel=computed(()=>['salesperson','department_manager'].includes(access.value?.businessRole??'')?access.value?.businessDepartment?.name??'本部门':'营销中心')
const summaryOnly=ref(false)
const result=ref<LocalAnalyticsResult>(),busy=ref(false),error=ref(''),dimension=ref(props.chartId==='registrations'?'day':['salesperson_receipts','order_volume'].includes(props.chartId)?'person':props.chartId==='department_receipts'?'department':props.chartId==='customer_orders'?'customer':'month')
let generation=0
const registration=computed(()=>props.chartId==='registrations')
const monetary=computed(()=>['department_receipts','salesperson_receipts'].includes(props.chartId))
const departmentRevenue=computed(()=>props.chartId==='department_receipts')
const salespersonGrouping=computed(()=>dimension.value==='person'&&!summaryOnly.value)
const displayedTotals=computed(()=>salespersonGrouping.value?result.value?.departmentSummary??result.value:result.value)
const displayedComparison=computed(()=>result.value?.comparison?{...result.value.comparison,...salespersonGrouping.value&&result.value.comparison.departmentMetrics?{metrics:result.value.comparison.departmentMetrics}:{}}:undefined)
const groupedSalespeople=computed(()=>!result.value?.comparison?.available&&salespersonGrouping.value&&salespersonRows(result.value?.rows??[]).some(row=>row.dimension==='department'))
const salespersonChart=computed(()=>groupedSalespeople.value?salespersonGroupedChart(result.value?.rows??[],monetary.value?'amount':registration.value?'registrations':metric.value==='quantity'?'quantity':'orders'):undefined)
const paymentDateWarning=computed(()=>{
 const missing=displayedTotals.value?.missingPaidAtBreakdown
 return [missing?.paid?`已收款缺日期 ${missing.paid.toLocaleString('zh-CN')} 笔`:null,missing?.unknown?`收款信息待核查 ${missing.unknown.toLocaleString('zh-CN')} 笔`:null].filter(Boolean).join('；')
})
const incomeTotals=computed(()=>(displayedTotals.value?.amountsByCurrency??[]).filter(total=>!monetary.value||total.currency==='USD'))
const usd=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?formatChartCurrency(value):'—'
const dimensions=computed(()=>{
 const monthly=[{id:'month',name:'月度趋势'}]
 const departmentOptions=[{id:'department',name:'业务部门'}]
 if(departmentRevenue.value)return [...departmentOptions,...monthly]
 const people=[{id:'person',name:'业务员'}]
 if(props.chartId==='salesperson_receipts')return [...people,...monthly]
 if(props.chartId==='customer_orders')return [{id:'customer',name:'客户'},...people,...monthly]
 if(registration.value)return [{id:'day',name:'注册日期'},...people,...monthly]
 return [...people,{id:'warehouse',name:'仓库'},{id:'country',name:'国家'},...monthly]
})
const dimensionRows=computed(()=>(result.value?.rows??[]).filter(r=>r.dimension===dimension.value&&(!summaryOnly.value||!['person','customer','person_department'].includes(r.dimension))&&(!monetary.value||r.currency==='USD')))
const rows=computed(()=>{
 const values=dimensionRows.value
 return groupedSalespeople.value||['day','month'].includes(dimension.value)?values:values.slice().sort((a,b)=>dimension.value==='department'?compareBusinessDepartments(a.label,b.label):monetary.value?Number(b.amount??0)-Number(a.amount??0):b.orderCount-a.orderCount).slice(0,20)
})
const categoriesTruncated=computed(()=>!groupedSalespeople.value&&!result.value?.comparison?.available&&rows.value.length<dimensionRows.value.length)
const comparisonPeople=computed(()=>!!result.value?.comparison?.available&&salespersonGrouping.value)
const hasData=computed(()=>!!result.value?.comparison?.available||(groupedSalespeople.value?salespersonRows(result.value?.rows??[]):rows.value).some(r=>monetary.value?r.amount!==null:!registration.value&&metric.value==='quantity'?r.quantity!==null:true))
const comparisonOption=computed(()=>result.value?comparisonChart(result.value,dimension.value,metric.value,monetary.value):undefined)
const registrationReference=ref<LocalAnalyticsResult>()
const baseOption=computed(()=>{
 const compared=comparisonOption.value
 if(compared){const {trendTargets:_targets,...chart}=compared;return chart}
 if(salespersonChart.value)return salespersonChart.value.option
 const ids=[...new Set(rows.value.map(r=>r.id))]
 const labels=ids.map(id=>rows.value.find(r=>r.id===id)!.label)
 const currencies=monetary.value?[...new Set(rows.value.map(r=>r.currency!))]:[registration.value?'注册客户':'订单']
 const usdOnly=monetary.value&&currencies.length===1&&currencies[0]==='USD'
 const moneyTooltip=monetary.value?{formatter:(raw:unknown)=>{
  const points=(Array.isArray(raw)?raw:[raw]) as {axisValueLabel?:string;name?:string;dataIndex?:number;seriesIndex:number;value:number|null}[]
  return [points[0]?.axisValueLabel??points[0]?.name??'',...points.map(point=>{
   const code=currencies[point.seriesIndex]
   const row=rows.value.find(r=>r.id===ids[point.dataIndex??-1]&&r.currency===code)
   const count=props.chartId==='salesperson_receipts'&&['person','department'].includes(dimension.value)?`\n订单量：${row?.orderCount?.toLocaleString('zh-CN')??'—'} 笔`:''
   return `订单金额${currencies.length>1?`（${code}）`:''}：${formatKnownCurrency(point.value,code)}${count}`
  })].filter(Boolean).join('\n')
 }}:{}
 const customerTooltip=props.chartId==='customer_orders'&&dimension.value==='customer'?{formatter:(raw:unknown)=>{
  const point=(Array.isArray(raw)?raw[0]:raw) as {dataIndex?:number}|undefined
  const row=point?.dataIndex===undefined?undefined:rows.value.find(r=>r.id===ids[point.dataIndex!])
  if(!row)return ''
  const lines=[`业务员：${row.customerOwnerName?.trim()||'未绑定业务员'}`,`订单数：${row.orderCount.toLocaleString('zh-CN')}`]
  if(metric.value==='quantity')lines.push(`商品件数：${row.quantity===null?'—':Number(row.quantity).toLocaleString('zh-CN')}`)
  return lines.join('\n')
 }}:{}
 return {tooltip:{trigger:'axis' as const,renderMode:'richText' as const,...(usdOnly?{valueFormatter:usd}:{}),...moneyTooltip,...customerTooltip},legend:{show:monetary.value&&!departmentRevenue.value},grid:{left:usdOnly?16:65,right:25,bottom:70,top:40,containLabel:usdOnly},
 xAxis:{type:'category' as const,data:labels,axisLabel:{rotate:labels.length>8?25:0,width:100,overflow:'truncate' as const}},
 yAxis:{type:'value' as const,minInterval:monetary.value?undefined:1,...(usdOnly?{axisLabel:{formatter:usd}}:{})},
 series:currencies.map(code=>({name:monetary.value?(currencies.length===1?'订单金额':`订单金额（${code}）`):code,type:['day','month'].includes(dimension.value)?'line' as const:'bar' as const,smooth:true,barMaxWidth:32,...(monetary.value&&code==='USD'?{tooltip:{valueFormatter:usd}}:{}),
 data:ids.map(id=>{const r=rows.value.find(r=>r.id===id&&(!monetary.value||r.currency===code));const value=r?(monetary.value?r.amount:registration.value?r.registrationCount??r.orderCount:metric.value==='quantity'?r.quantity:r.orderCount):null;return value===null?null:Number(value)})}))}
})
const option=computed(()=>{
 const chart=baseOption.value
 if(!registration.value||!registrationReference.value)return chart
 return {...chart,grid:{left:65,right:25,bottom:70,top:40,containLabel:false},
  yAxis:{...(chart.yAxis as Record<string,unknown>),...registrationAxis(registrationReference.value,dimension.value)}} as typeof chart
})
const selectedTrend=ref<{target:TrendTarget;query:LocalAnalyticsQuery}>()
const trendMetric=computed<TrendMetric>(()=>monetary.value?'amount':registration.value?'registrations':metric.value==='quantity'?'quantity':'orders')
const trendMetricLabel=computed(()=>monetary.value?'订单金额':registration.value?'注册客户数':metric.value==='quantity'?'商品件数':'订单数')
const trendTargets=computed<(TrendTarget|null)[]>(()=>{
 if(!['department','person','customer','country','warehouse'].includes(dimension.value))return []
 if(comparisonOption.value)return comparisonOption.value.trendTargets
 if(salespersonChart.value)return salespersonChart.value.targets
 return [...new Set(rows.value.map(r=>r.id))].map(id=>{const row=rows.value.find(r=>r.id===id)!;return id==='unknown'?null:{dimension:dimension.value as TrendTarget['dimension'],id,name:row.englishName||row.label}})
})
const availableTrendTargets=computed(()=>trendTargets.value.filter((t):t is TrendTarget=>!!t))
const trendScope=computed(()=>[filters.value.departments.find(d=>d.id===department.value)?.name??initialDepartmentLabel.value,...(!registration.value?[warehouse.value?warehouseName(warehouse.value):'全部仓库',entity.value==='stock'?'备货订单':'履约订单']:[])].join(' · '))
function openTrend(target:TrendTarget|undefined,event?:ChartClick){
 if(!target||busy.value||!appliedQuery)return
 const period=comparisonOption.value&&result.value?.comparison?(event?.seriesIndex!==undefined&&event.seriesIndex%2===0?result.value.comparison.previous:result.value.comparison.current):undefined
 selectedTrend.value={target,query:{...appliedQuery,comparison:undefined,...period?{from:period.from,to:period.to}:{}}}
}
function selectChart(event:ChartClick){if(event.dataIndex!==undefined)openTrend(trendTargets.value[event.dataIndex]??undefined,event)}
watch([dimension,metric,department,warehouse,from,to,entity,comparison],()=>{selectedTrend.value=undefined})
const dateQuery=useDateRangeQuery(from,to,load,()=>({min:availableStart.value,max:availableEnd.value}))
let appliedQuery:LocalAnalyticsQuery|undefined
const filterQuery=useChartQuerySchedule(()=>load(),()=>{generation++;busy.value=true})
const chartRefresh=useAnalyticsRefresh(()=>load(false,true),()=>busy.value,true)
async function load(force=false,automatic=false){
 filterQuery.cancel()
 if(!automatic){dateQuery.cancel();if(!dateQuery.isValid())return;dateQuery.markApplied()}
 selectedTrend.value=undefined
 const request=++generation;busy.value=true;error.value=''
 const submitted=automatic&&appliedQuery?appliedQuery:{chartId:props.chartId,from:from.value,to:to.value,comparison:comparison.value||undefined,departmentId:department.value||undefined,warehouseCode:registration.value?undefined:warehouse.value||undefined,currency:monetary.value?'USD':undefined,entityType:registration.value?undefined:entity.value}
 const cached=peekAnalyticsQuery<LocalAnalyticsResult>(props.workbench?'/workbench/analytics/workbench':'/workbench/analytics/dashboard',submitted)
 const referenceQueries=registration.value?registrationReferences(submitted,filters.value.departments):[]
 const endpoint=props.workbench?'/workbench/analytics/workbench':'/workbench/analytics/dashboard'
 const cachedReferences=referenceQueries.map(query=>peekAnalyticsQuery<LocalAnalyticsResult>(endpoint,query))
 if(cached&&(!registration.value||cachedReferences.every(Boolean))){
  if(registration.value)registrationReference.value=mergeRegistrationReferences(cachedReferences as LocalAnalyticsResult[])
  result.value={...cached,rows:cached.rows.map(r=>r.dimension==='warehouse'?{...r,label:warehouseName(r.label||r.id)}:r)};filters.value=cached;summaryOnly.value=cached.summaryOnly;appliedQuery={...submitted}
 }
 try{
 const dataRequest=getLocalDashboardAnalytics(submitted,{force},props.workbench)
 const references=referenceQueries.map(query=>query.departmentId===submitted.departmentId?dataRequest:getLocalDashboardAnalytics(query,{force},props.workbench))
 const [value,referenceValues]=await Promise.all([dataRequest,Promise.all(references)])
 if(request!==generation)return
 if(registration.value)registrationReference.value=mergeRegistrationReferences(referenceValues)
 appliedQuery={...submitted};chartRefresh.updated(value);result.value={...value,rows:value.rows.map(r=>r.dimension==='warehouse'?{...r,label:warehouseName(r.label||r.id)}:r)};filters.value=value;if(!department.value)department.value=value.defaultDepartmentId??value.departments.find(d=>d.name==='营销中心')?.id??value.departments[0]?.id??'';summaryOnly.value=value.summaryOnly;if(!dimensions.value.some(d=>d.id===dimension.value))dimension.value=dimensions.value[0]!.id}
 catch(e){if(request===generation){if(isWorkbenchScopeError(e))result.value=undefined;const failure=e as {code?:string;response?:{data?:{code?:string}}};const code=failure?.code??failure?.response?.data?.code;error.value=code==='comparison_window_not_captured'?'数据尚未覆盖所选对比周期，请选择较早周期。':registration.value&&code==='local_analytics_capture_unavailable'?'客户注册数据尚未完成本地采集，请稍后重试。':registration.value&&code==='registration_window_not_captured'?'所选创建日期尚未完整采集，请调整日期或补采。':'分析数据加载失败，请重试。'}}finally{if(request===generation)busy.value=false}
}
const stop=onSessionReset(()=>{generation++;selectedTrend.value=undefined;department.value='';warehouse.value='';result.value=undefined;registrationReference.value=undefined;filters.value={departments:[],warehouses:[],currencies:[]};error.value='';busy.value=false})
onBeforeUnmount(()=>{generation++;stop()})
watch(()=>[props.chartId,props.revision],()=>load(!!props.revision),{immediate:true})
watch(department,value=>{if(result.value?.personalDepartmentId&&value!==result.value.personalDepartmentId)warehouse.value=''}, {flush:'sync'})
</script>
<template>
<section class="local-analytics" :data-local-chart="chartId">
 <header><h2>{{ title }}</h2><ChartUpdateStatus :busy="busy" :as-of="result?.asOf" /></header>
 <p v-if="registration&&availableWindow" class="available-range">可查询至 {{ availableEnd }} · UTC+8</p>
 <form @submit.prevent="load(true)">
  <div class="receipt-month-shortcuts" role="group" :aria-label="registration?'注册日期快捷选择':'收款日期快捷选择'">
   <button type="button" :aria-pressed="receiptRangeSelected()" @click="chooseReceiptRange()">本月</button>
   <button type="button" :aria-pressed="receiptRangeSelected('previous')" :disabled="quickReceiptRange('previous').from>quickReceiptRange('previous').to" @click="chooseReceiptRange('previous')">上月</button>
   <button type="button" :aria-pressed="receiptRangeSelected('last6months')" :disabled="quickReceiptRange('last6months').from>quickReceiptRange('last6months').to" @click="chooseReceiptRange('last6months')">近半年</button>
  </div>
  <label>{{ registration?'客户创建时间':'收款日期' }}<input v-model="displayFrom" type="date" required :min="comparisonRange?.from ?? availableStart" :max="displayTo"></label><span>—</span><input v-model="displayTo" :aria-label="registration?'客户创建结束日期':'收款结束日期'" type="date" required :min="displayFrom" :max="availableEnd">
  <label>业务部门<select v-model="department" @change="filterQuery.schedule()" aria-label="业务部门" :disabled="busy||!filters.departments.length"><option v-if="!filters.departments.length" value="">{{ initialDepartmentLabel }}</option><option v-for="d in filters.departments" :key="d.id" :value="d.id">{{ d.name }}</option></select></label>
  <label v-if="!monetary&&!registration">订单类型<select v-model="entity" @change="filterQuery.schedule()" aria-label="订单类型"><option value="fulfillment">履约订单</option><option value="stock">备货订单</option></select></label>
  <label v-if="!registration">仓库<select v-model="warehouse" @change="filterQuery.schedule()" aria-label="仓库"><option value="">全部</option><option v-for="w in warehouseChoices" :key="w.id" :value="w.id">{{ warehouseName(w.name || w.id) }}</option></select></label>
  <label>对比<select v-model="comparison" aria-label="对比方式" :disabled="busy" @change="chooseComparison"><option value="">不对比</option><option value="week">周环比</option><option value="month">月环比</option></select></label>
  <label v-if="comparison">选择{{ comparison==='week'?'周':'月份' }}<input v-model="comparisonAnchor" type="date" aria-label="对比周期日期" :min="availableStart" :max="availableEnd" @change="chooseComparison"></label>
  <button :disabled="busy">查询</button>
 </form><p v-if="error && result" class="ov-note" role="alert">查询未完成，当前显示上次查询结果。</p>
 <div class="analysis-controls"><label>展示维度<select v-model="dimension" aria-label="展示维度"><option v-for="d in dimensions" :key="d.id" :value="d.id">{{ d.name }}</option></select></label><label v-if="!monetary&&!registration">指标<select v-model="metric"><option value="orders">订单数</option><option value="quantity">商品件数</option></select></label><span v-if="displayedTotals">{{ (registration?displayedTotals.registrationCount??displayedTotals.orderCount:displayedTotals.orderCount).toLocaleString() }} {{ registration?'位注册客户':'笔' }} · {{ registration?'按档案创建时间统计':monetary?'按订单金额统计':'按收款日期统计' }}</span><button v-if="availableTrendTargets.length" type="button" class="trend-open" :disabled="busy" @click="openTrend(availableTrendTargets[0])">趋势明细</button></div>
 <div v-if="monetary&&incomeTotals.length" class="income-total"><span>业绩收入合计</span><strong v-for="total in incomeTotals" :key="total.currency">{{ total.currency==='USD'?usd(Number(total.amount)):`${total.currency} ${Number(total.amount).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}` }}</strong></div>
 <ComparisonSummary v-if="displayedComparison" :comparison="displayedComparison" :metric="monetary?'amount':registration?'count':metric==='quantity'?'quantity':'count'"/>
 <p v-if="error" role="alert">{{ error }}</p>
 <div v-if="groupedSalespeople&&hasData" class="revenue-legend"><span><i class="department-swatch"/>部门汇总</span><span><i class="person-swatch"/>业务员</span></div>
 <div class="chart" :class="{'grouped-revenue':groupedSalespeople||comparisonPeople}" :aria-busy="busy"><EChart v-if="hasData" :option="option" :style="comparisonPeople?{minWidth:`${Math.max(600, (option.xAxis as {data:unknown[]}).data.length*85)}px`}:salespersonChart?{minWidth:`${salespersonChart.minWidth}px`}:undefined" :label="title" :can-export="false" @select="selectChart"/><p v-else class="empty">{{ busy?'正在查询…':monetary&&result?.missingCurrencyCount?'订单结算币种待补齐，暂不汇总业绩金额':error?'暂不可用':'所选范围暂无可展示数据' }}</p></div>
 <p v-if="displayedTotals" class="note">{{ registration&&displayedTotals.missingCreatedAtCount?`${displayedTotals.missingCreatedAtCount.toLocaleString()} 位客户缺少创建时间，未计入。`:'' }}<span v-if="!registration&&displayedTotals.missingPaidAtCount" class="payment-date-note" title="按收款日期统计；缺日期记录不限定所选付款期间。"><template v-if="displayedTotals.missingPaidAtBreakdown"><span v-if="displayedTotals.missingPaidAtBreakdown.unpaid">未收款 {{ displayedTotals.missingPaidAtBreakdown.unpaid.toLocaleString('zh-CN') }} 笔未计入。 </span><span v-if="paymentDateWarning" class="payment-date-warning">{{ paymentDateWarning }}，未计入。 </span></template><template v-else>{{ displayedTotals.missingPaidAtCount.toLocaleString() }} 笔无收款日期，未计入。 </template></span>{{ monetary&&displayedTotals.missingCurrencyCount?`${displayedTotals.missingCurrencyCount.toLocaleString()} 笔缺少币种，未计入金额。`:'' }}{{ categoriesTruncated?'仅显示前 20 项。':'' }}</p>
<AnalyticsTrendDialog v-if="selectedTrend" :title="title" :target="selectedTrend.target" :targets="availableTrendTargets" :query="selectedTrend.query" :metric="trendMetric" :metric-label="trendMetricLabel" :scope="trendScope" @close="selectedTrend=undefined" @select="selectedTrend.target=$event"/>
</section>
</template>
<style scoped>
.receipt-month-shortcuts{display:inline-flex;align-items:center;gap:4px}
.receipt-month-shortcuts button{background:transparent;color:var(--color-text-secondary);padding:5px 8px;font-size:11px;line-height:18px}
.receipt-month-shortcuts button:hover:not(:disabled){color:var(--color-selection-text);background:var(--color-selection-surface);border-color:var(--color-selection-border)}
.receipt-month-shortcuts button[aria-pressed="true"]{color:var(--color-selection-text);background:color-mix(in srgb,var(--color-primary) 12%,var(--color-selection-surface));border-color:var(--color-selection-border);font-weight:600}
.receipt-month-shortcuts button:focus-visible{outline:2px solid var(--color-selection-text);outline-offset:2px}
.receipt-month-shortcuts button:disabled{opacity:.5;cursor:default}

.analysis-controls .trend-open{margin-left:auto;background:transparent;color:var(--color-chart-link,var(--color-link));border-color:var(--color-border,var(--color-border))}.trend-open:disabled{opacity:.5;cursor:default}
.grouped-revenue{overflow-x:auto;overflow-y:hidden;padding-bottom:12px}
.revenue-legend{display:flex;gap:18px;margin:12px 0;color:var(--color-text-secondary);font-size:12px}.revenue-legend span{display:flex;align-items:center;gap:6px}.revenue-legend i{width:10px;height:10px;border-radius:2px}.department-swatch{background:var(--color-primary)}.person-swatch{background:var(--color-chart-detail)}
.available-range{margin:-8px 0 16px;color:var(--color-text-secondary);font-size:12px}
.payment-date-warning{color:#a66313}:global(.dark .payment-date-warning){color:#efb65b}
.income-total{display:flex;gap:16px;align-items:center;margin:12px 0;font-size:13px}.income-total strong{font-size:20px;font-variant-numeric:tabular-nums}
.local-analytics{margin-top:22px;padding:24px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface);color:var(--color-text)}
header,form,.analysis-controls{display:flex;align-items:center;flex-wrap:wrap;gap:12px}header{justify-content:space-between;margin-bottom:20px}h2{font-size:16px;font-weight:600}small,.note,.analysis-controls>span{color:var(--color-text-secondary);font-size:12px}label{display:inline-flex;align-items:center;gap:8px;font-size:12px}input,select,button{border:1px solid var(--color-border);border-radius:6px;padding:7px 9px;background:transparent;color:inherit;font-size:12px}button{background:var(--color-primary);color:var(--color-on-primary)}.analysis-controls{margin:18px 0}.chart{height:340px}.empty{height:100%;display:grid;place-content:center;color:var(--color-text-secondary);font-size:13px}.note{min-height:18px;margin-top:8px}:global(.dark .local-analytics){background:var(--color-surface);border-color:var(--color-border);color:var(--color-text)}:global(.dark .local-analytics input),:global(.dark .local-analytics select){color-scheme:dark;border-color:var(--color-border);background:var(--color-surface)}
</style>
