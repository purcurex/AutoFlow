import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import CollapsibleProductLines from '@/components/autoflow/CollapsibleProductLines.vue'

const lines = [
  { sku: 'SAME', name: 'First source line', quantity: 100 as number | null },
  { sku: 'SAME', name: 'Second source line', quantity: 2 },
  { sku: 'SAME', name: 'Third source line', quantity: 3 },
]
function setup(items: (typeof lines[number] & { isVirtual?: boolean | null })[] = lines) {
  return mount(CollapsibleProductLines, {
    props: { items, label: 'SO-1' },
    slots: { default: ({ item }) => h('button', { class: 'product-copy' }, (item as typeof lines[number]).name) },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] },
  })
}
describe('product detail collapse', () => {
  it('previews a physical line and keeps virtual lines last without mutating source order', async () => {
    const items = [
      { ...lines[0]!, name: 'Virtual A', isVirtual: true },
      { ...lines[1]!, name: 'Physical A', isVirtual: false },
      { ...lines[2]!, name: 'Virtual B', sku: 'HZ000020-001' },
      { ...lines[1]!, name: 'Physical B', isVirtual: false },
    ]
    const wrapper = setup(items)
    expect(wrapper.findAll('.product-copy').map(x => x.text())).toEqual(['Physical A'])
    await wrapper.get('.product-lines-toggle').trigger('click')
    expect(wrapper.findAll('.product-copy').map(x => x.text())).toEqual(['Physical A', 'Physical B', 'Virtual A', 'Virtual B'])
    expect(items.map(x => x.name)).toEqual(['Virtual A', 'Physical A', 'Virtual B', 'Physical B'])
    expect(wrapper.text()).toContain('4 行商品 · 107 件')
    wrapper.unmount()
  })
  it('orders two-line records without adding a collapse control', () => {
    const wrapper = setup([{ ...lines[0]!, isVirtual: true }, { ...lines[1]!, isVirtual: false }])
    expect(wrapper.findAll('.product-copy').map(x => x.text())).toEqual(['Second source line', 'First source line'])
    expect(wrapper.find('.product-lines-toggle').exists()).toBe(false)
    wrapper.unmount()
  })
  it.each([1, 2, 3])('keeps an all-virtual %i-line record accessible without a virtual main-row preview', async count => {
    const wrapper = setup(lines.slice(0, count).map(line => ({ ...line, isVirtual: true })))
    expect(wrapper.findAll('.product-copy')).toHaveLength(0)
    await wrapper.get('.product-lines-toggle').trigger('click')
    expect(wrapper.findAll('.product-copy')).toHaveLength(count)
    wrapper.unmount()
  })
  it('keeps unknown products in source order instead of guessing from their names', () => {
    const wrapper = setup([{ ...lines[0]!, name: '虚拟字样的实物卡片', isVirtual: null }, lines[1]!])
    expect(wrapper.findAll('.product-copy').map(x => x.text())).toEqual(['虚拟字样的实物卡片', 'Second source line'])
    wrapper.unmount()
  })
  it.each([1, 2])('shows %i source lines fully regardless of unit count, with no toggle', count => {
    const wrapper = setup(lines.slice(0, count))
    expect(wrapper.findAll('.product-copy')).toHaveLength(count)
    expect(wrapper.find('.product-lines-toggle').exists()).toBe(false)
    wrapper.unmount()
  })
  it('counts duplicate SKU source lines, expands only by its control and collapses again', async () => {
    const wrapper = setup()
    expect(wrapper.findAll('.product-copy')).toHaveLength(1)
    expect(wrapper.text()).toContain('3 行商品 · 105 件')
    await wrapper.get('.product-copy').trigger('click')
    expect(wrapper.findAll('.product-copy')).toHaveLength(1)
    await wrapper.get('.product-lines-toggle').trigger('click')
    expect(wrapper.findAll('.product-copy')).toHaveLength(3)
    expect(wrapper.get('.product-lines-toggle').attributes('aria-expanded')).toBe('true')
    await wrapper.get('.product-lines-toggle').trigger('click')
    expect(wrapper.findAll('.product-copy')).toHaveLength(1)
    wrapper.unmount()
  })
  it('re-evaluates the threshold and resets expansion when refreshed source lines change', async () => {
    const wrapper = setup()
    await wrapper.get('.product-lines-toggle').trigger('click')
    await wrapper.setProps({ items: lines.slice(0, 2) })
    expect(wrapper.findAll('.product-copy')).toHaveLength(2)
    expect(wrapper.find('.product-lines-toggle').exists()).toBe(false)
    await wrapper.setProps({ items: [...lines] })
    expect(wrapper.findAll('.product-copy')).toHaveLength(1)
    wrapper.unmount()
  })
  it('keeps unknown quantities unknown', () => {
    const wrapper = setup(lines.map((item, index) => ({ ...item, quantity: index === 1 ? null : item.quantity })))
    expect(wrapper.text()).toContain('3 行商品 · — 件')
    wrapper.unmount()
  })
})
it('uses the server detail-line total for a paginated preview and emits expansion without inventing missing lines', async () => {
 const wrapper=setup(lines.slice(0,1))
 await wrapper.setProps({lineCount:21,totalQuantity:150,expanded:false})
 expect(wrapper.text()).toContain('21 行商品 · 150 件')
 expect(wrapper.get('.product-lines-toggle').attributes('aria-expanded')).toBe('false')
 await wrapper.get('.product-lines-toggle').trigger('click')
 expect(wrapper.emitted('update:expanded')).toEqual([[true]])
 expect(wrapper.findAll('.product-copy')).toHaveLength(1)
 wrapper.unmount()
})
