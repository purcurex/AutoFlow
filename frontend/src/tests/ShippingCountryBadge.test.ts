import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import ShippingCountryBadge from '@/components/autoflow/ShippingCountryBadge.vue'

const render = (code?: string | null) => mount(ShippingCountryBadge, { props: { code }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN' })] } })
describe('order destination country', () => {
  it.each([' us ', 'gb', 'AU'])('renders a local flag and uppercase destination for %s', code => {
    const wrapper = render(code)
    expect(wrapper.get('.country-code').text()).toBe(code.trim().toUpperCase())
    expect(wrapper.get('.country-flag').classes()).toContain(`fi-${code.trim().toLowerCase()}`)
    expect(wrapper.get('.shipping-country').attributes('aria-label')).toContain(code.trim().toUpperCase())
    wrapper.unmount()
  })
  it.each([undefined, null, '', 'ZZ', 'EU', 'USA', 'US<script>'])('shows no invented country for %s', code => {
    const wrapper = render(code)
    expect(wrapper.text()).toBe('—')
    expect(wrapper.find('.country-flag').exists()).toBe(false)
    wrapper.unmount()
  })
})
