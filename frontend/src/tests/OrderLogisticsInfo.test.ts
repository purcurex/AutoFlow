import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as clipboard from '@/utils/copyText'
import OrderLogisticsInfo from '@/components/autoflow/OrderLogisticsInfo.vue'
import type { LogisticsInfo } from '@/api/fop-orders'

function render(groups: LogisticsInfo[], trackingNumber = '000123') {
  return mount(OrderLogisticsInfo, { props: { groups, carrier: 'Legacy Carrier', trackingNumber }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
}

describe('selected Shopify tracking', () => {
  afterEach(() => vi.restoreAllMocks())
  it.each(['full', 'first_mile', 'last_mile'] as const)('copies only the selected %s tracking value, preserving leading zeroes', async type => {
    const copy = vi.spyOn(clipboard, 'copyText').mockResolvedValue(undefined)
    const wrapper = render([{ carrierName: 'JS', shopifyTracking: { type, number: '000JSEJX2881622244YQ' } }])
    await wrapper.get('button[aria-label="复制物流跟踪号 000JSEJX2881622244YQ"]').trigger('click')
    expect(copy).toHaveBeenCalledWith('000JSEJX2881622244YQ')
    expect(copy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('does not guess a selection from old numbers', () => {
    const wrapper = render([{ carrierName: 'YT', trackingNumbers: [{ type: 'full', number: 'OLD' }] }])
    expect(wrapper.findAll('.logistics-group').map(group => group.text())).toEqual(['YT—'])
    wrapper.unmount()
  })
  it.each([['first_mile', 'TC'], ['last_mile', 'WC'], ['full', 'QC']] as const)('shows only the selected %s number', (type, code) => {
    const wrapper = render([{ carrierName: 'JS', trackingNumbers: [{ type: 'full', number: 'NOT-SELECTED' }], shopifyTracking: { type, number: 'JSEJX2881622244YQ' } }])
    expect(wrapper.findAll('.logistics-group').map(group => group.text())).toEqual([`JS${code}: JSEJX2881622244YQ`])
    expect(wrapper.get('.logistics-tracking button').attributes('title')).toContain('JSEJX2881622244YQ')
    wrapper.unmount()
  })
  it('keeps a pending selection empty even when a legacy number is present', () => {
    const wrapper = render([{ carrierName: 'YT', shopifyTracking: null }])
    expect(wrapper.findAll('.logistics-group').map(group => group.text())).toEqual(['YT—'])
    wrapper.unmount()
  })
})
