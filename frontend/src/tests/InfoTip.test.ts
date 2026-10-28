import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import PageHeader from '@/components/ui/PageHeader.vue'
import InfoTip from '@/components/ui/InfoTip.vue'
import { defineComponent } from 'vue'
const FieldHelp = defineComponent({ components: { InfoTip }, props: ['title', 'description'], template: '<div><h1>{{ title }}</h1><label>库存数量<InfoTip>{{ description }}</InfoTip></label></div>' })

const wrappers: VueWrapper[] = []
function header() {
  const wrapper = mount(FieldHelp, { attachTo: document.body, props: { title: '业务标题', description: '仅查看进度，业务处理请在 FOP 完成。' }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  wrappers.push(wrapper)
  return wrapper
}
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()) })

describe('field information tips', () => {
  it('keeps explanatory text hidden until hover and displays updated content', async () => {
    const wrapper = header()
    expect(wrapper.text()).not.toContain('仅查看进度')
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    await wrapper.get('button[aria-label="说明"]').trigger('mouseenter'); await flushPromises()
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('业务处理请在 FOP 完成')
    await wrapper.setProps({ description: '新的说明' })
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('新的说明')
  })
  it('supports keyboard focus and Escape without adding explanation text to the heading', async () => {
    const wrapper = header()
    const button = wrapper.get('button[aria-label="说明"]')
    await button.trigger('focus'); await flushPromises()
    const tip = document.querySelector('[role="tooltip"]')!
    expect(button.attributes('aria-describedby')).toBe(tip.id)
    expect(wrapper.get('h1').text()).toBe('业务标题')
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    document.dispatchEvent(escape); await flushPromises()
    expect(escape.defaultPrevented).toBe(true)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })
  it('opens by tap, dismisses outside, and removes the portal when the page unmounts', async () => {
    const wrapper = header()
    await wrapper.get('button[aria-label="说明"]').trigger('click'); await flushPromises()
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); await flushPromises()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    await wrapper.get('button[aria-label="说明"]').trigger('click'); await flushPromises()
    wrapper.unmount()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })
})

it('keeps page headings free of decorative help and descriptions', () => {
  const wrapper = mount(PageHeader, { props: { title: '业务标题', description: '旧版说明' }, slots: { actions: '<button>新增</button>' } })
  expect(wrapper.get('h1').text()).toBe('业务标题')
  expect(wrapper.text()).not.toContain('旧版说明')
  expect(wrapper.find('.info-tip').exists()).toBe(false)
  expect(wrapper.get('button').text()).toBe('新增')
  wrapper.unmount()
})
