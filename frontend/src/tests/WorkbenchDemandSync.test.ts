import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import WorkbenchReplicaControls from '@/components/autoflow/WorkbenchReplicaControls.vue'
import api from '@/api/index'
import { invalidateSession } from '@/utils/session'
vi.mock('@/api/index', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
const ready = { readMode: 'local', state: 'ready', initialized: true, syncConfigured: true, paused: false, dataMode: 'fop', sourceSyncedAt: null }
const mounted: ReturnType<typeof mount>[] = []
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.get).mockResolvedValue(ready); vi.mocked(api.post).mockResolvedValue({ id: null, state: 'skipped', reason: 'cooldown' }) })
afterEach(() => { mounted.splice(0).forEach(w => w.unmount()); invalidateSession(); vi.useRealTimers() })
async function setup(disabled = false) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
  await router.push('/workbench/sales?queue=review'); await router.isReady()
  const wrapper = mount(WorkbenchReplicaControls, { props: { disabled }, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  mounted.push(wrapper); await flushPromises(); return { wrapper, router }
}
it('loads local first; only first entry and queue/workbench changes request navigation increments', async () => {
  const { wrapper, router } = await setup(true)
  expect(api.post).not.toHaveBeenCalled()
  await wrapper.setProps({ disabled: false }); await flushPromises()
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(api.post).toHaveBeenLastCalledWith('/workbench/replica/sync', { requestKey: expect.any(String), trigger: 'navigation' }, expect.anything())
  for (const query of ['', 'queue=review&page=2','queue=review&search=SKU&timeRange=1w','queue=review&departmentId=one&sort=paidAt&purchaseView=order']) {
    await router.push('/workbench/sales?' + query); await flushPromises()
  }
  expect(api.post).toHaveBeenCalledTimes(1)
  await router.push('/workbench/sales?queue=completed'); await flushPromises()
  expect(api.post).toHaveBeenCalledTimes(2)
  await router.push('/workbench/procurement?queue=procurement'); await flushPromises()
  expect(api.post).toHaveBeenCalledTimes(3)
  expect(wrapper.emitted('synced')).toBeUndefined()
})
it.each([{ paused: true }, { dataMode: 'mock' }, { syncConfigured: false }, { initialized: false }, { automaticCallsEnabled: false }])('never starts source work with guard %j', async guard => {
  vi.mocked(api.get).mockResolvedValue({ ...ready, ...guard })
  const { router } = await setup(); await router.push('/workbench/sales?queue=stock'); await flushPromises()
  expect(api.post).not.toHaveBeenCalled()
})
it('defers a completed sync reload while an approval/export operation is busy', async () => {
  let finish!: (v: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { wrapper } = await setup()
  await wrapper.setProps({ disabled: true }); finish({ id: 'one', state: 'succeeded' }); await flushPromises()
  expect(wrapper.emitted('synced')).toBeUndefined()
  await wrapper.setProps({ disabled: false }); await flushPromises()
  expect(wrapper.emitted('synced')).toHaveLength(1)
  expect(api.post).toHaveBeenCalledTimes(1)
})
it('recovers an unavailable status on the next queue visit without remounting the shared control', async () => {
  vi.mocked(api.post).mockResolvedValueOnce({ id: 'one', state: 'succeeded' })
  vi.mocked(api.get).mockResolvedValueOnce(ready).mockRejectedValueOnce(new Error('temporary status failure')).mockResolvedValue(ready)
  const { wrapper, router } = await setup()
  expect(wrapper.get('[data-testid="sync-workbench"]').attributes('disabled')).toBeDefined()
  await router.push('/workbench/sales?queue=stock'); await flushPromises()
  expect(api.get).toHaveBeenCalledTimes(3)
  expect(wrapper.get('[data-testid="sync-workbench"]').attributes('disabled')).toBeUndefined()
  expect(api.post).toHaveBeenCalledTimes(2)
})
it('discards an old route response and lets explicit sync bypass a navigation skip', async () => {
  let finish!: (v: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { wrapper, router } = await setup()
  await router.push('/workbench/sales?queue=stock'); await flushPromises()
  finish({ id: 'old', state: 'succeeded' }); await flushPromises()
  expect(wrapper.emitted('synced')).toBeUndefined()
  vi.mocked(api.post).mockResolvedValue({ id: 'manual', state: 'succeeded' })
  await wrapper.get('[data-testid="sync-workbench"]').trigger('click'); await flushPromises()
  expect(api.post).toHaveBeenLastCalledWith('/workbench/replica/sync', { requestKey: expect.any(String) }, expect.anything())
  expect(wrapper.emitted('synced')).toHaveLength(1)
})
it('does not sync again when procurement view changes remount the controls, but does on a real return visit', async () => {
  const { wrapper, router } = await setup()
  await router.push('/workbench/procurement?queue=procurement&view=fulfillment'); await flushPromises()
  expect(api.post).toHaveBeenCalledTimes(2)
  const remount = () => {
    const next = mount(WorkbenchReplicaControls, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
    mounted.push(next); return next
  }
  wrapper.unmount()
  await router.push('/workbench/procurement?queue=procurement&view=purchase')
  const purchase = remount(); await flushPromises()
  expect(api.post).toHaveBeenCalledTimes(2)
  purchase.unmount()
  await router.push('/dashboard'); await router.push('/workbench/procurement?queue=procurement&view=purchase')
  remount(); await flushPromises()
  expect(api.post).toHaveBeenCalledTimes(3)
})
