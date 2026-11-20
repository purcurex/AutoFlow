<script setup lang="ts">
import OrderProgressGraph from '@/components/autoflow/OrderProgressGraph.vue'
import { Search } from 'lucide-vue-next'
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getOrderProgress, type OrderProgress } from '@/api/order-progress'
import { businessStatusLabels } from '@/utils/fulfillment-source-status'
import { progressStatus } from '@/utils/order-progress-graph'
import { onSessionReset } from '@/utils/session'
const route=useRoute(),router=useRouter()
const number=ref(typeof route.query.number==='string'?route.query.number:''),data=ref<OrderProgress>(),busy=ref(false),error=ref('')
let request=0
const dateText=(value?:string|null)=>value&&!Number.isNaN(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'
const off=onSessionReset(()=>{request++;data.value=undefined;error.value='';busy.value=false})
onBeforeUnmount(()=>{off();request++})
async function load(){
 const value=number.value.trim();if(!value){error.value='请输入履约订单号或备货订单号';return}
 const id=++request;busy.value=true;error.value=''
 try {const result=await getOrderProgress(value);if(id!==request)return;data.value=result}
 catch(e:any){if(id!==request)return;data.value=undefined;error.value=e?.response?.status===404?'未找到该订单，请检查单号及数据权限':'查询未完成，请稍后重试'}
 finally{if(id===request)busy.value=false}
}
async function submit(){const value=number.value.trim();await router.replace({query:{queue:'progress',number:value}});await load()}
watch(()=>route.query.number,value=>{if(typeof value==='string')number.value=value})
if(number.value)void load()
const link=(m:OrderProgress['memberships'][number])=>({name:'RoleWorkbench',params:{role:m.role},query:{queue:m.queue,search:data.value?.number,timeRange:'all',...(m.queue==='unpaid'?{skuAssociation:m.skuAssociation}:{})}})
</script>
<template>
 <section class="progress-view">
  <h2>履约进度查询</h2><p class="intro">按订单编号查询待办清单、下游单据及业务流转。</p>
  <div class="lookup workbench-filter-toolbar"><div class="workbench-filter-main"><form class="workbench-filter-search" @submit.prevent="submit"><label class="workbench-search-field"><Search :size="16" /><input id="progress-number" v-model="number" type="search" maxlength="100" aria-label="履约订单号或备货订单号" placeholder="完整履约订单号 / 备货订单号" autocomplete="off"></label><button class="workbench-button workbench-primary" :disabled="busy || !number.trim()" :aria-busy="busy">查询</button></form></div></div>
  <p v-if="error" role="alert" class="message">{{error}}</p>
  <p v-if="busy && data" role="status" class="message">正在更新，当前显示上次查询结果。</p>
  <template v-if="data">
   <div class="summary"><div><small>{{data.kind==='stock'?'备货订单':'履约订单'}}</small><h3>{{data.number}}</h3><dl class="header-details"><div><dt>客户名称</dt><dd>{{data.customerName || '—'}}</dd></div><div><dt>Shopify 单号</dt><dd>{{data.details?.shopifyOrderNumber || '—'}}</dd></div><div><dt>全程跟踪号</dt><dd>{{data.details?.fullTrackingNumbers.join(' / ') || '—'}}</dd></div><div><dt>尾程跟踪号</dt><dd>{{data.details?.lastMileTrackingNumbers.join(' / ') || '—'}}</dd></div><div><dt>收款日期</dt><dd>{{dateText(data.details?.paidAt)}}</dd></div></dl></div><span v-if="data.billStatus" class="state">{{progressStatus(data.billStatus)}}</span></div>
   <div class="memberships"><span v-for="(label,key) in {order:'订单',purchase:'采购',outbound:'出库'}" :key="key">{{label}}：{{businessStatusLabels[data.businessStatus?.[key] ?? '']?.[0] || '—'}}</span><span>履约：{{data.conclusions?.fulfillment || '待确认'}}</span><span>配货：{{data.conclusions?.allocation || '待确认'}}</span></div>
   <div class="panel-section"><h3>所属清单</h3><div class="memberships"><template v-for="m in data.memberships" :key="m.role+m.queue"><RouterLink v-if="m.accessible && !busy" :to="link(m)">{{m.name}} ↗</RouterLink><span v-else>{{m.name}}</span></template><span v-if="!data.memberships.length">暂无匹配清单</span></div></div>
   <OrderProgressGraph :source="data.graph" />
   <OrderProgressGraph v-for="stock in data.stockChains" :key="stock.id" :source="stock.graph" :title="`备货采购入库链路 · ${stock.number}`">
    <div class="stock-consumptions"><span>备货订单 {{stock.number}} → 履约订单 {{data.number}}</span><span v-for="record in stock.records" :key="record.id">{{record.status}} · {{record.sku || 'SKU'}} × {{record.quantity}}</span></div>
   </OrderProgressGraph>
  </template><div v-else-if="!error" class="empty">{{busy?'正在查询订单进度…':'输入订单编号，查看业务进度与单据关系'}}</div>
 </section>
</template>
<style scoped>
.progress-view{color:var(--color-text)}h2{font-size:21px;font-weight:700}h3{font-size:14px;font-weight:600}.intro{font-size:12px;color:var(--color-text-secondary);margin:8px 0 20px}.lookup{background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px}.summary{display:flex;justify-content:space-between;align-items:center;padding:22px;margin-top:20px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px}.summary>div{min-width:0;flex:1}.summary>.state{flex-shrink:0;align-self:flex-start}.header-details{display:flex;flex-wrap:wrap;gap:16px 32px;margin-top:14px;font-size:12px}.header-details dt{color:var(--color-text-secondary);margin-bottom:5px}.header-details dd{margin:0;overflow-wrap:anywhere}.summary small{color:var(--color-text-secondary)}.summary h3{font-size:19px;margin:6px 0}.summary span{font-size:13px}.panel-section{background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;margin-top:16px;padding:20px}.memberships{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;font-size:12px}.memberships a,.memberships>span{padding:7px 11px;background:var(--color-selection-surface);color:var(--color-link);border-radius:5px}.message,.empty{font-size:13px;color:var(--color-text-secondary)}.message{padding:15px 0}.empty{text-align:center;padding:100px 16px}.state{font-size:11px;background:var(--color-selection-surface);color:var(--color-selection-text);padding:3px 7px;border-radius:4px}button:focus-visible,a:focus-visible{outline:2px solid var(--color-link);outline-offset:2px}
.stock-consumptions{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:12px;font-size:12px;color:var(--color-text-secondary)}
</style>
