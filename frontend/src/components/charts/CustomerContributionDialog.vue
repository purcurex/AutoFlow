<script setup lang="ts">
import { computed,onBeforeUnmount,onMounted,ref,useId,watch } from 'vue'
import { ChartColumnDecreasing,X } from 'lucide-vue-next'
import EChart from './EChart.vue'
import ChartUpdateStatus from './ChartUpdateStatus.vue'
import { getCustomerContribution,type ContributionTarget,type CustomerContributionResult,type LocalAnalyticsQuery } from '@/api/local-dashboard-analytics'
import { formatChartCurrency } from '@/utils/currency'
import { onSessionReset } from '@/utils/session'
import { useChartQuerySchedule } from '@/composables/useChartQuerySchedule'
import { useAnalyticsRefresh } from '@/composables/useAnalyticsRefresh'
const props=defineProps<{target:ContributionTarget;targets:ContributionTarget[];query:LocalAnalyticsQuery;scope:string}>()
const emit=defineEmits<{close:[];select:[target:ContributionTarget]}>()
const dialog=ref<HTMLDialogElement>(),closeButton=ref<HTMLButtonElement>(),titleId=useId(),ready=ref(false)
const data=ref<CustomerContributionResult>(),busy=ref(false),error=ref(''),chartCreated=ref(false)
let request=0,opener:HTMLElement|undefined
const limit=computed(()=>props.target.dimension==='department'?10:5)
const selected=computed(()=>props.targets.findIndex(t=>t.id===props.target.id&&t.dimension===props.target.dimension))
const amount=computed(()=>data.value?.amount==null?null:Number(data.value.amount))
const topThreeAmount=computed(()=>data.value?.rows.slice(0,3).reduce((sum,r)=>sum+Number(r.amount),0)??0)
const rankedAmount=computed(()=>data.value?.rows.reduce((sum,r)=>sum+Number(r.amount),0)??0)
const percent=(value:number)=>amount.value!==null&&amount.value>0?`${(value/amount.value*100).toFixed(2)}%`:'—'
const option=computed(()=>({
 tooltip:{trigger:'axis' as const,renderMode:'richText' as const,confine:true,formatter:(raw:unknown)=>{
  const point=(Array.isArray(raw)?raw[0]:raw) as {dataIndex:number},row=data.value?.rows[point.dataIndex];if(!row)return ''
  return [row.label,`订单金额：${formatChartCurrency(Number(row.amount))}`,`贡献占比：${percent(Number(row.amount))}`,`订单笔数：${row.orderCount.toLocaleString('zh-CN')} 笔`,...(row.customerOwnerName?[`业务员：${row.customerOwnerName}`]:[])].join('\n')
 }},grid:{left:12,right:20,top:40,bottom:20,containLabel:true},
 xAxis:{type:'category' as const,data:data.value?.rows.map(r=>r.label)??[],axisTick:{show:false},axisLabel:{interval:0,rotate:limit.value===10?20:0,width:130,overflow:'truncate' as const}},
 yAxis:{type:'value' as const,axisLabel:{formatter:(value:number)=>formatChartCurrency(value)}},
 series:[{name:'订单金额',type:'bar' as const,barMaxWidth:46,itemStyle:{borderRadius:[5,5,0,0]},label:{show:true,position:'top' as const,fontSize:11,formatter:(p:{value:number})=>formatChartCurrency(p.value)},data:data.value?.rows.map(r=>Number(r.amount))??[]}],
}))
function invalidate(){request++;data.value=undefined;busy.value=true;error.value=''}
const schedule=useChartQuerySchedule(()=>load(),invalidate)
const refresh=useAnalyticsRefresh(()=>load(false,true),()=>busy.value,true)
async function load(force=false,retain=false){
 schedule.cancel();const current=++request;if(!retain)data.value=undefined;busy.value=true;error.value=''
 const {comparison:_comparison,...base}=props.query
 try{const value=await getCustomerContribution({...base,dimension:props.target.dimension,id:props.target.id},{force});if(current===request){refresh.updated(value);chartCreated.value||=!!value.rows.length;if(JSON.stringify(data.value)!==JSON.stringify(value))data.value=value}}
 catch{if(current===request){data.value=undefined;error.value='客户贡献暂不可用，请重试或检查数据权限。'}}
 finally{if(current===request)busy.value=false}
}
watch(()=>[props.target.id,props.target.dimension,props.query],(_value,previous)=>{if(previous)schedule.schedule();else void load()},{immediate:true})
const stop=onSessionReset(()=>{request++;data.value=undefined;emit('close')})
onMounted(()=>{opener=document.activeElement instanceof HTMLElement?document.activeElement:undefined;dialog.value?.showModal();closeButton.value?.focus({preventScroll:true});ready.value=true})
onBeforeUnmount(()=>{request++;stop();dialog.value?.close();if(opener?.isConnected)opener.focus({preventScroll:true})})
</script>
<template>
 <Teleport to="body"><dialog ref="dialog" class="customer-contribution-dialog" :aria-labelledby="titleId" aria-modal="true" @cancel.prevent="emit('close')" @click.self="emit('close')">
  <header><div class="heading"><ChartColumnDecreasing :size="21"/><div><h2 :id="titleId">{{target.name}} · 客户业绩贡献</h2><p>客户订单分析</p></div></div><ChartUpdateStatus :busy="busy" :as-of="data?.asOf"/><button ref="closeButton" class="close" aria-label="关闭客户贡献" @click="emit('close')"><X :size="19"/></button></header>
  <div class="body">
   <div class="toolbar"><label>分析对象<select :value="selected" aria-label="客户贡献分析对象" @change="emit('select',targets[Number(($event.target as HTMLSelectElement).value)]!)"><option v-for="(t,index) in targets" :key="`${t.dimension}:${t.id}`" :value="index">{{t.dimension==='department'?'部门 · ':'业务员 · '}}{{t.name}}</option></select></label><span class="ranking">前 {{limit}} 名<span> · 按金额排序</span></span></div>
   <div class="context"><span>{{query.from}} — {{query.to}}</span><span>{{scope}}</span><span>收款日期 · UTC+8</span></div>
   <div class="totals"><div><span>订单金额合计</span><strong>{{amount===null?'—':formatChartCurrency(amount)}}</strong></div><div><span>前三客户贡献</span><strong class="share">{{data?percent(topThreeAmount):'—'}}</strong></div><div><span>上榜客户贡献</span><strong class="share">{{data?percent(rankedAmount):'—'}}</strong></div><span v-if="data" class="counts">合计 {{data.customerCount.toLocaleString('zh-CN')}} 位客户 · {{data.orderCount.toLocaleString('zh-CN')}} 笔</span></div>
   <div class="plot" :aria-busy="busy"><EChart v-if="ready&&chartCreated" v-show="!!data?.rows.length" :option="option" :label="`${target.name}客户业绩贡献`" :can-export="false"/><div v-if="!data?.rows.length" class="empty" :role="error?'alert':undefined"><template v-if="error">{{error}}<button @click="load(true)">重试</button></template><template v-else>{{busy?'正在查询客户贡献…':'所选范围暂无可排名客户'}}</template></div></div>
   <p class="note">{{data?.missingAmountCount?`${data.missingAmountCount} 笔金额缺失，相关客户未参与排名。`:data?.rows.length?`展示 ${data.rows.length} 位客户 · 贡献占比按所选范围金额计算`:''}}</p>
  </div>
 </dialog></Teleport>
</template>
<style scoped>
.customer-contribution-dialog{position:fixed;inset:0;margin:auto;width:min(1160px,calc(100vw - 48px));max-width:none;max-height:calc(100dvh - 48px);padding:0;border:1px solid var(--color-border);border-radius:14px;background:var(--color-surface);color:var(--color-text);box-shadow:0 24px 90px #15274730;overflow:hidden}.customer-contribution-dialog[open]{display:flex;flex-direction:column}.customer-contribution-dialog::backdrop{background:rgb(24 37 58 / 38%);backdrop-filter:blur(3px)}header{display:flex;align-items:center;gap:16px;padding:20px 24px;border-bottom:1px solid var(--color-border)}.heading{display:flex;gap:12px;align-items:center;min-width:0;flex:1}.heading>svg{color:var(--color-link);flex-shrink:0}h2{font-size:16px;font-weight:650;line-height:1.5;overflow-wrap:anywhere}.heading p{font-size:12px;color:var(--color-text-secondary);margin-top:3px}.close{display:grid;place-items:center;padding:8px;border:1px solid var(--color-border);border-radius:7px;flex-shrink:0}.close:hover{background:var(--color-selection-surface)}.body{padding:22px 24px 16px;overflow:auto;min-height:0;overscroll-behavior:contain}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.toolbar label{display:flex;align-items:center;gap:10px;font-size:12px}.toolbar select{min-width:190px;max-width:min(420px,65vw);padding:8px 30px 8px 12px;border:1px solid var(--color-border);border-radius:7px;background:var(--color-surface);color:inherit}.ranking{font-size:12px;color:var(--color-link);font-weight:600}.ranking>span{color:var(--color-text-secondary);font-weight:400}.context{display:flex;flex-wrap:wrap;gap:8px 18px;margin:14px 0 22px;font-size:12px;color:var(--color-text-secondary)}.totals{display:flex;align-items:center;gap:36px;min-height:52px}.totals>div{display:flex;flex-direction:column;gap:6px}.totals span{font-size:12px;color:var(--color-text-secondary)}.totals strong{font-size:25px;font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.025em}.totals .share{font-size:21px;color:var(--color-link)}.counts{margin-left:auto}.plot{height:clamp(280px,40dvh,410px);margin-top:14px}.empty{height:100%;display:flex;align-items:center;justify-content:center;gap:12px;color:var(--color-text-secondary);font-size:13px}.empty button{color:var(--color-link)}.note{min-height:18px;margin-top:10px;color:var(--color-text-secondary);font-size:12px}.close:focus-visible,.toolbar select:focus-visible,.empty button:focus-visible{outline:2px solid var(--color-primary);outline-offset:3px}:global(body:has(.customer-contribution-dialog[open])),:global(body:has(.customer-contribution-dialog[open]) main){overflow:hidden}:global(.dark .customer-contribution-dialog select){color-scheme:dark}@media(max-width:640px){.customer-contribution-dialog{width:calc(100vw - 24px);max-height:calc(100dvh - 24px)}header,.body{padding:16px}.totals{gap:20px;flex-wrap:wrap}.counts{margin-left:0}.totals strong{font-size:22px}}
</style>
