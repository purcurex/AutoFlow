<script setup lang="ts">
import { rmaTypeLabels } from '@/api/rma-orders'
import { purchaseReturnLabels } from '@/api/purchase-returns'
import { completedNames } from '@/utils/completed-orders'
import { useWorkbenchDepartment } from '@/composables/useWorkbenchDepartment'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { SlidersHorizontal } from 'lucide-vue-next'
import { normalizeShippingCountry } from '@/utils/shipping-country'
import { purchaseStageLabels, isPurchaseStage } from '@/api/procurement-groups'
import { queueNames, isWorkbenchRole } from '@/utils/workbench'
import { canFilterTaskStatus, taskStatusHeading, taskStatusLabel, taskStatusOptions, type TaskStatus } from '@/utils/workbench-status'
import { procurementStageLabels, isProcurementStage } from '@/utils/procurement-stage'
import { stockTypes, stockStatuses, stockLifecycles, type StockLifecycle, type StockType, type StockPurchaseStatus } from '@/api/fop-stock'
const props = defineProps<{ queue: string; labels?: Record<string, string> }>()
const { defaultDepartmentLabel } = useWorkbenchDepartment(computed(() => props.labels ?? {}))
const route = useRoute(), { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const val = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : ''
const stock = computed(() => ['stock', 'stock_procurement'].includes(props.queue))
// Charts apply their own filters. Describe their scope without presenting leftover
// todo parameters as if they filtered the charts.
const analysisPages = computed<Record<string, { title: string; scope: string }>>(() => ({
  'order-analysis': { title: text('订单分析', 'Order analysis'), scope: text('履约订单量与客户回款分析；各图按已应用的日期、仓库及统计维度展示。', 'Fulfillment volume and customer collections; each chart uses its applied dates, warehouse and dimensions.') },
  'order-volume': { title: text('订单统计明细', 'Order details'), scope: text('展示从订单分析选定的订单明细，沿用对应统计期间与筛选条件。', 'Order details retain the reporting period and filters selected in order analysis.') },
  receipts: { title: text('回款明细', 'Receipt details'), scope: text('履约订单及全款备货实际收款，按所选支付期间统计，押金备货不计入。', 'Fulfillment and full-payment stock receipts by selected payment period; deposit stock is excluded.') },
  freight: { title: text('物流运费', 'Logistics freight'), scope: text('展示已确认的实际物流费用，按运费确认时间归期，范围以当前筛选为准。', 'Confirmed actual logistics costs by confirmation date, within the current filters.') },
  performance: { title: text('个人收款与毛利', 'Personal receipts and profit'), scope: text('按所选业务员及日期展示订单和全款备货收款，结算毛利、预估毛利分别统计。', 'Order and full-payment stock receipts for the selected salespeople and dates; settled and estimated profit are counted separately.') },
  overview: { title: text('客户开发概览', 'Prospecting overview'), scope: text('汇总客户线索、开发流程与沟通跟进，点击对应模块查看明细。', 'Customer leads, prospecting workflows and follow-ups; open a module to view details.') },
}))
const analysis = computed(() => analysisPages.value[props.queue])
const queueName = computed(() => analysis.value?.title ?? (props.queue === 'completed' && isWorkbenchRole(route.params.role) ? completedNames[route.params.role][zh.value ? 0 : 1] : props.queue === 'rma' ? text('RMA售后清单', 'RMA after-sales') : props.queue === 'purchase_returns' ? text('采购退货清单', 'Purchase returns') : props.queue === 'stock' ? text('备货清单', 'Stock orders') : props.queue === 'stock_procurement' ? text('备货待采购清单', 'Stock procurement') : queueNames[props.queue as keyof typeof queueNames]?.[zh.value ? 0 : 1] ?? text('工作台', 'Workbench')))
const summaryParts = computed(() => {
  if (analysis.value) return [analysis.value.scope]
  const parts = [
    `${text('业务部门', 'Department')}：${val('departmentId') ? props.labels?.[val('departmentId')] ?? text('所选部门', 'Selected department') : defaultDepartmentLabel.value}`,
    `${props.queue === 'purchase_returns' ? text('出库仓库', 'Outbound warehouse') : stock.value ? text('收货仓库', 'Receiving warehouse') : text('发货仓库', 'Shipping warehouse')}：${({ HZ: text('杭州仓', 'Hangzhou'), SZ: text('深圳仓', 'Shenzhen') } as Record<string, string>)[val('warehouseCode')] ?? text('全部', 'All')}`,
  ]
  if (val('ownerId')) parts.push(`${text('业务员', 'Salesperson')}：${props.labels?.[val('ownerId')] ?? text('所选业务员', 'Selected salesperson')}`)
  if (props.queue === 'rma') {
    parts.push(`${text('售后类型', 'RMA type')}：${rmaTypeLabels[val('rmaType') as keyof typeof rmaTypeLabels]?.[zh.value ? 0 : 1] ?? text('全部', 'All')}`)
    parts.push(`${text('流程状态', 'Flow status')}：${val('flowStatus') === 'all' ? text('全部', 'All') : val('flowStatus') === 'closed' ? text('已结束', 'Closed') : text('进行中', 'Active')}`)
    if (val('search')) parts.push(`${text('关键词', 'Keyword')}：${val('search')}`)
    return parts
  }
  if (props.queue === 'purchase_returns') {
    parts.push(`${text('退货进度', 'Return progress')}：${purchaseReturnLabels[val('returnStatus') as keyof typeof purchaseReturnLabels]?.[zh.value ? 0 : 1] ?? text('全部', 'All')}`)
    if (val('search')) parts.push(`${text('关键词', 'Keyword')}：${val('search')}`)
    return parts
  }
  if (stock.value) {
    parts.push(`${text('备货类型', 'Stock type')}：${stockTypes[val('stockType') as StockType]?.[zh.value ? 0 : 1] ?? text('全部', 'All')}`)
    if (props.queue === 'stock') {
      parts.push(`${text('备货阶段', 'Stock stage')}：${stockLifecycles[val('lifecycle') as StockLifecycle]?.[zh.value ? 0 : 1] ?? text('全部', 'All')}`)
      parts.push(`${text('创建时间', 'Creation time')}：${val('timeRange') === '1w' ? text('近一周', 'Last week') : val('timeRange') === '1m' ? text('近一月', 'Last month') : val('timeRange') === '3m' ? text('近三月', 'Last three months') : text('全部', 'All')}`)
    }
    if (props.queue === 'stock_procurement') parts.push(`${text('采购状态', 'Purchase status')}：${stockStatuses[val('purchaseStatus') as StockPurchaseStatus]?.[zh.value ? 0 : 1] ?? text('全部', 'All')}`)
  } else {
    if (canFilterTaskStatus(props.queue, val('taskStatus'))) parts.push(`${taskStatusHeading(props.queue)[zh.value ? 0 : 1]}：${taskStatusLabel(val('taskStatus') as TaskStatus, props.queue)[zh.value ? 0 : 1]}`)
    if (isProcurementStage(val('procurementStage'))) parts.push(`${text('采购进度', 'Purchase progress')}：${procurementStageLabels[val('procurementStage') as keyof typeof procurementStageLabels][zh.value ? 0 : 1]}`)
    if (val('warehouseStage')) parts.push(`${text('配货单状态', 'Allocation status')}：${val('warehouseStage') === 'pending_review' ? text('未审核', 'Pending approval') : text('已审核', 'Approved')}`)
  }
  if (props.queue === 'completed') parts.push(`${route.params.role === 'dispatch' ? text('发运单审核时间', 'Shipment approval time') : text('完成时间', 'Completion time')}：${val('timeRange') === '1m' ? text('近一月', 'Last month') : val('timeRange') === '3m' ? text('近三月', 'Last three months') : text('近一周', 'Last week')}`)
  if (props.queue === 'unpaid') parts.push(`${text('C端付款时间', 'Consumer payment time')}：${val('timeRange') === '1w' ? text('近一周', 'Last week') : val('timeRange') === '1m' ? text('近一月', 'Last month') : val('timeRange') === '3m' ? text('近三月', 'Last three months') : text('全部', 'All')}`)
  if (props.queue === 'review' || props.queue === 'completed' && route.params.role === 'sales') parts.push(`${text('发货国家', 'Shipping country')}：${normalizeShippingCountry(val('shippingCountryCode')) ?? text('全部', 'All')}`)
  if (props.queue === 'procurement' && isPurchaseStage(val('purchaseStage'))) parts.push(`${text('采购进度', 'Purchase progress')}：${purchaseStageLabels[val('purchaseStage') as keyof typeof purchaseStageLabels][zh.value ? 0 : 1]}`)
  if (val('search')) parts.push(`${text('关键词', 'Keyword')}：${val('search')}`)
  if (val('orderNumber')) parts.push(`${text('订单编号', 'Order number')}：${val('orderNumber')}`)
  return parts
})
const summary = computed(() => summaryParts.value.join(' | '))
// Reserve all option labels, so the selected label never determines the slot width.
// CSS sizes the hidden choices in the actual font, including proportional English text.
const summaryFields = computed(() => {
  const names = (options: Record<string, readonly [string, string]>) => Object.values(options).map(value => value[zh.value ? 0 : 1])
  const all = text('全部', 'All')
  const periods = [all, text('近一周', 'Last week'), text('近一月', 'Last month'), text('近三月', 'Last three months')]
  const slots: Record<string, { choices?: string[]; width?: string }> = {
    [text('业务部门', 'Department')]: { width: zh.value ? '5em' : '20ch' },
    [text('业务员', 'Salesperson')]: { width: zh.value ? '8em' : '24ch' },
    [text('收货仓库', 'Receiving warehouse')]: { choices: [all, text('杭州仓', 'Hangzhou'), text('深圳仓', 'Shenzhen')] },
    [text('发货仓库', 'Shipping warehouse')]: { choices: [all, text('杭州仓', 'Hangzhou'), text('深圳仓', 'Shenzhen')] },
    [text('备货类型', 'Stock type')]: { choices: [all, ...names(stockTypes)] },
    [text('备货阶段', 'Stock stage')]: { choices: [all, ...names(stockLifecycles)] },
    [text('采购状态', 'Purchase status')]: { choices: [all, ...names(stockStatuses)] },
    [text('创建时间', 'Creation time')]: { choices: periods },
    [text('完成时间', 'Completion time')]: { choices: periods },
    [text('C端付款时间', 'Consumer payment time')]: { choices: periods },
    [text('采购进度', 'Purchase progress')]: { choices: [all, ...names(procurementStageLabels), ...names(purchaseStageLabels)] },
    [text('配货单状态', 'Allocation status')]: { choices: [all, text('未审核', 'Pending approval'), text('已审核', 'Approved')] },
    [text('售后类型', 'RMA type')]: { choices: [all, ...names(rmaTypeLabels)] },
    [text('流程状态', 'Flow status')]: { choices: [all, text('进行中', 'Active'), text('已结束', 'Closed')] },
    [text('退货进度', 'Return progress')]: { choices: [all, ...names(purchaseReturnLabels)] },
    [text('出库仓库', 'Outbound warehouse')]: { choices: [all, text('杭州仓', 'Hangzhou'), text('深圳仓', 'Shenzhen')] },
    [text('发货国家', 'Shipping country')]: { choices: [all, 'WW'] },
    [text('关键词', 'Keyword')]: { width: '16em' },
    [text('订单编号', 'Order number')]: { width: '24ch' },
  }
  const taskOptions = taskStatusOptions(props.queue)
  if (taskOptions.length) {
    const heading = taskStatusHeading(props.queue)[zh.value ? 0 : 1]
    slots[heading] = { choices: [...(slots[heading]?.choices ?? []), all, ...taskOptions.map(value => taskStatusLabel(value, props.queue)[zh.value ? 0 : 1])] }
  }
  return summaryParts.value.map(part => {
    const separator = analysis.value ? -1 : part.indexOf('：')
    const label = separator < 0 ? '' : part.slice(0, separator)
    return { label, value: separator < 0 ? part : part.slice(separator + 1), ...slots[label] }
  })
})
</script>
<template>
  <aside class="workbench-filter-summary" :aria-label="analysis ? text('当前数据范围', 'Data scope') : text('当前查询条件', 'Applied filters')">
    <div class="summary-heading"><SlidersHorizontal :size="14" /><strong>{{ analysis ? text('数据范围', 'Data scope') : text('查询条件', 'Applied filters') }}</strong><span>{{ queueName }}</span></div>
    <p :title="summary"><span v-for="(field, index) in summaryFields" :key="index" class="summary-part"><template v-if="field.label">{{ field.label }}：<span class="summary-value" :class="{ 'summary-value-fixed': field.width }" :style="field.width ? { inlineSize: field.width } : undefined" :data-reserve="field.choices?.join('\n')" :title="field.value"><span class="summary-current">{{ field.value }}</span></span></template><template v-else>{{ field.value }}</template></span></p>
  </aside>
</template>
<style scoped>
.workbench-filter-summary{box-sizing:border-box;height:76px;min-height:76px;padding:13px 18px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface);display:grid;grid-template-rows:20px 20px;gap:8px;min-width:0;overflow:hidden}.summary-heading{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--color-text-secondary);min-width:0}.summary-heading strong{font-weight:500}.summary-heading>span{border-left:1px solid var(--color-border);padding-left:10px;margin-left:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.workbench-filter-summary p{font-size:12px;line-height:20px;color:var(--color-text-secondary);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin:0}
.summary-part{white-space:nowrap}.summary-part+.summary-part{border-left:1px solid var(--color-border);margin-left:14px;padding-left:14px}
.summary-value{display:inline-grid;grid-template-columns:max-content;grid-template-rows:20px;vertical-align:bottom;text-align:left}.summary-value::after{content:attr(data-reserve);grid-area:1/1;white-space:pre;visibility:hidden;line-height:0;pointer-events:none}.summary-current{grid-area:1/1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.summary-value-fixed{grid-template-columns:minmax(0,1fr)}
</style>
