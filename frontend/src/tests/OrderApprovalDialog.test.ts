import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import OrderApprovalDialog from '@/components/autoflow/OrderApprovalDialog.vue'
import { previewOrderApproval, submitOrderApproval } from '@/api/fop-approvals'
vi.mock('@/api/fop-approvals', () => ({ previewOrderApproval: vi.fn(), submitOrderApproval: vi.fn() }))
const item = { orderId: 'o', orderNumber: 'SO-1', version: 'a'.repeat(64), eligible: true, documents: [{ id: 'd', number: 'PH-1', status: 'B', eligible: true, reason: null }] }
function setup() { return mount(OrderApprovalDialog, { props: { queue: 'allocation_review', orderIds: ['o'] }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN' })], stubs: { OrganizationModal: { template: '<section><slot /><slot name="footer" /></section>' } } } }) }
describe('approval confirmation', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(previewOrderApproval).mockResolvedValue({ source: 'mock', queue: 'allocation_review', items: [item] }) })
  it('previews associated documents before calling approval; reports warnings and refreshes', async () => {
    vi.mocked(submitOrderApproval).mockResolvedValue({ source: 'mock', requestId: 'r', completedAt: '', items: [{ orderId: 'o', orderNumber: 'SO-1', status: 'approved', message: '审核完成', documents: [{ id: 'd', number: 'PH-1', status: 'approved', message: '成功', warning: '发货通知生成失败' }] }] })
    const wrapper = setup(); await flushPromises()
    expect(wrapper.text()).toContain('PH-1'); expect(submitOrderApproval).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="confirm-approval"]').trigger('click'); await flushPromises()
    expect(submitOrderApproval).toHaveBeenCalledWith('allocation_review', expect.any(String), [{ orderId: 'o', version: 'a'.repeat(64) }])
    expect(wrapper.text()).toContain('发货通知生成失败'); expect(wrapper.emitted('completed')).toHaveLength(1)
  })
  it('includes every selected order in the result request so blocked rows remain visible', async () => {
    const blocked = { ...item, orderId: 'blocked', eligible: false, documents: [{ ...item.documents[0]!, eligible: false, reason: '发运未审核' }] }
    vi.mocked(previewOrderApproval).mockResolvedValue({ source: 'mock', queue: 'allocation_review', items: [item, blocked] })
    vi.mocked(submitOrderApproval).mockResolvedValue({ source: 'mock', requestId: 'r', completedAt: '', items: [] })
    const wrapper = setup(); await flushPromises(); await wrapper.get('[data-testid="confirm-approval"]').trigger('click'); await flushPromises()
    expect(submitOrderApproval).toHaveBeenCalledWith('allocation_review', expect.any(String), [{ orderId: 'o', version: item.version }, { orderId: 'blocked', version: item.version }])
  })
  it('blocks confirmation for ineligible documents', async () => {
    vi.mocked(previewOrderApproval).mockResolvedValue({ source: 'fop', queue: 'allocation_review', items: [{ ...item, eligible: false, documents: [{ ...item.documents[0]!, eligible: false, reason: '发运未审核' }] }] })
    const wrapper = setup(); await flushPromises()
    expect(wrapper.text()).toContain('发运未审核')
    expect(wrapper.get('[data-testid="confirm-approval"]').attributes('disabled')).toBeDefined()
  })
  it('never automatically retries or offers reapproval after transport failure', async () => {
    vi.mocked(submitOrderApproval).mockRejectedValue(new Error('timeout'))
    const wrapper = setup(); await flushPromises(); await wrapper.get('[data-testid="confirm-approval"]').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('勿重复提交'); expect(wrapper.find('[data-testid="confirm-approval"]').exists()).toBe(false)
    expect(submitOrderApproval).toHaveBeenCalledTimes(1)
  })
})
