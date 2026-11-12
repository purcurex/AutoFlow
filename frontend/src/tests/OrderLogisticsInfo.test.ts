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
  it('does not guess package channels from the order-level array position', () => {
    const wrapper = mount(OrderLogisticsInfo, { props: {
      channels: [{ name: 'Channel A', code: 'A' }, { name: 'Channel B', code: 'B' }],
      groups: [{ carrierName: 'Carrier A', shopifyTracking: { type: 'full', number: '001' } }, { carrierName: 'Carrier B', channelName: 'Explicit B', shopifyTracking: { type: 'last_mile', number: '002' } }],
    }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
    expect(wrapper.findAll('.logistics-group').map(group => group.text())).toEqual(['—001QC', 'Explicit B002WC'])
    expect(wrapper.text()).not.toContain('Carrier')
    wrapper.unmount()
  })
  it.each(['full', 'first_mile', 'last_mile'] as const)('copies only the selected %s tracking value, preserving leading zeroes', async type => {
    const copy = vi.spyOn(clipboard, 'copyText').mockResolvedValue(undefined)
    const wrapper = render([{ carrierName: 'JS', channelName: 'JS Standard', shopifyTracking: { type, number: '000JSEJX2881622244YQ' } }])
    await wrapper.get('button[aria-label="复制物流跟踪号 000JSEJX2881622244YQ"]').trigger('click')
    expect(copy).toHaveBeenCalledWith('000JSEJX2881622244YQ')
    expect(copy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('does not guess a selection from old numbers', () => {
    const wrapper = render([{ carrierName: 'YT', channelName: 'YT Standard', trackingNumbers: [{ type: 'full', number: 'OLD' }] }])
    expect(wrapper.findAll('.logistics-group').map(group => group.text())).toEqual(['YT Standard—'])
    wrapper.unmount()
  })
  it.each(['first_mile', 'last_mile', 'full'] as const)('shows only the selected %s number', (type) => {
    const wrapper = render([{ carrierName: 'JS', channelName: 'JS Standard', trackingNumbers: [{ type: 'full', number: 'NOT-SELECTED' }], shopifyTracking: { type, number: 'JSEJX2881622244YQ' } }])
    expect(wrapper.findAll('.logistics-group').map(group => group.text())).toEqual([`JS StandardJSEJX2881622244YQ${{full:"QC",first_mile:"TC",last_mile:"WC"}[type]}`])
    expect(wrapper.get('.logistics-tracking button').attributes('title')).toContain('JSEJX2881622244YQ')
    wrapper.unmount()
  })
  it('keeps a pending selection empty even when a legacy number is present', () => {
    const wrapper = render([{ carrierName: 'YT', channelName: 'YT Standard', shopifyTracking: null }])
    expect(wrapper.findAll('.logistics-group').map(group => group.text())).toEqual(['YT Standard—'])
    wrapper.unmount()
  })
})

it('shows independent full and last-mile dispatch numbers with suffix types', async () => {
 const copy=vi.spyOn(clipboard,'copyText').mockResolvedValue(undefined)
 const wrapper=mount(OrderLogisticsInfo,{props:{showAllTracking:true,groups:[{carrierName:null,channelName:'Dispatch channel',trackingNumbers:[{type:'full',number:'000FULL'},{type:'last_mile',number:'000LAST'}]}]},global:{plugins:[createI18n({legacy:false,locale:'zh-CN',messages:{}})]}})
 expect(wrapper.findAll('.tracking-type').map(t=>t.text())).toEqual(['QC','WC'])
 await wrapper.get('button[aria-label="复制物流跟踪号 000LAST"]').trigger('click');expect(copy).toHaveBeenCalledWith('000LAST')
 wrapper.unmount()
})
