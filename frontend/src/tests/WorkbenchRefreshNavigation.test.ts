import { previewOrderApproval, submitOrderApproval } from '@/api/fop-approvals'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, expect, it, vi } from 'vitest'
import router from '@/router'
import { getWorkbenchAccess } from '@/api/workbench-access'
import { getFopOrders, matchesFopQueue } from '@/api/fop-orders'
import { mockFopOrders } from '@/api/fop-order-fixtures'
import { clearWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import OrderApprovalDialog from '@/components/autoflow/OrderApprovalDialog.vue'

vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
vi.mock('@/components/FopDataAccessNotice.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/views/autoflow/DashboardView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/api/fop-approvals', () => ({ previewOrderApproval: vi.fn(), submitOrderApproval: vi.fn() }))
vi.mock('@/api/workbench-access', () => ({ getWorkbenchAccess: vi.fn() }))
vi.mock('@/api/fop-orders', async importOriginal => ({ ...await importOriginal<typeof import('@/api/fop-orders')>(), getFopOrders: vi.fn() }))
let wrapper: VueWrapper | undefined
let removeGuard: (() => void) | undefined
let removeTestRoute: (() => void) | undefined

afterEach(() => { removeGuard?.(); removeGuard = undefined; wrapper?.unmount(); removeTestRoute?.(); removeTestRoute = undefined; clearWorkbenchAccess(); localStorage.clear(); vi.restoreAllMocks(); vi.clearAllMocks() })

it.each([
  { delayed: false, cancelOnce: false },
  { delayed: true, cancelOnce: false },
  { delayed: false, cancelOnce: true },
])('preserves a pending search across real permission rechecks without parent remounts ($delayed, cancel once: $cancelOnce)', async ({ delayed, cancelOnce }) => {
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
  const originalSummary = wrapper.find('.workbench-filter-summary').element
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
  expect(wrapper.find('.fulfillment-page').element).toBe(originalList)
  expect(wrapper.find('.workbench-filter-summary').element).toBe(originalSummary)
  expect(wrapper.findAll('button.refresh-orders')).toHaveLength(1)
  expect(wrapper.text()).not.toContain('刷新状态')
  expect((wrapper.get('input[type=search]').element as HTMLInputElement).value).toBe('draft not submitted')
  expect(getFopOrders).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: 'submitted', departmentId: 'd1' }))
  await vi.waitFor(() => expect(wrapper!.get('button.refresh-orders').attributes('disabled')).toBeUndefined())
  expect(vi.mocked(getFopOrders).mock.calls.length).toBeLessThanOrEqual(cancelOnce ? 5 : 4)
  const requests = vi.mocked(getFopOrders).mock.calls.length
  await wrapper.get('button.refresh-orders').trigger('click'); await flushPromises()
  expect(vi.mocked(getFopOrders).mock.calls.length).toBe(requests + 1)
  expect((wrapper.get('input[type=search]').element as HTMLInputElement).value).toBe('draft not submitted')
})


it('allows review-list navigation without invoking approval APIs merely by selecting rows', async () => {
  localStorage.setItem('user', JSON.stringify({ id: 'test-user' }))
  vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['sales'], isAdmin: false, businessRole: 'salesperson' })
  const order = mockFopOrders.find(row => matchesFopQueue(row, 'review'))!
  vi.mocked(getFopOrders).mockImplementation(async query => ({ source: 'mock', refreshedAt: '2026-10-25T08:00:00Z', departments: [], items: [order], total: 1, page: query.page, pageSize: query.pageSize, totals: { orderCount: 1, itemQuantity: 1, amountsByCurrency: [] } }))
  await router.push('/workbench/sales?queue=review'); await router.isReady()
  wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  await vi.dynamicImportSettled(); await flushPromises()
  await wrapper.get('tbody input.order-checkbox').setValue(true)
  expect(wrapper.find('[data-testid="open-approval"]').exists()).toBe(true)
  vi.mocked(previewOrderApproval).mockResolvedValue({ source: 'mock', queue: 'review', items: [] })
  await wrapper.get('[data-testid="open-approval"]').trigger('click'); await flushPromises()
  await router.push('/workbench/sales?queue=review&pageSize=20'); await flushPromises()
  expect(router.currentRoute.value.query.pageSize).toBeUndefined()
  wrapper.getComponent(OrderApprovalDialog).vm.$emit('close'); await flushPromises()
  await router.push('/workbench/sales?queue=review&pageSize=20'); await flushPromises()
  expect(router.currentRoute.value.query.pageSize).toBe('20')
  expect(previewOrderApproval).toHaveBeenCalledTimes(1)
  expect(submitOrderApproval).not.toHaveBeenCalled()
})

it('keeps an in-flight approval visible when a previously started lazy navigation finishes', async () => {
  localStorage.setItem('user', JSON.stringify({ id: 'test-user' }))
  vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['sales'], isAdmin: false, businessRole: 'salesperson' })
  const order = mockFopOrders.find(row => matchesFopQueue(row, 'review'))!
  vi.mocked(getFopOrders).mockImplementation(async query => ({ source: 'mock', refreshedAt: '2026-10-27T08:00:00Z', departments: [], items: [order], total: 1, page: query.page, pageSize: query.pageSize, totals: { orderCount: 1, itemQuantity: 1, amountsByCurrency: [] } }))
  vi.mocked(previewOrderApproval).mockResolvedValue({ source: 'mock', queue: 'review', items: [{ orderId: order.id, orderNumber: order.orderNumber, version: 'v1', eligible: true, documents: [{ id: order.id, number: order.orderNumber, status: 'B', eligible: true, reason: null }] }] })
  let resolveApproval!: (result: Awaited<ReturnType<typeof submitOrderApproval>>) => void
  vi.mocked(submitOrderApproval).mockReturnValue(new Promise(resolve => { resolveApproval = resolve }))
  await router.push('/workbench/sales?queue=review'); await router.isReady()
  wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  await vi.dynamicImportSettled(); await flushPromises()
  let finishImport!: (component: { template: string }) => void
  const loadDestination = vi.fn(() => new Promise<{ template: string }>(resolve => { finishImport = resolve }))
  removeTestRoute = router.addRoute({ path: '/pending-approval-test', name: 'PendingApprovalTest', meta: { requiresAuth: true }, component: loadDestination })
  const navigation = router.push('/pending-approval-test')
  await vi.waitFor(() => expect(loadDestination).toHaveBeenCalledOnce()); await flushPromises()
  await wrapper.get('tbody input.order-checkbox').setValue(true)
  await wrapper.get('[data-testid="open-approval"]').trigger('click'); await flushPromises()
  document.querySelector<HTMLButtonElement>('[data-testid="confirm-approval"]')!.click(); await flushPromises()
  expect(submitOrderApproval).toHaveBeenCalledTimes(1)
  finishImport({ template: '<main>Destination</main>' }); await navigation; await flushPromises()
  expect(router.currentRoute.value.fullPath).toBe('/workbench/sales?queue=review')
  expect(wrapper.findComponent(OrderApprovalDialog).exists()).toBe(true)
  resolveApproval({ source: 'mock', requestId: 'r', completedAt: '2026-10-27T08:00:00Z', items: [{ orderId: order.id, orderNumber: order.orderNumber, status: 'approved', message: '审核完成', documents: [] }] })
  await flushPromises()
  expect(document.body.textContent).toContain('审核完成')
  expect(wrapper.findComponent(OrderApprovalDialog).exists()).toBe(true)
  wrapper.getComponent(OrderApprovalDialog).vm.$emit('close'); await flushPromises()
  await router.push('/pending-approval-test'); await flushPromises()
  expect(router.currentRoute.value.path).toBe('/pending-approval-test')
})
