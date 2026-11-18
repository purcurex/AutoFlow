<script setup lang="ts">
import WorkbenchPagination from '@/components/autoflow/WorkbenchPagination.vue'
import OrderExceptionLabel from '@/components/autoflow/OrderExceptionLabel.vue'
import { vPickingNameTooltip } from '@/directives/picking-name-tooltip'
import { vTaskTableLayout } from '@/directives/task-table-layout'
import { skuPickingName } from '@/utils/product-display'
import { warehouseName } from '@/utils/warehouse'
import { useProductExpansion } from '@/composables/useProductExpansion'
import ProductExpansionButton from '@/components/autoflow/ProductExpansionButton.vue'
import CollapsibleProductLines from '@/components/autoflow/CollapsibleProductLines.vue'
import { isUncollectedPage } from '@/utils/workbench-data'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Search, } from 'lucide-vue-next'
import { getReceiptNotices, type ReceiptNoticePage, type ReceiptNoticeQuery } from '@/api/receipt-notices'
import { captureSession, isCurrentSession, onSessionReset } from '@/utils/session'
import { fopAccessError } from '@/api/fop-access'
import { useWorkbenchDepartment } from '@/composables/useWorkbenchDepartment'
import WorkbenchRefreshControl from '@/components/autoflow/WorkbenchRefreshControl.vue'
import WorkbenchTableState from '@/components/autoflow/WorkbenchTableState.vue'
import WorkbenchTaskHeading from '@/components/autoflow/WorkbenchTaskHeading.vue'
import OrderProductImage from '@/components/autoflow/OrderProductImage.vue'
import StockCopy from '@/components/autoflow/StockCopy.vue'
const emit = defineEmits<{ 'filter-labels': [rows: { id: string; name: string }[]] }>()
const route=useRoute(), router=useRouter(), { locale }=useI18n()
const zh=computed(()=>String(locale.value).startsWith('zh')), text=(cn:string,en:string)=>zh.value?cn:en
const scalar=(key:string)=>typeof route.query[key]==='string'?route.query[key] as string:''
const query=computed<ReceiptNoticeQuery>(()=>({ search:scalar('search')||undefined,departmentId:scalar('departmentId')||undefined,ownerId:scalar('ownerId')||undefined,warehouseCode:scalar('warehouseCode')||undefined,status:['pending','partial'].includes(scalar('inboundStatus'))?scalar('inboundStatus') as 'pending'|'partial':undefined,page:Math.min(1000000,Math.max(1,Math.floor(Number(scalar('page')))||1)),pageSize:[20,50,100,200,500,1000].includes(Number(scalar('pageSize')))?Number(scalar('pageSize')):100 }))
const result=ref<ReceiptNoticePage>(), loading=ref(false), error=ref(''), search=ref(scalar('search'))
const warehouseOptions=ref<ReceiptNoticePage['warehouses']>([])
const unavailable = computed(() => isUncollectedPage(result.value))
const {defaultDepartmentLabel,departmentOptions,defaultDepartmentValue}=useWorkbenchDepartment(computed(()=>Object.fromEntries((result.value?.departments??[]).map(d=>[d.id,d.name]))))
const pages=computed(()=>Math.max(1,Math.ceil((result.value?.total??0)/query.value.pageSize)))
const date=(value:string|null)=>!value||!Number.isFinite(Date.parse(value))?'—':new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))
let loadedQuery='',ticket=0,disposed=false,controller:AbortController|undefined
async function navigate(changes:Record<string,string|number|undefined>){await router.replace({query:{...route.query,...changes}})}
async function load(){
  controller?.abort();controller=new AbortController();const id=++ticket,session=captureSession();loading.value=true;error.value='';const requestKey=JSON.stringify(query.value);if(loadedQuery!==requestKey)result.value=undefined
  try{
    const page=await getReceiptNotices(query.value,controller.signal)
    if(disposed||id!==ticket||!isCurrentSession(session))return
    if(query.value.page>Math.max(1,Math.ceil(page.total/query.value.pageSize))){await navigate({page:1});return}
    loadedQuery=requestKey;result.value=page;warehouseOptions.value=page.warehouses;emit('filter-labels',page.departments)
  }catch(cause){if(!disposed&&id===ticket&&isCurrentSession(session))error.value=fopAccessError(cause,zh.value)}
  finally{if(!disposed&&id===ticket)loading.value=false}
}
watch(search,value=>{if(!value.trim()&&query.value.search)void navigate({search:undefined,page:1})})
watch(()=>JSON.stringify(query.value),()=>{search.value=scalar('search');void load()},{immediate:true})
const unregister=onSessionReset(()=>{++ticket;controller?.abort();warehouseOptions.value=[];result.value=undefined;error.value='';search.value='';loading.value=false})
onBeforeUnmount(()=>{disposed=true;++ticket;controller?.abort();unregister()})
const { expandedProductIds, hasExpandableProducts, allProductsExpanded, setProductExpanded, toggleAllProducts } = useProductExpansion(() => result.value?.items ?? [], row => row.lines)
</script>
<template>
  <section>
    <WorkbenchTaskHeading :title="text('待入库清单','Pending inbound')" :description="text('已发货或部分发货且未全部入库的履约订单，按商品采购数量跟进入库进度。','Shipped or partially shipped fulfillment orders awaiting full receipt.')" :data-availability="result?.dataAvailability" :replica="result?.replica" :sync-disabled="loading" @replica-synced="load">
        <WorkbenchRefreshControl :busy="loading" :disabled="loading" :refreshed-at="result?.refreshedAt" @refresh="load" />
      </WorkbenchTaskHeading>
    <div class="receipt-panel" :aria-busy="loading">
      <form class="workbench-filter-toolbar" @submit.prevent="navigate({search:search.trim()||undefined,page:1})">
        <div class="workbench-filter-main">
          <div class="workbench-filter-search"><label class="workbench-search-field"><Search :size="15" /><input v-model="search" :aria-label="text('搜索待入库履约订单','Search pending inbound orders')" :placeholder="text('业务员 / 履约订单 / 收货通知单 / 客户 / SKU','Order / receipt notice / customer / SKU')"></label><button class="workbench-button workbench-primary" type="submit">{{ text('查询','Search') }}</button></div>
          <label>{{ text('业务部门','Department') }}<select class="workbench-filter-select" :value="query.departmentId||''" @change="navigate({departmentId:($event.target as HTMLSelectElement).value||undefined,ownerId:undefined,page:1})"><option :value="defaultDepartmentValue(result?.departments,query.departmentId)">{{ defaultDepartmentLabel }}</option><option v-for="d in departmentOptions(result?.departments)" :key="d.id" :value="d.id">{{ d.name }}</option></select></label>
          <label>{{ text('履约仓库','Fulfillment warehouse') }}<select class="workbench-filter-select" :value="query.warehouseCode||''" @change="navigate({warehouseCode:($event.target as HTMLSelectElement).value||undefined,page:1})"><option value="">{{ text('全部','All') }}</option><option v-for="w in warehouseOptions" :key="w.code" :value="w.code">{{ warehouseName(w.name || w.code) }}</option></select></label>
        </div>
        <div class="workbench-filter-secondary"><label>{{ text('入库进度','Inbound progress') }}<select class="workbench-filter-select" :value="query.status||''" @change="navigate({inboundStatus:($event.target as HTMLSelectElement).value||undefined,page:1})"><option value="">{{ text('全部','All') }}</option><option value="pending">{{ text('待入库','Pending inbound') }}</option><option value="partial">{{ text('部分入库','Partially received') }}</option></select></label><span class="result-count">{{ unavailable ? '—' : result?text(`共 ${result.total} 笔履约订单`,`${result.total} fulfillment orders`):'—' }}</span></div>
      </form>
      <div class="receipt-expansion-actions"><ProductExpansionButton :expanded="allProductsExpanded" :disabled="loading || !hasExpandableProducts" @toggle="toggleAllProducts" /><div class="workbench-list-pagination"><WorkbenchPagination :page="query.page" :page-size="query.pageSize" :pages="pages" :disabled="loading || !result" @page="navigate({ page: $event })" @page-size="navigate({ pageSize: $event, page: 1 })" /></div></div>
      <div class="receipt-table-scroll workbench-list-body"><table v-task-table-layout class="receipt-table"><thead><tr><th class="notice-number">{{ text('订单编号','Order number') }}</th><th>{{ text('商品图片 / 商品信息','Product / items') }}</th><th>{{ text('收货通知单','Receipt notices') }}</th><th>{{ text('订单金额','Order amount') }}</th><th>{{ text('履约仓库','Fulfillment warehouse') }}</th><th>{{ text('供应商发货时间','Supplier shipped at') }}</th><th>{{ text('物流信息','Logistics') }}</th><th>{{ text('入库进度','Inbound progress') }}</th><th>{{ text('采购 / 已入库 / 待入库','Purchased / received / pending') }}</th></tr></thead>
        <tbody><tr v-for="row in error ? [] : result?.items" :key="row.id"><td class="notice-number" :data-label="text('订单编号','Order number')"><StockCopy :value="row.number" /><OrderExceptionLabel :exception="row.exception" /><small class="muted block">{{ text(`${row.lines.length} 款商品 · ${row.lines.every(line=>line.quantity!=null)?row.lines.reduce((total,line)=>total+(line.quantity??0),0):'—'} 件`,`${row.lines.length} items · ${row.quantity ?? '—'} units`) }}</small></td>
          <td :data-label="text('商品信息','Products')" class="products"><CollapsibleProductLines :expanded="expandedProductIds.has(row.id)" @update:expanded="setProductExpanded(row.id, $event)" :items="row.lines" :label="row.number" v-slot="{ item: line }"><div class="product"><OrderProductImage :src="line.imageUrl" :name="skuPickingName(line)" /><div><span v-picking-name-tooltip="skuPickingName(line)">{{ skuPickingName(line) || '—' }}</span><small class="muted block"><StockCopy :value="line.sku" /> · × {{ line.quantity ?? '—' }}</small><small class="product-inbound-quantities muted block"><span>{{ text('采购','Purchased') }} {{ line.purchaseQuantity ?? '—' }}</span><span>{{ text('已入库','Received') }} {{ line.inboundQuantity ?? '—' }}</span><span>{{ text('待入库','Pending') }} {{ line.pendingQuantity ?? '—' }}</span></small></div></div></CollapsibleProductLines></td>
          <td :data-label="text('收货通知单','Receipt notices')"><StockCopy v-for="number in row.noticeNumbers" :key="number" class="block" :value="number" /></td><td :data-label="text('订单金额','Order amount')">{{ row.amount == null ? '—' : `${row.currency === 'USD' ? '$' : row.currency || ''}${row.amount.toFixed(2)}` }}</td><td :data-label="text('履约仓库','Warehouse')">{{ warehouseName(row.warehouse) }}</td><td class="workbench-date-cell" :data-label="text('发货时间','Shipped at')"><div v-for="(shipment, index) in row.logistics?.length ? row.logistics : [row]" :key="index" class="receipt-shipment">{{ date(shipment.shippedAt) }}</div></td><td :data-label="text('物流信息','Logistics')"><div v-for="(shipment, index) in row.logistics?.length ? row.logistics : [row]" :key="index" class="receipt-shipment"><span class="block">{{ shipment.carrier || '—' }}</span><small class="block muted"><StockCopy v-if="shipment.trackingNumber" :value="shipment.trackingNumber" /><span v-else>—</span></small></div></td><td :data-label="text('入库进度','Progress')"><span class="receipt-status" :class="{partial:row.status==='partial'}">{{ row.status==='partial'?text('部分入库','Partially received'):row.status==='pending'?text('待入库','Pending inbound'):text('待核查','Unconfirmed') }}</span></td><td :data-label="text('采购 / 已入库 / 待入库','Purchased / received / pending')">{{ row.quantity ?? '—' }} / {{ row.inboundQuantity ?? '—' }} / <strong>{{ row.pendingQuantity ?? '—' }}</strong></td></tr><WorkbenchTableState v-if="error || !result?.items.length" :columns="9" :loading="loading" :error="error" :message="unavailable ? '' : text('暂无符合条件的待入库履约订单','No matching pending fulfillment orders')" /></tbody></table></div>
      <footer v-if="result"><span>{{ text(`共 ${unavailable ? '—' : result.total} 笔履约订单 · `, `${unavailable ? '—' : result.total} fulfillment orders · `) }}{{ text(`采购 ${unavailable ? '—' : result.totals.quantity ?? '—'} 件 · 已入库 ${unavailable ? '—' : result.totals.inboundQuantity ?? '—'} 件 · 待入库 ${unavailable ? '—' : result.totals.pendingQuantity ?? '—'} 件`,`${unavailable ? '—' : result.totals.quantity ?? '—'} purchased · ${unavailable ? '—' : result.totals.inboundQuantity ?? '—'} received · ${unavailable ? '—' : result.totals.pendingQuantity ?? '—'} pending`) }}</span></footer>
    </div>
  </section>
</template>
<style scoped>
.receipt-expansion-actions{display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--color-border);background:color-mix(in srgb,var(--color-chart-link) 4%,var(--color-surface))}
.receipt-panel{container:receipt-list/inline-size;background:var(--color-surface);border:1px solid var(--color-border);border-radius:9px;overflow:hidden}.receipt-table-scroll{overflow-x:hidden}.receipt-table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}.receipt-table th{font-size:11px;font-weight:600;color:var(--color-text-secondary);padding:16px;white-space:nowrap}.receipt-table td{padding:22px 16px;border-top:1px solid var(--color-border);vertical-align:middle}.receipt-table .notice-number{text-align:center;white-space:nowrap;border-right:1px solid var(--color-border);min-width:175px}.receipt-table td.notice-number{color:var(--color-chart-link);font-weight:600;font-variant-numeric:tabular-nums}.notice-number .muted{font-weight:400}.products{min-width:0}.product{display:flex;gap:10px;align-items:center}.product+.product{margin-top:16px}.block{display:block;margin-top:5px}.muted{font-size:11px;line-height:1.7;color:var(--color-text-secondary)}.receipt-status{display:inline-block;white-space:nowrap;padding:4px 8px;border-radius:4px;color:#476b92;background:#eff4fa;border:1px solid #d8e2ef}.receipt-status.partial{color:#a66c16;background:#fff7e8;border-color:#f4dfb9}.empty{padding:60px 20px;text-align:center;font-size:13px;color:var(--color-text-secondary)}footer,footer>div{display:flex;align-items:center;gap:12px;flex-wrap:wrap}footer{justify-content:space-between;padding:16px 20px;font-size:12px;border-top:1px solid var(--color-border);color:var(--color-text-secondary)}

.receipt-table{table-layout:fixed;width:100%!important}.receipt-table :deep(col:nth-child(1)){width:13%!important}.receipt-table :deep(col:nth-child(2)){width:24%!important}.receipt-table :deep(col:nth-child(3)){width:12%!important}.receipt-table :deep(col:nth-child(4)),.receipt-table :deep(col:nth-child(5)),.receipt-table :deep(col:nth-child(8)){width:7%!important}.receipt-table :deep(col:nth-child(6)){width:9%!important}.receipt-table :deep(col:nth-child(7)){width:11%!important}.receipt-table :deep(col:nth-child(9)){width:10%!important}.receipt-table th,.receipt-table td{padding-left:8px;padding-right:8px}.product>div{min-width:0;overflow:hidden}.product-inbound-quantities{display:flex;gap:4px 12px;flex-wrap:wrap;font-variant-numeric:tabular-nums}.product-inbound-quantities>span{white-space:nowrap}.receipt-table td:nth-child(3) :deep(.stock-copy){display:flex;width:fit-content;white-space:nowrap}.receipt-table td:last-child{font-variant-numeric:tabular-nums;white-space:nowrap}.receipt-status{font-size:12px;line-height:1.5;color:var(--color-chart-link);background:color-mix(in srgb,var(--color-chart-link) 10%,var(--color-surface));border-color:color-mix(in srgb,var(--color-chart-link) 28%,var(--color-border))}.receipt-status.partial{color:var(--color-warning,#b67d31);background:color-mix(in srgb,var(--color-warning,#b67d31) 10%,var(--color-surface));border-color:color-mix(in srgb,var(--color-warning,#b67d31) 28%,var(--color-border))}
@container receipt-list (max-width:1400px){table,tbody{display:block}thead{display:none}tr{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;padding:20px;border-top:1px solid var(--color-border)}.receipt-table td{padding:0;border:0;min-width:0}.receipt-table td::before{content:attr(data-label);display:block;font-size:10px;color:var(--color-text-secondary);margin-bottom:8px}.receipt-table td:first-child{grid-column:1/-1;text-align:left;white-space:normal;border-right:0}.products{grid-column:1;grid-row:2/span 3}}
@container receipt-list (max-width:600px){tr{grid-template-columns:repeat(2,minmax(0,1fr));padding:16px}.receipt-table td:nth-child(3) :deep(.stock-copy){display:flex;width:fit-content;white-space:nowrap}.receipt-table td:last-child{grid-column:1/-1}.products{grid-column:1/-1;grid-row:auto}}
</style>

<style scoped>
.receipt-shipment{min-height:44px;display:flex;flex-direction:column;justify-content:center;gap:4px}.receipt-shipment+.receipt-shipment{margin-top:8px}
</style>
