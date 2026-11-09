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
  /** 未传完整性参数时兼容旧调用，明确传入时同时检查包裹完整性与发运单审核状态。 */
  it.each([
    ['allocation', undefined, '已完成'],
    ['allocation', true, '已完成'],
    ['allocation', false, '未完成'],
    ['allocation_review', undefined, '已完成'],
    ['allocation_review', true, '已完成'],
    ['allocation_review', false, '未完成'],
  ] as const)('%s清单在complete=%s时显示%s', (queue, complete, expectedLabel) => {
    const view = mount(DispatchStatus, { props: { queue, stage: 'dispatch_missing',
      ...(complete === undefined ? {} : { complete }),
      documents: [{ id: '1', number: 'FY1', status: 'approved' }] },
      global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
    expect(view.text()).toBe(expectedLabel)
    view.unmount()
  })
  it.each(['allocation', 'allocation_review'])('%s清单即使包裹完整，发运单未审核仍显示未完成', queue => {
    const view = mount(DispatchStatus, { props: { queue, complete: true,
      documents: [{ id: '1', number: 'FY1', status: 'draft' }] },
      global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
    expect(view.text()).toBe('未完成')
    view.unmount()
  })
})
