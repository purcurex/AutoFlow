<script setup lang="ts">
import OrderTypeLabel from '@/components/autoflow/OrderTypeLabel.vue'
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import type { ReceiptNoticePage } from '@/api/receipt-notices'
import StockCopy from './StockCopy.vue'
import InboundStockGroupPanel from './InboundStockGroupPanel.vue'
import OrderProductImage from './OrderProductImage.vue'
import { skuPickingName } from '@/utils/product-display'
import { vPickingNameTooltip } from '@/directives/picking-name-tooltip'
const props=defineProps<{page:ReceiptNoticePage;busy:boolean;shippedSort?:'asc'|'desc'}>()
const emit=defineEmits<{'sort-shipped':[]}>()
const expanded=ref(new Set<string>())
watch(()=>props.page,()=>{expanded.value=new Set()})
const groups=computed(()=>props.page.parcelGroups??[])
const orders=computed(()=>new Map(props.page.items.map(o=>[o.id,o])))
const all=computed(()=>groups.value.length>0&&groups.value.every(g=>expanded.value.has(g.id)))
function toggle(id:string){const next=new Set(expanded.value);next.has(id)?next.delete(id):next.add(id);expanded.value=next}
const date=(s:string|null)=>s?new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'
</script>
<template>
 <div class="parcel-actions"><button class="workbench-button" :disabled="busy||!groups.length" @click="expanded=all?new Set():new Set(groups.map(g=>g.id))"><ChevronDown :size="14"/>{{all?'全部收起（本页）':'全部展开（本页）'}}</button><span>按包裹查看履约采购与备货商品</span></div>
 <div class="parcel-scroll workbench-list-body"><table class="parcel-table"><thead><tr><th>国内快递单号</th><th>物流公司</th><th :aria-sort="shippedSort==='asc'?'ascending':shippedSort==='desc'?'descending':'none'"><button @click="emit('sort-shipped')">供应商发货时间 {{shippedSort==='asc'?'↑':shippedSort==='desc'?'↓':'↕'}}</button></th><th>收货通知单</th><th>关联订单数</th><th>入库进度</th></tr></thead><tbody>
 <template v-for="g in groups" :key="g.id"><tr v-if="g.stockGroup" class="stock-root"><td colspan="6"><InboundStockGroupPanel :group="g.stockGroup" :expanded="expanded.has(g.id)" :busy="busy" @toggle="toggle(g.id)"/></td></tr><tr v-else class="parcel-main"><td><div class="parcel-number"><button class="expand" :disabled="busy" :aria-expanded="expanded.has(g.id)" :aria-label="`展开快递单 ${g.trackingNumber||'无单号'}`" @click="toggle(g.id)"><ChevronDown v-if="expanded.has(g.id)" :size="16"/><ChevronRight v-else :size="16"/></button><StockCopy v-if="g.trackingNumber" :value="g.trackingNumber"/><span v-else>未提供快递单号</span></div></td><td>{{g.carrier||'—'}}</td><td class="date">{{date(g.shippedAt)}}</td><td><div v-for="n in g.noticeNumbers" :key="n"><StockCopy :value="n"/></div></td><td>{{g.orderIds.length}}</td><td><span class="status">{{g.orderIds.some(id=>orders.get(id)?.status==='partial')?'部分入库':'待入库'}}</span></td></tr>
 <tr v-if="!g.stockGroup&&expanded.has(g.id)" class="detail"><td colspan="6"><table v-if="g.orderIds.length" class="order-table"><thead><tr><th>履约订单编号</th><th>商品信息</th><th>订单金额</th><th>履约仓库</th><th>入库进度</th><th>整单需求 / 已入库 / 待入库</th></tr></thead><tbody><tr v-for="id in g.orderIds" :key="id"><template v-if="orders.get(id)"><td><StockCopy :value="orders.get(id)!.number"/><OrderTypeLabel :code="orders.get(id)!.orderTypeCode" :name="orders.get(id)!.orderTypeName"/></td><td><div v-for="line in orders.get(id)!.lines" :key="line.id" class="parcel-product"><OrderProductImage :src="line.imageUrl" :name="skuPickingName(line)"/><div><span v-picking-name-tooltip="skuPickingName(line)" class="product-name">{{skuPickingName(line)}}</span><small>{{line.sku}} · × {{line.quantity??'—'}}</small></div></div></td><td>{{orders.get(id)!.amount==null?'—':`${orders.get(id)!.currency==='USD'?'$':orders.get(id)!.currency||''}${orders.get(id)!.amount!.toFixed(2)}`}}</td><td>{{orders.get(id)!.warehouse||'—'}}</td><td>{{orders.get(id)!.status==='partial'?'部分入库':'待入库'}}</td><td>{{orders.get(id)!.quantity??'—'}} / {{orders.get(id)!.inboundQuantity??'—'}} / {{orders.get(id)!.pendingQuantity??'—'}}</td></template></tr></tbody></table>
 </td></tr></template>
 <tr v-if="!groups.length"><td colspan="6" class="empty">{{busy?'正在查询…':'暂无符合条件的国内快递单'}}</td></tr></tbody></table></div>
</template>
<style scoped>
.stock-root>td{padding:0}.parcel-actions{display:flex;align-items:center;gap:16px;padding:12px 20px;color:var(--color-text-secondary);font-size:12px;border-bottom:1px solid var(--color-border)}.parcel-scroll{overflow:auto}.parcel-table,.order-table{width:100%;border-collapse:collapse;text-align:left;font-size:12px;color:var(--color-text)}th{font-size:11px;font-weight:600;color:var(--color-text-secondary);white-space:nowrap;background:var(--color-surface-muted)}th,td{padding:16px;border-bottom:1px solid var(--color-border)}.parcel-number{display:flex;align-items:center;gap:8px;white-space:nowrap;font-weight:600}.expand{padding:4px;color:var(--color-link)}.expand:focus-visible{outline:2px solid var(--color-link);border-radius:4px}.date{white-space:nowrap}.status{padding:4px 8px;background:var(--color-selection-surface);color:var(--color-link);border-radius:4px;white-space:nowrap}.detail>td{padding:12px 20px 20px;background:var(--color-background)}.order-table{background:var(--color-surface);border:1px solid var(--color-border)}.order-table td{vertical-align:middle}.parcel-product{display:flex;align-items:center;gap:10px;margin:8px 0}.parcel-product>div{min-width:0}.product-name{display:block;max-width:330px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}small{display:block;color:var(--color-text-secondary);font-size:11px;margin-top:4px}.empty{text-align:center;padding:80px}
</style>
