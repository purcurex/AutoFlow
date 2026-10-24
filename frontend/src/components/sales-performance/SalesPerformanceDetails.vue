<script setup lang="ts">
import { useChartAccess } from '@/composables/useChartAccess'
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { getSalesPerformanceDetails, type FopProfit, type PerformanceDetailsQuery, type PerformancePage } from '@/api/fop-sales-performance'
import { fopAccessError } from '@/api/fop-access'
import { formatChartCurrency } from '@/utils/currency'
import { onSessionReset } from '@/utils/session'
import { scrollOuterPage } from '@/utils/pageWheel'
import TableTotals from '@/components/ui/TableTotals.vue'

const props = defineProps<{ query: PerformanceDetailsQuery; scope: string; owner: string }>()
const emit = defineEmits<{ close: []; failure: [] }>()
const { locale } = useI18n(), titleId = useId(), scopeId = useId()
const t = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const dialog = ref<HTMLDialogElement>(), closeButton = ref<HTMLButtonElement>(), scroller = ref<HTMLElement>()
const data = ref<PerformancePage>(), busy = ref(false), error = ref(''), page = ref(1), expanded = ref('')
const receipts = computed(() => props.query.kind === 'receipts')
const title = computed(() => receipts.value ? t('收款明细', 'Receipt details') : t('毛利明细', 'Profit details'))
const money = (value: number | null) => value === null ? '—' : formatChartCurrency(value, String(locale.value))
const date = (value: string | null) => value ? new Date(value).toLocaleString(String(locale.value), { timeZone: 'Asia/Shanghai', hour12: false }) : '—'
function isMonthlyReference(profit: FopProfit) {
  if (profit.recognitionDate !== null) return false
  const [year, month] = profit.recognitionMonth.split('-').map(Number)
  const monthStart = `${profit.recognitionMonth}-01`
  const monthEnd = new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10)
  return props.query.grain !== 'month' || !data.value || data.value.range.from > monthStart || data.value.range.to < monthEnd
}
const hasMonthlyReferences = computed(() => Boolean(data.value?.unallocatedSettlements.length || data.value?.profits.some(isMonthlyReference)))
const { requireDetails } = useChartAccess(() => 'sales_performance')
let requestId = 0, opener: HTMLElement | undefined
async function load() {
  const id = ++requestId
  data.value = undefined; error.value = ''; busy.value = true; expanded.value = ''
  if (scroller.value) scroller.value.scrollTop = 0
  try {
    await requireDetails()
    if (id !== requestId) return
    const result = await getSalesPerformanceDetails({ ...props.query, page: page.value })
    if (id === requestId) data.value = result
  } catch (cause) {
    if (id !== requestId) return
    error.value = fopAccessError(cause, String(locale.value).startsWith('zh')); emit('failure')
  } finally { if (id === requestId) busy.value = false }
}
watch(() => props.query, () => { page.value = 1; void load() }, { immediate: true })
function navigate(value: number) { page.value = value; void load() }
onMounted(() => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  dialog.value?.showModal(); closeButton.value?.focus({ preventScroll: true })
})
const off = onSessionReset(() => { requestId++; data.value = undefined; error.value = ''; busy.value = false; emit('close') })
onBeforeUnmount(() => {
  requestId++; off(); dialog.value?.close()
  if (opener?.isConnected) opener.focus({ preventScroll: true })
})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="ov-panel performance-dialog" aria-modal="true" :aria-labelledby="titleId" :aria-describedby="scopeId" @cancel.prevent="emit('close')" @click.self="emit('close')" @wheel.self.prevent @touchmove.self.prevent>
      <header class="ov-header"><div class="ov-heading"><h2 :id="titleId">{{ title }}<span v-if="data?.source === 'mock'" class="ov-badge">MOCK</span></h2><p :id="scopeId">{{ owner ? `${owner} · ` : '' }}{{ scope }} · UTC+8 · USD ($)</p></div><button ref="closeButton" type="button" class="ov-secondary performance-close" :aria-label="t('关闭明细', 'Close details')" @click="emit('close')"><X :size="18" /></button></header>
      <div ref="scroller" class="ov-body performance-dialog-body" @wheel.capture="scrollOuterPage($event, scroller)">
        <p v-if="busy" class="ov-empty" role="status">{{ t('正在读取明细…', 'Loading details…') }}</p>
        <p v-else-if="error" class="ov-error" role="alert">{{ error }}<button class="ov-link" @click="load">{{ t('重试', 'Retry') }}</button></p>
        <template v-else-if="data">
          <p class="ov-scope">{{ receipts ? t('按支付日统计已支付、已审核的订单及全款备货收款，押金备货不计入。', 'Paid and approved order and full-payment stocking receipts by payment date; deposits excluded.') : t('净毛利按期间贡献统计，已扣除前期确认金额；结算与预估分别核对。', 'Period net profit contributions after prior recognition; settled and estimated profit are reviewed separately.') }}</p>
          <div v-if="data.unallocatedSettlements.length" class="performance-allocation"><strong>{{ t('待补充分期明细 · 整月参考', 'Allocation pending · Full-month reference') }}</strong><p>{{ t('尚无日归属的月结未计入以下分期合计。', 'Settlements without daily allocation are excluded from period totals.') }}</p><span v-for="item in data.unallocatedSettlements" :key="item.month">{{ item.month }} · {{ money(item.amount) }} · {{ item.count }} {{ t('笔', 'entries') }}</span></div>
          <div class="ov-pagination"><span>{{ t('共', 'Total') }} {{ data.total }} {{ t('笔', 'entries') }}</span><button :disabled="page <= 1" @click="navigate(page - 1)">{{ t('上一页', 'Previous') }}</button><span>{{ page }} / {{ Math.max(1, Math.ceil(data.total / props.query.pageSize)) }}</span><button :disabled="page * props.query.pageSize >= data.total" @click="navigate(page + 1)">{{ t('下一页', 'Next') }}</button></div>
          <div class="ov-table-scroll">
            <table v-if="receipts" class="ov-table performance-receipts">
              <colgroup><col style="width:190px"><col style="width:180px"><col style="width:145px"><col style="width:180px"><col style="width:170px"><col style="width:100px"></colgroup>
              <thead><tr><th>{{ t('收款来源 / 单据', 'Source / Document') }}</th><th>{{ t('客户 / 编码', 'Customer / Code') }}</th><th>{{ t('实际收款', 'Actual receipts') }}</th><th>{{ t('支付时间 · UTC+8', 'Paid at · UTC+8') }}</th><th>{{ t('业务员 / 部门', 'Salesperson / Department') }}</th><th>{{ t('单据构成', 'Breakdown') }}</th></tr></thead>
              <tbody>
                <template v-for="receipt in data.receipts" :key="receipt.id">
                  <tr><td><strong>{{ receipt.sourceType === 'fulfillment' ? t('订单收款', 'Order receipts') : t('全款备货收款', 'Full-payment stocking') }}</strong><small>{{ receipt.documentNumber }}</small></td><td>{{ receipt.customerName }}<small>{{ receipt.customerCode }}</small></td><td class="performance-detail-amount">{{ money(receipt.amount) }}</td><td>{{ date(receipt.paidAt) }}</td><td>{{ receipt.owner?.name || '—' }}<small>{{ receipt.department?.name || '—' }}</small></td><td><button class="ov-link" :aria-expanded="expanded === receipt.id" @click="expanded = expanded === receipt.id ? '' : receipt.id">{{ expanded === receipt.id ? t('收起构成', 'Hide breakdown') : t('查看构成', 'View breakdown') }}</button></td></tr>
                  <tr v-if="expanded === receipt.id" class="performance-breakdown-row"><td colspan="6"><dl class="performance-breakdown"><div><dt>{{ t('单据金额', 'Document amount') }}</dt><dd>{{ money(receipt.orderAmount) }}</dd></div><div><dt>{{ t('手续费', 'Handling fee') }}</dt><dd>{{ money(receipt.handlingFee) }}</dd></div><div><dt>{{ t('仓库', 'Warehouse') }}</dt><dd>{{ receipt.warehouse }}</dd></div></dl></td></tr>
                </template>
                <tr v-if="!data.receipts.length"><td colspan="6" class="ov-empty">{{ t('当前期间暂无收款。', 'No receipts in this period.') }}</td></tr>
              </tbody>
              <TableTotals><th scope="row" colspan="2">{{ t('筛选合计', 'Filtered total') }} · {{ data.total }} {{ t('笔', 'entries') }}</th><td>{{ money(data.totals.collectionsAmount) }}</td><td colspan="3">{{ t('订单收款', 'Order receipts') }} {{ money(data.totals.orderAmount) }} · {{ t('全款备货收款', 'Stocking receipts') }} {{ money(data.totals.stockAmount) }}</td></TableTotals>
            </table>
            <table v-else class="ov-table performance-profits">
              <colgroup><col style="width:180px"><col style="width:155px"><col style="width:175px"><col style="width:160px"><col style="width:235px"><col style="width:100px"></colgroup>
              <thead><tr><th>{{ t('订单 / 客户', 'Order / Customer') }}</th><th>{{ t('归属期间 / 状态', 'Period / Status') }}</th><th>{{ t('本期净毛利', 'Period net profit') }}</th><th>{{ t('业务员 / 部门', 'Salesperson / Department') }}</th><th>{{ t('结算与截止信息', 'Settlement and cutoff') }}</th><th>{{ t('毛利构成', 'Breakdown') }}</th></tr></thead>
              <tbody>
                <template v-for="profit in data.profits" :key="profit.id">
                  <tr><td><strong>{{ profit.orderNumber }}</strong><small>{{ profit.customerName }} · {{ profit.customerCode }}</small></td><td>{{ profit.recognitionDate || profit.recognitionMonth }}<small v-if="!profit.recognitionDate">{{ t('整月归属', 'Monthly allocation') }}</small><span class="performance-detail-status" :class="profit.status">{{ profit.status === 'settled' ? t('已结算', 'Settled') : t('预估中', 'Estimated') }}</span></td><td class="performance-detail-amount" :class="{ 'performance-reference-amount': isMonthlyReference(profit) }">{{ isMonthlyReference(profit) ? '—' : money(profit.amount) }}<small v-if="isMonthlyReference(profit)">{{ t('整月参考 · 不计本期', 'Full-month reference · Excluded') }}</small></td><td>{{ profit.owner.name }}<small>{{ profit.department.name }}</small></td><td>{{ profit.settlementId || t('尚未结算', 'Not settled') }} · {{ t('版本', 'Version') }} {{ profit.version }}<small>{{ t('截止', 'Cutoff') }} {{ date(profit.cutoffAt) }}</small></td><td><button class="ov-link" :aria-expanded="expanded === profit.id" @click="expanded = expanded === profit.id ? '' : profit.id">{{ expanded === profit.id ? t('收起构成', 'Hide breakdown') : t('查看构成', 'View breakdown') }}</button></td></tr>
                  <tr v-if="expanded === profit.id" class="performance-breakdown-row"><td colspan="6">
                    <dl class="performance-breakdown">
                      <div v-if="isMonthlyReference(profit)"><dt>{{ t('整月参考净毛利 · 不计本期', 'Full-month reference net profit · Excluded') }}</dt><dd>{{ money(profit.amount) }}</dd></div>
                      <div><dt>{{ t('收入', 'Income') }}</dt><dd>{{ money(profit.incomeAmount) }}</dd></div><div><dt>{{ t('收入调整', 'Income adjustment') }}</dt><dd>{{ money(profit.adjustmentIncome) }}</dd></div><div><dt>{{ t('产品成本', 'Product cost') }}</dt><dd>{{ money(profit.productCost) }}</dd></div>
                      <div><dt>{{ profit.freightBasis === 'frozen' ? t('已冻结运费', 'Frozen freight') : t('预估运费', 'Estimated freight') }}</dt><dd>{{ money(profit.freightCost) }}</dd></div><div><dt>{{ t('退款', 'Refunds') }}</dt><dd>{{ money(profit.refundCost) }}</dd></div><div><dt>{{ t('退件成本', 'Return cost') }}</dt><dd>{{ money(profit.returnCost) }}</dd></div><div><dt>{{ t('其他成本', 'Other cost') }}</dt><dd>{{ money(profit.otherCost) }}</dd></div>
                      <div><dt>{{ t('前期已确认', 'Previously recognized') }}</dt><dd>{{ money(profit.previousRecognizedProfit) }}</dd></div><div><dt>{{ t('换汇尾差', 'FX rounding') }}</dt><dd>{{ money(profit.roundingAdjustment) }}</dd></div><div><dt>{{ isMonthlyReference(profit) ? t('原币整月参考净毛利', 'Original full-month reference profit') : t('原币本期净毛利', 'Original net profit') }}</dt><dd>{{ profit.originalCurrency }} {{ profit.originalAmount.toLocaleString(String(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</dd></div>
                      <div><dt>{{ t('汇率 / 日期', 'FX rate / Date') }}</dt><dd>{{ profit.fxRateToUsd }} · {{ profit.fxRateDate }}<small>{{ profit.fxRateSource }}</small></dd></div><div><dt>{{ t('已知于', 'Known at') }}</dt><dd>{{ date(profit.knownAt) }}</dd></div><div><dt>{{ t('审核时间', 'Approved at') }}</dt><dd>{{ date(profit.approvedAt) }}</dd></div>
                    </dl>
                  </td></tr>
                </template>
                <tr v-if="!data.profits.length"><td colspan="6" class="ov-empty">{{ t('当前期间暂无毛利明细。', 'No profit details in this period.') }}</td></tr>
              </tbody>
              <TableTotals><th scope="row" colspan="2">{{ t('筛选合计', 'Filtered total') }} · {{ data.total }} {{ t('笔', 'entries') }}</th><td><span>{{ t('结算', 'Settled') }} {{ money(data.totals.settledGrossProfit) }}</span><small>{{ t('预估', 'Estimated') }} {{ money(data.totals.estimatedGrossProfit) }}</small></td><td colspan="3">{{ data.totals.settledGrossProfit === null ? t('待补充分期明细', 'Allocation pending') : t('结算与预估分别合计', 'Settled and estimated totals remain separate') }}</td></TableTotals>
            </table>
          </div>
          <p class="performance-detail-asof">{{ t('截至', 'As of') }} {{ date(data.asOf) }} · {{ hasMonthlyReferences ? t('分期合计覆盖全部匹配记录；月结参考未计入分期合计', 'Period totals cover all matching contributions; monthly references are excluded.') : t('合计覆盖当前筛选的全部明细', 'Totals cover all matching details') }}</p>
        </template>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.performance-dialog{position:fixed;inset:0;width:min(1320px,calc(100vw - 48px));max-width:none;max-height:calc(100dvh - 48px);margin:auto;padding:0;border-radius:12px;box-shadow:0 24px 90px #15274730;overflow:hidden}.performance-dialog[open]{display:flex;flex-direction:column}.performance-dialog::backdrop{background:rgb(24 37 58 / 38%);backdrop-filter:blur(3px)}.performance-dialog .ov-header{flex-shrink:0;align-items:center}.performance-close{display:grid;place-items:center;padding:7px}.performance-dialog-body{overflow:auto;overscroll-behavior:contain;min-height:0}.performance-dialog-body>.ov-empty,.performance-dialog-body>.ov-error{min-height:220px;display:grid;place-content:center}.performance-dialog table{table-layout:fixed}.performance-receipts{min-width:965px}.performance-profits{min-width:1005px}.performance-dialog :is(th,td){text-align:left;vertical-align:top;white-space:normal;padding:14px 12px;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.performance-dialog td strong{font-weight:600}.performance-dialog td small{display:block;margin:6px 0 0;line-height:1.6;font-size:10px;color:var(--color-chart-muted)}.performance-detail-amount{color:var(--color-chart-link);font-weight:600}.performance-reference-amount,.performance-dialog td.performance-reference-amount small{color:#9a835d}.performance-detail-status{display:inline-block;margin-top:8px;padding:3px 7px;border-radius:4px;font-size:10px;background:#b4a0c718;color:#9683aa}.performance-detail-status.settled{background:#9cc8c018;color:#618d82}.performance-allocation{margin-top:16px;padding:12px 14px;background:#cfb5820c;border:1px solid #cfb58235;border-radius:6px;color:#9a835d;font-size:11px;line-height:1.8}.performance-allocation span{display:inline-block;margin:6px 18px 0 0}.performance-detail-asof{margin-top:15px;text-align:right;font-size:10px;line-height:1.7;color:var(--color-chart-muted)}
.performance-breakdown-row td{background:#93a6d407}.performance-breakdown{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:18px 24px;padding:5px 3px}.performance-breakdown dt{font-size:10px;color:var(--color-chart-muted);margin-bottom:6px}.performance-breakdown dd{font-size:11px;color:var(--color-text);line-height:1.6}.performance-breakdown-row .performance-breakdown small{margin-top:4px}
:global(body:has(.performance-dialog[open])),:global(body:has(.performance-dialog[open]) main){overflow:hidden}@media(max-width:640px){.performance-dialog{width:calc(100vw - 24px);max-height:calc(100dvh - 24px)}.performance-dialog .ov-header{padding:16px}}
</style>
