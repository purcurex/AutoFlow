import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useProductExpansion } from '@/composables/useProductExpansion'

describe('current-page product expansion', () => {
  it('allows single virtual-product orders to expand individually and with the page control', () => {
    const rows = [{ id: 'virtual', items: [{ sku: 'HZ000020-001' }] }, { id: 'physical', items: [{ sku: 'NORMAL' }] }]
    const scope = effectScope()
    const state = scope.run(() => useProductExpansion(() => rows, row => row.items))!
    expect(state.hasExpandableProducts.value).toBe(true)
    state.setProductExpanded('virtual', true)
    expect([...state.expandedProductIds.value]).toEqual(['virtual'])
    state.toggleAllProducts()
    expect(state.expandedProductIds.value.size).toBe(0)
    state.toggleAllProducts()
    expect([...state.expandedProductIds.value]).toEqual(['virtual'])
    scope.stop()
  })
  it('handles mixed lengths and individual toggles, then resets on page replacement', async () => {
    const rows = ref([{ id: 'short', items: [1, 2] }, { id: 'a', items: [1, 2, 3] }, { id: 'b', items: [1, 2, 3, 4] }])
    const scope = effectScope()
    const state = scope.run(() => useProductExpansion(() => rows.value, row => row.items))!
    expect(state.hasExpandableProducts.value).toBe(true)
    state.toggleAllProducts()
    expect([...state.expandedProductIds.value]).toEqual(['a', 'b'])
    state.setProductExpanded('a', false)
    expect(state.allProductsExpanded.value).toBe(false)
    state.toggleAllProducts()
    expect(state.allProductsExpanded.value).toBe(true)
    state.toggleAllProducts()
    expect(state.expandedProductIds.value.size).toBe(0)
    state.toggleAllProducts()
    rows.value = [{ id: 'a', items: [1, 2, 3] }]
    await nextTick()
    expect(state.expandedProductIds.value.size).toBe(0)
    rows.value = [{ id: 'only-short', items: [1] }]
    await nextTick()
    expect(state.hasExpandableProducts.value).toBe(false)
    state.setProductExpanded('a', true)
    expect(state.expandedProductIds.value.size).toBe(0)
    scope.stop()
  })
})
