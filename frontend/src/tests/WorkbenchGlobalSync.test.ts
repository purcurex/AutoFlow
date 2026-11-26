import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import WorkbenchView from '@/views/autoflow/WorkbenchView.vue'
import FopOrdersView from '@/views/autoflow/FopOrdersView.vue'
import OrderApprovalDialog from '@/components/autoflow/OrderApprovalDialog.vue'
import WorkbenchReplicaControls from '@/components/autoflow/WorkbenchReplicaControls.vue'
import { provideWorkbenchReplica } from '@/composables/workbenchReplicaContext'
import { previewOrderApproval } from '@/api/fop-approvals'
import api from '@/api/index'
import { getWorkbenchAccess } from '@/api/workbench-access'
import { getWorkbenchReplicaJob, getWorkbenchReplicaStatus, requestWorkbenchReplicaSync } from '@/api/workbench-replica'
import { clearWorkbenchAccess, refreshWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import { mockFopOrders } from '@/api/fop-order-fixtures'
import { matchesFopQueue } from '@/api/fop-orders'
import { invalidateSession } from '@/utils/session'
vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
vi.mock('@/components/FopDataAccessNotice.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/views/autoflow/DashboardView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/api/fop-approvals', () => ({ previewOrderApproval: vi.fn(), submitOrderApproval: vi.fn() }))
vi.mock('@/api/workbench-access', () => ({ getWorkbenchAccess: vi.fn() }))
vi.mock('@/api/index', () => ({ default: { get: vi.fn() } }))
vi.mock('@/api/workbench-replica', () => ({ getWorkbenchReplicaStatus: vi.fn(), requestWorkbenchReplicaSync: vi.fn(), getWorkbenchReplicaJob: vi.fn(), configureWorkbenchReplica: vi.fn(), initializeWorkbenchReplica: vi.fn() }))
const ready = { readMode: 'local', initialized: true, state: 'ready', syncConfigured: true, paused: false, sourceSyncedAt: null, nextScheduledAt: null, datasetId: 'd1', revision: '1' } as const
let wrapper: VueWrapper | undefined
beforeEach(async () => {
  vi.resetAllMocks()
  vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['sales','dispatch','procurement','allocation','warehouse'], isAdmin: true })
  await refreshWorkbenchAccess()
  vi.mocked(getWorkbenchReplicaStatus).mockResolvedValue(ready)
  vi.mocked(requestWorkbenchReplicaSync).mockResolvedValue({ id: null, state: 'skipped', reason: 'cooldown' })
  vi.mocked(api.get).mockImplementation(async (_url, options: any) => {
    const query = options?.params ?? {}, items = mockFopOrders.filter(order => matchesFopQueue(order, query.queue)).map(order => ({ ...order, ...(query.queue === 'review' ? { rawBillStatus: 'B' } : {}) }))
    return { source: 'mock', items, total: items.length, page: query.page ?? 1, pageSize: query.pageSize ?? 50, departments: [], refreshedAt: '2026-11-11T00:00:00Z', totals: { orderCount: items.length, itemQuantity: 0, amountsByCurrency: [] }, replica: { readMode: 'local', datasetId: 'd1', revision: '1', sourceSyncedAt: null } }
  })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; clearWorkbenchAccess(); invalidateSession(); vi.useRealTimers() })
async function setup() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/:role', name: 'RoleWorkbench', component: WorkbenchView }, { path: '/dashboard', component: { template: '<div />' } }] })
  await router.push('/workbench/sales?queue=review'); await router.isReady()
  wrapper = mount(WorkbenchView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  await vi.dynamicImportSettled(); await flushPromises()
  return router
}
// The compact workbench no longer mounts source synchronization controls.
// Keep their explicit-job/context lifecycle covered independently of that shell.
async function setupReplicaControls() {
  vi.mocked(getWorkbenchReplicaStatus).mockResolvedValue({ ...ready, automaticCallsEnabled: false })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/:role', name: 'RoleWorkbench', component: FopOrdersView }] })
  await router.push('/workbench/sales?queue=review'); await router.isReady()
  const host = defineComponent({
    components: { WorkbenchReplicaControls },
    setup: () => provideWorkbenchReplica(),
    template: '<div><WorkbenchReplicaControls :replica="replica" :disabled="disabled" :navigation-ready="navigationReady" @synced="reload" /><RouterView /></div>',
  })
  wrapper = mount(host, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  await flushPromises()
  return router
}
it('keeps one local refresh beside the queue tabs without starting source synchronization', async () => {
  const router = await setup()
  for (const path of ['/workbench/sales?queue=review','/workbench/sales?queue=exceptions','/workbench/dispatch','/workbench/procurement?view=fulfillment','/workbench/allocation','/workbench/warehouse']) {
    await router.push(path); await flushPromises()
    expect(wrapper!.findAll('button.refresh-orders')).toHaveLength(1)
    expect(wrapper!.find('.workbench-queue-refresh button.refresh-orders').exists()).toBe(true)
    expect(wrapper!.find('[data-testid="sync-workbench"]').exists()).toBe(false)
  }
  const reads = vi.mocked(api.get).mock.calls.length
  await wrapper!.get('button.refresh-orders').trigger('click'); await flushPromises()
  expect(api.get).toHaveBeenCalledTimes(reads + 1)
  expect(requestWorkbenchReplicaSync).not.toHaveBeenCalled()
  expect(getWorkbenchReplicaJob).not.toHaveBeenCalled()
})
it('keeps an explicit replica job across queue switches and reloads the registered list only after completion', async () => {
  vi.useFakeTimers()
  const router = await setupReplicaControls()
  vi.mocked(requestWorkbenchReplicaSync).mockResolvedValueOnce({ id: 'global-job', state: 'pending' })
  vi.mocked(getWorkbenchReplicaJob).mockResolvedValue({ id: 'global-job', state: 'succeeded' })
  await wrapper!.get('[data-testid="sync-workbench"]').trigger('click'); await flushPromises()
  const element = wrapper!.get('[data-testid="sync-workbench"]').element
  await router.push('/workbench/sales?queue=exceptions&search=quality'); await flushPromises()
  expect(wrapper!.get('[data-testid="sync-workbench"]').element).toBe(element)
  expect(wrapper!.get('[data-testid="sync-workbench"]').text()).toContain('同步中')
  const reads = vi.mocked(api.get).mock.calls.length
  await vi.advanceTimersByTimeAsync(2_000); await flushPromises()
  expect(getWorkbenchReplicaJob).toHaveBeenCalledWith('global-job', expect.any(AbortSignal))
  expect(vi.mocked(api.get).mock.calls.length).toBe(reads + 1)
  expect(api.get).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ params: expect.objectContaining({ queue: 'exceptions', search: 'quality' }) }))
  expect(wrapper!.text()).toContain('同步完成')
})

it('defers shared sync completion until the current approval dialog is closed', async () => {
  vi.useFakeTimers()
  await setupReplicaControls()
  vi.mocked(requestWorkbenchReplicaSync).mockResolvedValueOnce({ id: 'approval-job', state: 'pending' })
  vi.mocked(getWorkbenchReplicaJob).mockResolvedValue({ id: 'approval-job', state: 'succeeded' })
  vi.mocked(previewOrderApproval).mockResolvedValue({ source: 'mock', queue: 'review', items: [] })
  await wrapper!.get('[data-testid="sync-workbench"]').trigger('click'); await flushPromises()
  await wrapper!.get('tbody input.order-checkbox').setValue(true)
  await wrapper!.get('[data-testid="open-approval"]').trigger('click'); await flushPromises()
  const reads = vi.mocked(api.get).mock.calls.length
  await vi.advanceTimersByTimeAsync(2_000); await flushPromises()
  expect(wrapper!.findComponent(OrderApprovalDialog).exists()).toBe(true)
  expect(api.get).toHaveBeenCalledTimes(reads)
  wrapper!.getComponent(OrderApprovalDialog).vm.$emit('close'); await flushPromises()
  expect(api.get).toHaveBeenCalledTimes(reads + 1)
})
it('finishes a pending local queue read without requesting an automatic source increment', async () => {
  const router = await setup()
  const syncs = vi.mocked(requestWorkbenchReplicaSync).mock.calls.length
  let finish!: (value: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await router.push('/workbench/sales?queue=exceptions'); await flushPromises()
  expect(finish).toBeTypeOf('function')
  expect(requestWorkbenchReplicaSync).toHaveBeenCalledTimes(syncs)
  finish({ source: 'mock', items: [], total: 0, page: 1, pageSize: 50, departments: [], refreshedAt: '2026-11-11T00:00:00Z', totals: { orderCount: 0, itemQuantity: 0, amountsByCurrency: [] } })
  await flushPromises()
  expect(requestWorkbenchReplicaSync).toHaveBeenCalledTimes(syncs)
  expect(wrapper!.get('button.refresh-orders').attributes('disabled')).toBeUndefined()
  expect(getWorkbenchReplicaJob).not.toHaveBeenCalled()
})
