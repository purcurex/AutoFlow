import { computed, ref, watch } from 'vue'
import { isVirtualProduct } from '@/utils/product-display'

/** Display state only: never loads another page or changes the underlying rows. */
export function useProductExpansion<T extends { id: string }>(rows: () => readonly T[], lines: (row: T) => readonly unknown[]) {
  const expandedProductIds = ref(new Set<string>())
  const eligible = computed(() => rows().filter(row => {
    const items = lines(row)
    return items.length >= 3 || items.length > 0 && items.every(isVirtualProduct)
  }).map(row => row.id))
  const hasExpandableProducts = computed(() => eligible.value.length > 0)
  const allProductsExpanded = computed(() => hasExpandableProducts.value && eligible.value.every(id => expandedProductIds.value.has(id)))
  function setProductExpanded(id: string, expanded: boolean) {
    if (!eligible.value.includes(id)) return
    const next = new Set(expandedProductIds.value)
    if (expanded) next.add(id)
    else next.delete(id)
    expandedProductIds.value = next
  }
  function toggleAllProducts() {
    expandedProductIds.value = new Set(allProductsExpanded.value ? [] : eligible.value)
  }
  watch(rows, () => { expandedProductIds.value = new Set() }, { deep: true })
  return { expandedProductIds, hasExpandableProducts, allProductsExpanded, setProductExpanded, toggleAllProducts }
}
