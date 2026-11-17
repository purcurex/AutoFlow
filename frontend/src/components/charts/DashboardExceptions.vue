<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { AlertCircle, RefreshCw, ArrowUpRight } from 'lucide-vue-next'
import { type FopOrder } from '@/api/fop-orders'
import { getTaskStatus, taskStatusLabel } from '@/utils/workbench-status'
import { workbenchOrderLocation } from '@/utils/workbench'
import { onSessionReset } from '@/utils/session'
import { EXCEPTION_CACHE_TTL, getDashboardExceptions, peekDashboardExceptions } from '@/utils/dashboard-exception-cache'
const props=defineProps<{forceRefresh?:boolean}>()
const { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const text = (cn:string,en:string) => zh.value ? cn : en
const rows=ref<FopOrder[]>([]), total=ref<number|null>(null), busy=ref(false), error=ref(false)
let revision=0
async function load(force=false){
 const current=++revision
 const cached=peekDashboardExceptions()
 rows.value=cached?.items??[];total.value=cached?.total??null;error.value=false;busy.value=true
 try{
  const result=await getDashboardExceptions(force)
  if(current!==revision)return
  rows.value=result.items;total.value=result.total
 }catch{if(current===revision){rows.value=[];total.value=null;error.value=true}}
 finally{if(current===revision)busy.value=false}
}
const reset=onSessionReset(()=>{revision++;rows.value=[];total.value=null;busy.value=false;error.value=false})
let timer:ReturnType<typeof setInterval>|undefined
function refreshVisible(){if(document.visibilityState==='visible' && navigator.onLine && !busy.value)void load()}
onMounted(()=>{void load(props.forceRefresh);timer=setInterval(refreshVisible,EXCEPTION_CACHE_TTL);document.addEventListener('visibilitychange',refreshVisible)})
onBeforeUnmount(()=>{revision++;reset();clearInterval(timer);document.removeEventListener('visibilitychange',refreshVisible)})
function typeLabel(row:FopOrder){const status=getTaskStatus(row,'exceptions');return status==='unknown'?'':taskStatusLabel(status,'exceptions')[zh.value?0:1]}
</script>
<template>
 <section class="dashboard-panel exception-panel" aria-labelledby="dashboard-exceptions-title">
  <header><h2 id="dashboard-exceptions-title"><AlertCircle :size="17" />{{ text('异常订单','Order exceptions') }}<span v-if="total !== null" class="count">{{ total.toLocaleString() }}</span></h2><button :disabled="busy" @click="load(true)" :aria-label="text('刷新异常订单','Refresh order exceptions')"><RefreshCw :size="14" /></button></header>
  <div class="exception-list" :aria-busy="busy">
   <p v-if="busy && total === null" class="empty">{{ text('加载中…','Loading…') }}</p>
   <p v-else-if="error" class="empty">{{ text('暂时无法加载，请重试','Unable to load. Please retry.') }}</p>
   <p v-else-if="total === 0" class="empty">{{ text('暂无异常订单','No order exceptions') }}</p>
   <RouterLink v-for="row in rows" :key="row.id" :to="workbenchOrderLocation('exceptions',{orderNumber:row.orderNumber})" class="exception-item">
    <div class="item-heading"><strong>{{ row.orderNumber }}</strong><span v-if="typeLabel(row)" class="type">{{ typeLabel(row) }}</span><ArrowUpRight :size="13" /></div>
    <p v-if="row.exception?.reason" class="reason" :title="row.exception.reason">{{ row.exception.reason }}</p>
   </RouterLink>
  </div>
  <footer><span>{{ text('按收款日期倒序','Latest payment first') }}</span><RouterLink :to="workbenchOrderLocation('exceptions')">{{ text('查看全部','View all') }}<ArrowUpRight :size="12" /></RouterLink></footer>
 </section>
</template>
<style scoped>
.exception-panel{min-width:0;background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;overflow:hidden;display:flex;flex-direction:column;height:340px}
header{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--color-border)}
h2{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:650;color:var(--color-text)}
.count{font-size:11px;font-variant-numeric:tabular-nums;color:var(--color-text-secondary);font-weight:500}
button{padding:4px;color:var(--color-text-secondary);border-radius:4px}button:hover{background:#5873d410}button:disabled{opacity:.5}
.exception-list{flex:1;min-height:0;overflow:auto;padding:0 20px}.exception-item{display:block;padding:12px 0;border-bottom:1px solid var(--color-border)}.exception-item:last-child{border:0}.exception-item:hover{background:#5873d408}
.item-heading{display:flex;align-items:center;gap:8px;min-width:0}.item-heading strong{font-size:12px;font-weight:550;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item-heading>svg{margin-left:auto;flex-shrink:0;color:var(--color-text-secondary)}
.type{font-size:10px;white-space:nowrap;color:var(--color-text-secondary);background:#8390a512;padding:2px 6px;border-radius:4px}.reason{font-size:11px;color:var(--color-text-secondary);margin-top:5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.empty{height:100%;display:grid;place-content:center;font-size:12px;color:var(--color-text-secondary)}footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 20px;border-top:1px solid var(--color-border);font-size:10px;color:var(--color-text-secondary)}footer a{display:flex;align-items:center;gap:4px;color:var(--color-text)}
</style>
