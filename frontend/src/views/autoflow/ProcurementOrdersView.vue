<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import FopOrdersView from './FopOrdersView.vue'
import PurchaseGroupsView from './PurchaseGroupsView.vue'
import { useWorkbenchAccess } from '@/composables/useWorkbenchAccess'
type SearchRecovery = { token: symbol; from: string; to: string; search: string }
const props = defineProps<{ searchRecovery?: SearchRecovery; recoverPage?: (recovery: SearchRecovery) => Promise<void> }>()
const emit = defineEmits<{ 'filter-labels': [rows: { id: string; name: string }[]]; 'clear-search-recovery': [token: symbol] }>()
const route = useRoute(), router = useRouter(), { locale } = useI18n()
const { access } = useWorkbenchAccess()
const grouped = computed(() => {
  if (route.query.view === 'purchase' || route.query.view === 'fulfillment') return route.query.view === 'purchase'
  return access.value?.defaultProcurementView === 'purchase'
})
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
function change(view: string) {
  void router.replace({ query: { ...route.query, view, page: undefined, sortBy: undefined, sortOrder: undefined, taskStatus: undefined, procurementStage: undefined, purchaseStage: undefined } })
}
</script>
<template>
  <component
    :is="grouped ? PurchaseGroupsView : FopOrdersView"
    class="procurement-order-view"
    v-bind="grouped ? {} : props"
    @clear-search-recovery="emit('clear-search-recovery', $event)"
    @filter-labels="emit('filter-labels', $event)"
  >
    <template #heading-actions>
      <div class="purchase-view-switch" role="group" :aria-label="text('采购查看方式', 'Purchase view')">
        <button type="button" :aria-pressed="!grouped" @click="change('fulfillment')">{{ text('按履约单查看', 'By fulfillment order') }}</button>
        <button type="button" :aria-pressed="grouped" @click="change('purchase')">{{ text('按采购单查看', 'By purchase order') }}</button>
      </div>
    </template>
  </component>
</template>
<style scoped>
.purchase-view-switch { display: inline-flex; flex-shrink: 0; padding: 3px; border: 1px solid var(--color-border); border-radius: 7px; background: var(--color-background); }
.purchase-view-switch button { padding: 6px 11px; border-radius: 4px; color: var(--color-text-secondary); font-size: 12px; line-height: 22px; white-space: nowrap; transition: background .15s, color .15s; }
.purchase-view-switch button[aria-pressed="true"] { color: var(--color-chart-link); background: var(--color-surface); box-shadow: 0 1px 4px #0000000d; font-weight: 600; }
.purchase-view-switch button:hover { color: var(--color-chart-link); }
.purchase-view-switch button:focus-visible { outline: 2px solid var(--color-chart-link); outline-offset: 2px; }
.procurement-order-view :deep(.workbench-task-heading) { align-items: flex-start; }
.procurement-order-view :deep(.task-heading-copy) { flex: 1; min-width: 190px; }
@media (max-width: 700px) { .purchase-view-switch button { padding-inline: 8px; } }
</style>
