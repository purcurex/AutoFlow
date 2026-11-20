<script setup lang="ts" generic="T extends { quantity: number | null; sku?: string; isVirtual?: boolean | null }">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import { orderItemQuantity } from '@/api/fop-orders'
import { isVirtualProduct, physicalProductsFirst } from '@/utils/product-display'
const props = withDefaults(defineProps<{ items: T[]; label: string; lineCount?: number | null; totalQuantity?: number | null; expanded?: boolean; showSummary?: boolean }>(), { expanded: undefined, showSummary: true })
const emit = defineEmits<{ 'update:expanded': [value: boolean] }>()
const { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const localExpanded = ref(false), contentId = useId()
const expanded = computed(() => props.expanded ?? localExpanded.value)
const count = computed(() => props.lineCount === undefined ? props.items.length : props.lineCount)
function toggle() {
  const next = !expanded.value
  if (props.expanded === undefined) localExpanded.value = next
  emit('update:expanded', next)
}
const onlyVirtual = computed(() => props.items.length > 0 && props.items.every(isVirtualProduct))
const collapsible = computed(() => onlyVirtual.value || count.value != null && count.value >= 3)
const orderedItems = computed(() => physicalProductsFirst(props.items.map((item, index) => ({ item, index, sku: item.sku, isVirtual: item.isVirtual }))))
const visibleItems = computed(() => collapsible.value && !expanded.value ? onlyVirtual.value ? [] : orderedItems.value.slice(0, 1) : orderedItems.value)
const quantity = computed(() => props.totalQuantity === undefined ? orderItemQuantity(props.items) : props.totalQuantity)
watch(() => props.items, () => { localExpanded.value = false }, { deep: true })
</script>
<template>
  <div class="product-lines">
    <button v-if="collapsible" type="button" class="product-lines-toggle" :aria-expanded="expanded" :aria-controls="contentId" :aria-label="`${zh ? expanded ? '收起商品明细' : '展开商品明细' : expanded ? 'Collapse product details' : 'Expand product details'} · ${label}`" @click.stop="toggle"><ChevronDown v-if="expanded" :size="16" /><ChevronRight v-else :size="16" /></button>
    <span v-else class="product-lines-placeholder" aria-hidden="true" />
    <div :id="contentId" class="product-lines-content">
      <slot v-for="{ item, index } in visibleItems" :key="index" :item="item" :index="index" />
      <small v-if="collapsible && showSummary" class="product-lines-summary">{{ zh ? `${count} 行商品 · ${quantity ?? '—'} 件` : `${count} product lines · ${quantity ?? '—'} units` }}</small>
    </div>
  </div>
</template>
<style scoped>
.product-lines{display:flex;align-items:flex-start;gap:5px;min-width:0}.product-lines-content{flex:1;min-width:0}.product-lines-toggle,.product-lines-placeholder{display:inline-flex;align-items:center;justify-content:center;width:22px;min-width:22px;height:30px;margin-top:4px;flex-shrink:0}.product-lines-toggle{color:var(--color-text-secondary);border-radius:4px;cursor:pointer}.product-lines-toggle:hover{color:var(--color-chart-link);background:var(--color-surface-muted)}.product-lines-toggle:focus-visible{outline:2px solid var(--color-chart-link);outline-offset:2px}.product-lines-summary{display:block;margin-top:8px;color:var(--color-text-secondary);font-size:11px;line-height:1.6;font-variant-numeric:tabular-nums}
</style>
