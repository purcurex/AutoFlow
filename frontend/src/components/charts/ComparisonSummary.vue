<script setup lang="ts">
import { computed } from 'vue'
import type { LocalAnalyticsResult } from '@/api/local-dashboard-analytics'
import { formatKnownCurrency, currencyLabel } from '@/utils/currency'
const props=defineProps<{comparison:NonNullable<LocalAnalyticsResult['comparison']>;metric:string}>()
const metrics=computed(()=>props.comparison.metrics.filter(m=>props.metric==='amount'?!['count','quantity'].includes(m.key):m.key===props.metric))
const format=(v:number|null,key:string)=>v===null?'—':['count','quantity'].includes(key)?v.toLocaleString('zh-CN'):formatKnownCurrency(v,key)
const time=(v:string)=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})
</script>
<template>
 <section class="comparison-summary" aria-label="环比分析">
  <p :title="`本期查询截止 ${time(comparison.current.end)}；上期查询截止 ${time(comparison.previous.end)}（不含截止时点，UTC+8）`">本期 {{ comparison.current.from }} 至 {{ comparison.current.to }} · 上期 {{ comparison.previous.from }} 至 {{ comparison.previous.to }}</p>
  <p v-if="!comparison.available">暂不可比：上期数据覆盖不足。</p>
  <p v-else-if="!metrics.length">暂无可比较数据</p>
  <div v-for="m in metrics" :key="m.key" class="comparison-values">
   <span v-if="metric==='amount'&&metrics.length>1">{{ currencyLabel(m.key) }}</span><span>本期 <b>{{ format(m.current,m.key) }}</b></span><span>上期 <b>{{ format(m.previous,m.key) }}</b></span><span>增减 <b>{{ m.delta!==null&&m.delta>0?'+':'' }}{{ format(m.delta,m.key) }}</b></span>
   <span>{{ comparison.mode==='week'?'周环比':'月环比' }} <b>{{ m.status==='unavailable'?'暂不可比':m.status==='new'?'新增':m.status==='flat'?'持平':`${m.percent!>0?'+':''}${m.percent?.toFixed(2)}%` }}</b></span>
  </div>
 </section>
</template>
<style scoped>
.comparison-summary{margin:16px 0;padding:14px 16px;border:1px solid var(--border-color,#dce3ee);border-radius:8px;background:var(--bg-card,transparent);font-size:12px}.comparison-summary p{margin:0 0 8px;color:var(--color-text-secondary,#8793a5);line-height:1.7}.comparison-values{display:flex;flex-wrap:wrap;gap:12px 24px;line-height:1.8}.comparison-values b{margin-left:5px;font-variant-numeric:tabular-nums;color:var(--color-text-primary,inherit)}
:global(.dark .comparison-summary){background:#151d29;border-color:#334155;color:#dbe4ef}:global(.dark .comparison-values b){color:inherit}
</style>
