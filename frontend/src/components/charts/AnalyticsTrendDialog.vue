<script setup lang="ts">
import { peekAnalyticsQuery } from '@/utils/analytics-cache'
import { isWorkbenchScopeError } from '@/api/workbench-dashboard'
import { computed,onBeforeUnmount,onMounted,ref,useId,watch } from 'vue'
import { X,ChartNoAxesCombined } from 'lucide-vue-next'
import EChart from './EChart.vue'
import { getLocalDashboardTrend,type DashboardTrendResult,type LocalAnalyticsQuery,type TrendTarget } from '@/api/local-dashboard-analytics'
import { trendChart,type TrendMetric } from '@/utils/dashboard-trend'
import { formatKnownCurrency } from '@/utils/currency'
import { onSessionReset } from '@/utils/session'
import { useTheme } from '@/composables/useTheme'
const props=defineProps<{title:string;target:TrendTarget;targets:TrendTarget[];query:LocalAnalyticsQuery;metric:TrendMetric;metricLabel:string;scope:string}>()
const emit=defineEmits<{close:[];select:[target:TrendTarget]}>()
const dialog=ref<HTMLDialogElement>(),closeButton=ref<HTMLButtonElement>(),titleId=useId()
const ready=ref(false),busy=ref(false),error=ref(''),data=ref<DashboardTrendResult>()
const {isDark}=useTheme()
const grain=ref<'day'|'month'>((Date.parse(props.query.to)-Date.parse(props.query.from))/86400000<=62?'day':'month')
const selected=computed(()=>props.targets.findIndex(t=>t.id===props.target.id&&t.dimension===props.target.dimension))
const option=computed(()=>data.value?trendChart(data.value,props.metric,props.metricLabel,isDark.value):{})
const total=computed(()=>{const d=data.value;if(!d)return '—';const value=props.metric==='registrations'?d.registrationCount??d.orderCount:props.metric==='orders'?d.orderCount:props.metric==='quantity'?d.totalQuantity:d.amount;return value==null?'—':props.metric==='amount'?formatKnownCurrency(Number(value),d.currency??'USD'):Number(value).toLocaleString('zh-CN')})
let request=0,opener:HTMLElement|undefined
async function load(){
 const current=++request;busy.value=true;error.value=''
 const {comparison:_comparison,...query}=props.query
 const submitted={...query,dimension:props.target.dimension,id:props.target.id,grain:grain.value}
 const cached=peekAnalyticsQuery<DashboardTrendResult>('/workbench/analytics/dashboard/trend',submitted);if(cached)data.value=cached
 try{const response=await getLocalDashboardTrend(submitted);if(current===request)data.value=response}
 catch(cause){if(isWorkbenchScopeError(cause)&&current===request)data.value=undefined;if(current===request)error.value='趋势暂不可用，请重试或检查数据权限。'}
 finally{if(current===request)busy.value=false}
}
const stop=onSessionReset(()=>{request++;data.value=undefined;emit('close')})
watch(()=>[props.target.id,props.target.dimension,props.query,grain.value],load,{immediate:true})
onMounted(()=>{opener=document.activeElement instanceof HTMLElement?document.activeElement:undefined;dialog.value?.showModal();closeButton.value?.focus({preventScroll:true});ready.value=true})
onBeforeUnmount(()=>{request++;stop();dialog.value?.close();if(opener?.isConnected)opener.focus({preventScroll:true})})
</script>
<template>
 <Teleport to="body"><dialog ref="dialog" class="analytics-trend-dialog" :aria-labelledby="titleId" aria-modal="true" @cancel.prevent="emit('close')" @click.self="emit('close')">
  <header><div class="trend-heading"><ChartNoAxesCombined :size="20"/><div><h2 :id="titleId">{{target.name}} · {{metricLabel}}趋势</h2><p>{{title}}</p></div></div><button ref="closeButton" class="trend-close" aria-label="关闭趋势" @click="emit('close')"><X :size="19"/></button></header>
  <div class="trend-body">
   <div class="trend-toolbar"><label>分析对象<select :value="selected" aria-label="趋势分析对象" @change="emit('select',targets[Number(($event.target as HTMLSelectElement).value)]!)"><option v-for="(t,index) in targets" :key="`${t.dimension}:${t.id}`" :value="index">{{t.dimension==='department'?'部门 · ':t.dimension==='person'?'业务员 · ':''}}{{t.name}}</option></select></label><div class="trend-grain" role="group" aria-label="趋势时间维度"><button :class="{active:grain==='day'}" :aria-pressed="grain==='day'" @click="grain='day'">按日</button><button :class="{active:grain==='month'}" :aria-pressed="grain==='month'" @click="grain='month'">按月</button></div></div>
   <div class="trend-context"><span>{{query.from}} — {{query.to}}</span><span>{{scope}}</span><span>{{query.chartId==='registrations'?'客户创建时间':'收款日期'}} · UTC+8</span></div>
   <div class="trend-total"><span>{{metricLabel}}合计</span><strong>{{total}}</strong><small v-if="data&&metric==='amount'">{{data.orderCount.toLocaleString('zh-CN')}} 笔订单</small></div>
   <div class="trend-plot" :aria-busy="busy"><EChart v-if="ready&&data" :option="option" :label="`${target.name} · ${metricLabel}趋势`" :can-export="false"/><div v-else-if="error" class="trend-empty" role="alert">{{error}}<button @click="load">重试</button></div><div v-else class="trend-empty">正在查询趋势…</div></div>
   <p v-if="data?.missingAmountCount&&metric==='amount'" class="trend-note">{{data.missingAmountCount}} 笔订单金额不完整，相关周期留空。</p>
   <p v-else-if="data&&metric==='quantity'&&data.totalQuantity===null" class="trend-note">部分商品数量不完整，相关周期留空。</p>
  </div>
 </dialog></Teleport>
</template>
<style scoped>
.analytics-trend-dialog{position:fixed;inset:0;width:min(1120px,calc(100vw - 48px));max-width:none;max-height:calc(100dvh - 48px);padding:0;margin:auto;border:1px solid var(--color-border,var(--color-border));border-radius:14px;background:var(--color-surface,#fff);color:var(--color-text);box-shadow:0 24px 90px #15274730;overflow:hidden}.analytics-trend-dialog[open]{display:flex;flex-direction:column}.analytics-trend-dialog::backdrop{background:rgb(24 37 58 / 38%);backdrop-filter:blur(3px)}header{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--color-border,var(--color-border));gap:16px}.trend-heading{display:flex;align-items:center;gap:12px;min-width:0}.trend-heading>svg{color:var(--color-link);flex-shrink:0}h2{font-size:16px;font-weight:650;overflow-wrap:anywhere;line-height:1.5}.trend-heading p{font-size:12px;color:var(--color-text-secondary,#8490a3);margin-top:3px}.trend-close{display:grid;place-items:center;flex-shrink:0;padding:8px;border:1px solid var(--color-border,var(--color-border));border-radius:7px;background:transparent;color:inherit}.trend-body{padding:20px 24px 24px;overflow:auto;overscroll-behavior:contain;min-height:0}.trend-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.trend-toolbar label{display:flex;align-items:center;gap:10px;font-size:12px}.trend-toolbar select{min-width:180px;max-width:min(420px,65vw);padding:8px 30px 8px 12px;border:1px solid var(--color-border,var(--color-border));border-radius:7px;background:var(--color-surface,#fff);color:inherit}.trend-grain{display:flex;padding:3px;gap:3px;border:1px solid var(--color-border,var(--color-border));border-radius:8px;background:var(--color-bg,#f5f7fb)}.trend-grain button{font-size:12px;padding:5px 16px;border-radius:5px;color:var(--color-text-secondary,#8490a3)}.trend-grain .active{background:var(--color-primary);color:var(--color-on-primary)}.trend-context{display:flex;flex-wrap:wrap;gap:8px 18px;margin:14px 0 18px;color:var(--color-text-secondary,#8490a3);font-size:12px}.trend-total{display:flex;align-items:baseline;gap:12px;margin-bottom:8px;font-size:12px}.trend-total>span,.trend-total small{color:var(--color-text-secondary,#8490a3)}.trend-total strong{font-size:24px;font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.03em}.trend-plot{height:clamp(260px,42dvh,420px)}.trend-empty{height:100%;display:flex;align-items:center;justify-content:center;gap:12px;color:var(--color-text-secondary,#8490a3);font-size:13px}.trend-empty button{color:var(--color-link)}.trend-note{font-size:12px;color:#a66313;margin-top:8px}:global(body:has(.analytics-trend-dialog[open])),:global(body:has(.analytics-trend-dialog[open]) main){overflow:hidden}:global(.dark .analytics-trend-dialog){background:var(--color-surface);border-color:#334155;color:var(--color-text)}:global(.dark .trend-toolbar select){background:var(--color-surface);color:var(--color-text);color-scheme:dark}:global(.dark .trend-note){color:#efb65b}@media(max-width:640px){.analytics-trend-dialog{width:calc(100vw - 24px);max-height:calc(100dvh - 24px)}header,.trend-body{padding:16px}.trend-toolbar{gap:10px}.trend-total strong{font-size:22px}}
:global(.dark .analytics-trend-dialog .trend-grain){background:#101824;border-color:#334155}:global(.dark .analytics-trend-dialog .trend-grain button:not(.active)){color:var(--color-text-secondary)}.trend-close:hover{background:#6177cc14}.trend-grain button:focus-visible,.trend-close:focus-visible{outline:2px solid #91a6ff;outline-offset:2px}
</style>
