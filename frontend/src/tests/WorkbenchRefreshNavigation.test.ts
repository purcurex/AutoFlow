import { previewOrderApproval, submitOrderApproval, type ApprovalResult } from '@/api/fop-approvals'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, expect, it, vi } from 'vitest'
import router from '@/router'
import { getWorkbenchAccess } from '@/api/workbench-access'
import { getFopOrders, matchesFopQueue } from '@/api/fop-orders'
import { mockFopOrders } from '@/api/fop-order-fixtures'
import { clearWorkbenchAccess } from '@/composables/useWorkbenchAccess'

vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
vi.mock('@/components/FopDataAccessNotice.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/views/autoflow/DashboardView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/api/fop-approvals', () => ({ previewOrderApproval: vi.fn(), submitOrderApproval: vi.fn() }))
vi.mock('@/api/workbench-access', () => ({ getWorkbenchAccess: vi.fn() }))
vi.mock('@/api/fop-orders', async importOriginal => ({ ...await importOriginal<typeof import('@/api/fop-orders')>(), getFopOrders: vi.fn() }))
let wrapper: VueWrapper | undefined
let removeGuard: (() => void) | undefined

afterEach(() => { removeGuard?.(); removeGuard = undefined; wrapper?.unmount(); clearWorkbenchAccess(); localStorage.clear(); vi.restoreAllMocks(); vi.clearAllMocks() })

it.each([
  { delayed: false, cancelOnce: false },
  { delayed: true, cancelOnce: false },
  { delayed: false, cancelOnce: true },
])('preserves a pending search across real guard/parent remounts ($delayed, cancel once: $cancelOnce)', async ({ delayed, cancelOnce }) => {
  localStorage.setItem('user', JSON.stringify({ id: 'test-user' }))
  vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['allocation'], isAdmin: false, businessRole: 'salesperson' })
  let total = 51
  const order = mockFopOrders.find(row => matchesFopQueue(row, 'allocation'))!
  vi.mocked(getFopOrders).mockImplementation(async query => {
    if (delayed) await new Promise(resolve => setTimeout(resolve, 0))
    return {
    source: 'mock', refreshedAt: '2026-10-24T08:00:00Z', departments: [{ id: 'd1', name: '业务一部' }],
    items: query.page === 2 && total === 1 ? [] : [order], total, page: query.page, pageSize: query.pageSize,
    totals: { orderCount: total, itemQuantity: total, amountsByCurrency: [{ currency: 'USD', amount: total * 10 }] },
  } })
  await router.push('/workbench/allocation?queue=allocation&page=2&departmentId=d1&search=submitted')
  await router.isReady()
  wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  await vi.dynamicImportSettled(); await flushPromises()
  await wrapper.get('input[type=search]').setValue('draft not submitted')
  const originalList = wrapper.find('.fulfillment-page').element
  const checks = vi.mocked(getWorkbenchAccess).mock.calls.length
  if (cancelOnce) removeGuard = router.beforeResolve(() => { removeGuard?.(); removeGuard = undefined; return false })
  total = 1
  await wrapper.get('button.refresh-orders').trigger('click')
  await flushPromises(); await vi.dynamicImportSettled(); await flushPromises()
  if (cancelOnce) {
    expect(router.currentRoute.value.query.page).toBe('2')
    expect(wrapper.text()).toContain('页码更新未完成')
    expect((wrapper.get('input[type=search]').element as HTMLInputElement).value).toBe('draft not submitted')
    await wrapper.get('button.refresh-orders').trigger('click')
    await flushPromises()
  }
  expect(router.currentRoute.value.query).toMatchObject({ page: '1', departmentId: 'd1', search: 'submitted' })
  expect(vi.mocked(getWorkbenchAccess).mock.calls.length).toBeGreaterThan(checks)
  expect(wrapper.find('.fulfillment-page').element).not.toBe(originalList)
  expect((wrapper.get('input[type=search]').element as HTMLInputElement).value).toBe('draft not submitted')
  expect(getFopOrders).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: 'submitted', departmentId: 'd1' }))
  await vi.waitFor(() => expect(wrapper!.get('button.refresh-orders').attributes('disabled')).toBeUndefined())
  expect(vi.mocked(getFopOrders).mock.calls.length).toBeLessThanOrEqual(cancelOnce ? 5 : 4)
  const requests = vi.mocked(getFopOrders).mock.calls.length
  await wrapper.get('button.refresh-orders').trigger('click'); await flushPromises()
  expect(vi.mocked(getFopOrders).mock.calls.length).toBe(requests + 1)
  expect((wrapper.get('input[type=search]').element as HTMLInputElement).value).toBe('draft not submitted')
})


it('blocks real-router access refresh and query/back navigation while approval is open or pending', async () => {
  localStorage.setItem('user', JSON.stringify({ id: 'test-user' }))
  vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['sales'], isAdmin: false, businessRole: 'salesperson' })
  const order = mockFopOrders.find(row => matchesFopQueue(row, 'review'))!
  vi.mocked(getFopOrders).mockImplementation(async query => ({ source: 'mock', refreshedAt: '2026-10-25T08:00:00Z', departments: [], items: [order], total: 1, page: query.page, pageSize: query.pageSize, totals: { orderCount: 1, itemQuantity: 1, amountsByCurrency: [] } }))
  vi.mocked(previewOrderApproval).mockResolvedValue({ source: 'mock', queue: 'review', items: [{ orderId: order.id, orderNumber: order.orderNumber, eligible: true, version: 'a'.repeat(64), documents: [{ id: order.id, number: order.orderNumber, status: 'B', eligible: true, reason: null }] }] })
  let complete!: (value: ApprovalResult) => void
  vi.mocked(submitOrderApproval).mockReturnValue(new Promise(resolve => { complete = resolve }))
  await router.push('/workbench/sales?queue=unpaid'); await router.push('/workbench/sales?queue=review'); await router.isReady()
  wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { Teleport: true } } })
  await vi.dynamicImportSettled(); await flushPromises()
  await wrapper.get('tbody input.order-checkbox').setValue(true)
  await wrapper.get('[data-testid="open-approval"]').trigger('click'); await flushPromises()
  const checks = vi.mocked(getWorkbenchAccess).mock.calls.length
  await router.push('/workbench/sales?queue=review&pageSize=20'); await flushPromises()
  expect(router.currentRoute.value.fullPath).toBe('/workbench/sales?queue=review')
  expect(wrapper.text()).toContain('确认模拟审核')
  await wrapper.get('[data-testid="confirm-approval"]').trigger('click'); await flushPromises()
  router.back(); await new Promise(resolve => setTimeout(resolve, 20)); await flushPromises()
  expect(router.currentRoute.value.fullPath).toBe('/workbench/sales?queue=review')
  expect(getWorkbenchAccess).toHaveBeenCalledTimes(checks)
  complete({ source: 'mock', requestId: 'r', completedAt: '', items: [{ orderId: order.id, orderNumber: order.orderNumber, status: 'approved', message: '审核完成', documents: [] }] }); await flushPromises()
  expect(wrapper.text()).toContain('审核完成')
  const done = wrapper.findAll('.org-modal button').find(button => button.text() === '完成')!
  await done.trigger('click'); await flushPromises()
  await router.push('/workbench/sales?queue=unpaid'); await flushPromises()
  expect(router.currentRoute.value.query.queue).toBe('unpaid')
})
