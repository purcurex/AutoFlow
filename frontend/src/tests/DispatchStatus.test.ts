import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import DispatchStatus from '@/components/autoflow/DispatchStatus.vue'

describe('待履约包裹聚合阶段', () => {
  it('已有审核发运单但还缺另一包裹时，按服务端事实显示未创建', () => {
    const view = mount(DispatchStatus, { props: { queue: 'dispatch', stage: 'dispatch_missing', shopifySync: 'pending',
      documents: [{ id: '1', number: 'FY1', status: 'approved' }] },
      global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
    expect(view.text()).toBe('未创建')
    view.unmount()
  })
  it('配货清单仍使用原发运单审核完成规则', () => {
    const view = mount(DispatchStatus, { props: { queue: 'allocation', stage: 'dispatch_missing',
      documents: [{ id: '1', number: 'FY1', status: 'approved' }] },
      global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
    expect(view.text()).toBe('已完成')
    view.unmount()
  })
})
