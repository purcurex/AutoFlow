import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkbenchReplicaControls from '@/components/autoflow/WorkbenchReplicaControls.vue'
import api from '@/api/index'
import { captureSession, invalidateSession } from '@/utils/session'
import { getWorkbenchCount, rememberWorkbenchCount } from '@/utils/workbench-counts'

vi.mock('@/api/index', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
const ready = { readMode: 'local', state: 'ready', initialized: true, sourceSyncedAt: '2026-11-11T00:30:00Z', nextScheduledAt: '2026-11-11T01:00:00Z', datasetId: 'd1', revision: 'r1', paused: false }
const mounted: ReturnType<typeof mount>[] = []
function setup() {
  const wrapper = mount(WorkbenchReplicaControls, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  mounted.push(wrapper)
  return wrapper
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.get).mockResolvedValue(ready) })
afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()); invalidateSession(); vi.useRealTimers() })

describe('local workbench source synchronization', () => {
  it('labels collection as read-only rather than full initialization and keeps sync paused', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...ready, state: 'collected', paused: true, automaticCallsEnabled: false, collected: { batchId: 'batch', sourceAsOf: ready.sourceSyncedAt, rowCount: 44855, pageCount: 449, missingDatasets: ['allocations'] } })
    const wrapper = setup(); await flushPromises()
    expect(wrapper.text()).toContain('已采集 · 只读 · 正式同步待接入')
    expect(wrapper.text()).toContain('采集时点')
    expect(wrapper.text()).not.toContain('初始化完成')
    expect(wrapper.find('[data-testid="initialize-workbench"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="sync-workbench"]').attributes('disabled')).toBeDefined()
    expect(api.post).not.toHaveBeenCalled()
  })
  it('shows a blocked initialization action with the actual setup reason', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...ready, initialized: false, bootstrap: { allowed: true, executable: false, configured: false, blockers: ['workbench_replica_sync_not_configured'] } })
    const wrapper = setup(); await flushPromises()
    expect(wrapper.get('[data-testid="initialize-workbench"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('FOP 同步服务未配置')
    expect(api.post).not.toHaveBeenCalled()
  })

  it('initializes only on administrator action and resumes bounded work with the same request key', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...ready, initialized: false, automaticCallsEnabled: false, bootstrap: { allowed: true, executable: true, configured: true, resume: null } })
    vi.mocked(api.post).mockResolvedValueOnce({ companyId: 'company' }).mockResolvedValueOnce({ state: 'importing' }).mockResolvedValueOnce({ state: 'replaying' }).mockResolvedValueOnce({ state: 'validating' }).mockResolvedValueOnce({ state: 'published' })
    const wrapper = setup(); await flushPromises(); expect(api.post).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="initialize-workbench"]').trigger('click'); await flushPromises()
    const calls = vi.mocked(api.post).mock.calls
    expect(calls[0]?.[0]).toBe('/workbench/replica/bootstrap/configure')
    expect(calls[1]?.[1]).toEqual(calls[2]?.[1])
    expect(calls[1]?.[1]).toMatchObject({ companyId: 'company', requestKey: expect.any(String) })
    expect(wrapper.emitted('synced')).toHaveLength(1)
  })
  it('resumes the persisted key, clears an expired snapshot and starts a new key on the next explicit action', async () => {
    const bootstrap = { allowed: true, executable: true, configured: true, resume: { companyId: 'company', requestKey: 'previous', state: 'importing', errorCode: null } }
    vi.mocked(api.get).mockResolvedValue({ ...ready, initialized: false, bootstrap })
    vi.mocked(api.post).mockResolvedValueOnce({ state: 'failed', errorCode: 'workbench_snapshot_expired' })
    const wrapper = setup(); await flushPromises()
    vi.mocked(api.get).mockResolvedValue({ ...ready, initialized: false, bootstrap: { ...bootstrap, resume: { ...bootstrap.resume, state: 'failed', errorCode: 'workbench_snapshot_expired' } } })
    await wrapper.get('[data-testid="initialize-workbench"]').trigger('click'); await flushPromises()
    expect(api.post).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.post).mock.calls[0]?.[1]).toEqual({ companyId: 'company', requestKey: 'previous' })
    vi.mocked(api.post).mockResolvedValueOnce({ companyId: 'company' }).mockResolvedValueOnce({ state: 'published' })
    await wrapper.get('[data-testid="initialize-workbench"]').trigger('click'); await flushPromises()
    expect(vi.mocked(api.post).mock.calls[1]?.[0]).toBe('/workbench/replica/bootstrap/configure')
    expect(vi.mocked(api.post).mock.calls[2]?.[1]).not.toMatchObject({ requestKey: 'previous' })
  })
  it('never continues initialization after session invalidation', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...ready, initialized: false, bootstrap: { allowed: true, executable: true, configured: true } })
    let finish!: (value: unknown) => void
    vi.mocked(api.post).mockResolvedValueOnce({ companyId: 'company' }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = setup(); await flushPromises(); await wrapper.get('[data-testid="initialize-workbench"]').trigger('click'); await flushPromises()
    invalidateSession(); finish({ state: 'importing' }); await flushPromises()
    expect(api.post).toHaveBeenCalledTimes(2); expect(wrapper.emitted('synced')).toBeUndefined()
  })
  it('shows the source watermark separately and never starts synchronization on mount, focus or timers', async () => {
    vi.useFakeTimers()
    const wrapper = setup(); await flushPromises()
    expect(wrapper.text()).toContain('最近同步')
    expect(wrapper.text()).toContain('08:30')
    expect(wrapper.get('[data-testid="sync-workbench"]').text()).toBe('同步数据')
    await vi.advanceTimersByTimeAsync(300_000)
    window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange')); await flushPromises()
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(api.post).not.toHaveBeenCalled()
  })

  it('explains unavailable initialization and disables source sync while FOP is paused', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...ready, state: 'not_initialized', initialized: false, sourceSyncedAt: null, datasetId: null, revision: null, paused: true })
    const wrapper = setup(); await flushPromises()
    expect(wrapper.text()).toContain('最近同步 —')
    expect(wrapper.text()).not.toContain('本地工作台尚未初始化')
    expect(wrapper.get('[data-testid="sync-workbench"]').attributes('disabled')).toBeDefined()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('keeps an unknown page source watermark unknown even when global status is newer', async () => {
    const wrapper = setup(); await flushPromises()
    await wrapper.setProps({ replica: { readMode: 'local', datasetId: 'd1', revision: 'r0', sourceSyncedAt: null } })
    expect(wrapper.text()).toContain('最近同步 —')
    expect(wrapper.text()).not.toContain('08:30')
  })

  it.each([
    ['failed', '上次同步失败'],
    ['syncing', '后台同步进行中'],
  ])('reports a known %s state without starting background observation', async (state, message) => {
    vi.mocked(api.get).mockResolvedValue({ ...ready, state })
    const wrapper = setup(); await flushPromises()
    expect(wrapper.get('[data-testid="sync-workbench"]').attributes('title')).toContain(message)
    expect(wrapper.text()).not.toContain(message)
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(api.post).not.toHaveBeenCalled()
  })

  it('invalidates counts and emits reload only after the explicitly requested job succeeds', async () => {
    vi.useFakeTimers()
    vi.mocked(api.post).mockResolvedValue({ id: 'job1', state: 'pending' })
    vi.mocked(api.get).mockImplementation(async url => String(url).endsWith('/job1') ? { id: 'job1', state: 'succeeded' } : ready)
    rememberWorkbenchCount({ queue: 'review', page: 1, pageSize: 50 }, 7, captureSession())
    const wrapper = setup(); await flushPromises()
    await wrapper.get('[data-testid="sync-workbench"]').trigger('click'); await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/workbench/replica/sync', { requestKey: expect.any(String) }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(wrapper.emitted('synced')).toBeUndefined()
    const load = vi.fn().mockResolvedValue(9)
    expect(await getWorkbenchCount('review', load)).toBe(7)
    await vi.advanceTimersByTimeAsync(2_000); await flushPromises()
    expect(wrapper.emitted('synced')).toHaveLength(1)
    expect(await getWorkbenchCount('review', load)).toBe(9)
  })

  it('retains the current list and count snapshot when the source job is blocked', async () => {
    vi.useFakeTimers()
    vi.mocked(api.post).mockResolvedValue({ id: 'job1', state: 'blocked', errorCode: 'fop_queries_paused' })
    const wrapper = setup(); await flushPromises()
    await wrapper.get('[data-testid="sync-workbench"]').trigger('click'); await flushPromises()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(wrapper.text()).toContain('同步暂不可用')
    expect(wrapper.emitted('synced')).toBeUndefined()
    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it('discards a completed sync response after switching accounts', async () => {
    let finish!: (value: unknown) => void
    vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = setup(); await flushPromises()
    await wrapper.get('[data-testid="sync-workbench"]').trigger('click')
    invalidateSession(); finish({ id: 'job1', state: 'succeeded' }); await flushPromises()
    expect(wrapper.emitted('synced')).toBeUndefined()
  })

  it('stops observing a long running explicit job without claiming completion', async () => {
    vi.useFakeTimers()
    vi.mocked(api.post).mockResolvedValue({ id: 'job1', state: 'pending' })
    vi.mocked(api.get).mockImplementation(async url => String(url).endsWith('/job1') ? { id: 'job1', state: 'running' } : ready)
    const wrapper = setup(); await flushPromises()
    await wrapper.get('[data-testid="sync-workbench"]').trigger('click'); await flushPromises()
    await vi.advanceTimersByTimeAsync(60_000); await flushPromises()
    const reads = vi.mocked(api.get).mock.calls.length
    await vi.advanceTimersByTimeAsync(300_000); await flushPromises()
    expect(api.get).toHaveBeenCalledTimes(reads)
    expect(wrapper.text()).toContain('后台同步仍在进行')
    expect(wrapper.emitted('synced')).toBeUndefined()
  })
})
