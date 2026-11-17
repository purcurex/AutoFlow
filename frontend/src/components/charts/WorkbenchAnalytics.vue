<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getFopDashboardCharts, localDate } from '@/api/fop-dashboard'
import LocalDashboardAnalytics from './LocalDashboardAnalytics.vue'
import { captureSession, assertCurrentSession } from '@/utils/session'
const props=defineProps<{page:string}>()
const window=ref<{from:string;to:string;asOf:string}>(),ready=ref(false),error=ref(false)
onMounted(async()=>{
 if(props.page!=='overview'){ready.value=true;return}
 const session=captureSession()
 try{const to=localDate(new Date());const shell=await getFopDashboardCharts({from:`${to.slice(0,4)}-01-01`,to,year:Number(to.slice(0,4))});assertCurrentSession(session);window.value=shell.registrationWindow;ready.value=true}catch{error.value=true}
})
</script>
<template>
 <div class="workbench-analytics">
  <p v-if="error" role="alert">分析数据加载失败，请刷新重试。</p>
  <template v-else-if="ready">
   <template v-if="page==='overview'">
    <LocalDashboardAnalytics workbench chart-id="registrations" title="客户注册分析" :available-window="window" />
    <LocalDashboardAnalytics workbench chart-id="customer_orders" title="客户订单分析" />
   </template>
   <template v-else-if="['performance','receipts'].includes(page)">
    <LocalDashboardAnalytics workbench chart-id="salesperson_receipts" title="业务员业绩分析" />
    <section class="profit"><h2>毛利分析</h2><p>结算毛利 <strong>—</strong>&emsp;预估毛利 <strong>—</strong></p></section>
   </template>
  </template>
 </div>
</template>
<style scoped>
.workbench-analytics{display:grid;gap:20px}.profit{padding:24px;border:1px solid var(--border-color,#e2e8f0);border-radius:12px;background:var(--bg-card,transparent)}.profit h2{font-size:16px;margin:0 0 20px}.profit p{font-size:13px}.profit strong{margin-left:16px}
</style>
