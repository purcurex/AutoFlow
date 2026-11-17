// Cache policy is covered separately; these fixtures exercise chart interactions.
vi.mock('@/api/analytics-cache-scope', () => ({ getAnalyticsCacheScope: vi.fn(async () => ({ cacheable: false })) }))
vi.mock('@/api/fop-chart-access', async importOriginal => { const { chartAccessFixture } = await import('./chart-access-fixtures'); return { ...await importOriginal<object>(), getChartAccess: vi.fn(async () => chartAccessFixture()) } })
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import FreightAnalysis from '@/components/freight/FreightAnalysis.vue'
import { freightData } from './freight-fixtures'
import { chartAccessFixture } from './chart-access-fixtures'
import { getChartAccess } from '@/api/fop-chart-access'
import { invalidateSession } from '@/utils/session'
const { get, access } = vi.hoisted(() => ({ get: vi.fn(), access: vi.fn() }))
vi.mock('@/api/index', () => ({ default: { get } }))
vi.mock('@/composables/useWorkbenchAccess', () => ({ refreshWorkbenchAccess: access }))
vi.mock('@/components/charts/EChart.vue', () => ({ default: { name: 'EChart', props: ['option', 'label'], template: '<div class="chart-stub" />' } }))
enableAutoUnmount(afterEach)
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
})
afterAll(() => { Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close') })
async function setup(mock = false) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/workbench/:role/freight', name: 'RoleWorkbenchFreight', component: { template: '<div />' } }] })
  await router.push('/')
  const wrapper = mount(FreightAnalysis, { props: mock ? { mock: true, mockAccess: chartAccessFixture().charts.find(chart => chart.chartId === 'freight')! } : {}, attachTo: document.body, global: { stubs: { teleport: false }, plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  await flushPromises(); return { wrapper, router }
}
describe('freight analysis', () => {
  beforeEach(() => {
    get.mockReset().mockImplementation(async (_url, { params }) => freightData(params))
    access.mockReset().mockResolvedValue({ roles: ['allocation', 'dispatch'], isAdmin: false })
  })
  it('isolates mock queries, filters and trends from live freight and document routes', async () => {
    vi.mocked(getChartAccess).mockClear()
    const { wrapper, router } = await setup(true)
    expect(wrapper.get('[data-source="mock"]').text()).toContain('Mock')
    expect(wrapper.text()).toContain('模拟运费合计')
    expect(wrapper.text()).not.toContain('查看发运单明细')
    const initial = wrapper.get('.ov-kpis strong').text()
    await wrapper.get('select[aria-label="运费仓库"]').setValue('HZ'); await flushPromises()
    expect(wrapper.get('.ov-kpis strong').text()).not.toBe(initial)
    await wrapper.get('select[aria-label="运费时间轴"]').setValue('week'); await flushPromises()
    await wrapper.get('input[aria-label="运费上期环比"]').setValue(true)
    await wrapper.get('button[data-freight-trend="YT"]').trigger('click'); await flushPromises()
    expect(document.querySelector('dialog[open] .chart-stub')).not.toBeNull()
    expect(wrapper.findAll('[data-freight-detail]').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    expect(router.currentRoute.value.path).toBe('/')
    expect(get).not.toHaveBeenCalled()
    expect(getChartAccess).not.toHaveBeenCalled()
    expect(access).not.toHaveBeenCalled()
    await wrapper.setProps({ mockAccess: { ...chartAccessFixture().charts.find(chart => chart.chartId === 'freight')!, visible: false } }); await flushPromises()
    expect(wrapper.find('[data-module="freight"]').exists()).toBe(false)
    expect(document.querySelector('dialog')).toBeNull()
  })
  it('opens the descending statistics table for comparisons and keeps it open when disabled', async () => {
    const { wrapper } = await setup()
    expect(wrapper.find('.ov-filters select').attributes('aria-label')).toBe('运费年份')
    expect(wrapper.find('details').attributes('open')).toBeUndefined()
    await wrapper.find('input[aria-label="运费上期环比"]').setValue(true)
    expect(wrapper.find('details').attributes('open')).toBeDefined()
    expect(wrapper.find('tbody tr').text()).toContain('10月')
    expect(wrapper.find('tfoot').text()).toContain('+$30.00')
    expect(wrapper.text()).toContain('完整上期')
    await wrapper.find('input[aria-label="运费上期环比"]').setValue(false)
    expect(wrapper.find('details').attributes('open')).toBeDefined()
    expect(get).toHaveBeenCalledTimes(1)
  })
  it('routes a carrier amount to an available dispatch workbench with applied filters', async () => {
    const { wrapper, router } = await setup()
    await wrapper.find('select[aria-label="运费仓库"]').setValue('HZ'); await flushPromises()
    await wrapper.find('button[data-freight-detail="YT"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.name).toBe('RoleWorkbenchFreight')
    expect(router.currentRoute.value.params.role).toBe('dispatch')
    expect(router.currentRoute.value.query).toMatchObject({ warehouse: 'HZ', carrierCode: 'YT', comparisonPeriod: 'current', page: '1' })
  })
  it('opens a carrier trend in a centered modal and clears it when the scope changes', async () => {
    const { wrapper } = await setup()
    await wrapper.find('button[data-freight-trend="YT"]').trigger('click'); await flushPromises()
    expect(document.querySelector('dialog[open]')?.textContent).toContain('云途YT')
    expect(!!document.querySelector('dialog[open] .chart-stub')).toBe(true)
    await wrapper.find('select[aria-label="运费仓库"]').setValue('SZ'); await flushPromises()
    expect(!!document.querySelector('dialog')).toBe(false)
  })
  it('discards superseded responses and removes costs after a denied query', async () => {
    const { wrapper } = await setup()
    let resolve!: (value: ReturnType<typeof freightData>) => void
    get.mockReturnValueOnce(new Promise(r => { resolve = r }))
    await wrapper.find('select[aria-label="运费仓库"]').setValue('HZ')
    get.mockRejectedValueOnce({ code: 'fop_permission_denied' })
    await wrapper.find('select[aria-label="运费仓库"]').setValue('SZ'); await flushPromises()
    resolve(freightData()); await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('无法查看这些数据')
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('$60.00')
  })
  it('clears pending costs and the modal on a session change', async () => {
    const { wrapper } = await setup()
    await wrapper.find('button[data-freight-trend="YT"]').trigger('click')
    invalidateSession(); await flushPromises()
    expect(!!document.querySelector('dialog')).toBe(false)
    expect(wrapper.find('table').exists()).toBe(false)
  })
  it('keeps the weekly anchor within the selected year and removes it for monthly requests', async () => {
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2027-11-17T00:00:00Z'))
    const { wrapper } = await setup()
    const timeline = wrapper.get('select[aria-label="运费时间轴"]')
    expect((timeline.element as HTMLSelectElement).value).toBe('week')
    expect(timeline.findAll('option').map(option => option.text())).toEqual(['按周', '按月', '按年'])
    expect(get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/freight', { params: expect.objectContaining({ grain: 'week', weekOf: expect.any(String) }), timeout: 180000 })
    expect(wrapper.find('select[aria-label="运费年份"]').findAll('option').map(o=>o.text())).toEqual(['2027','2026'])
    await wrapper.find('select[aria-label="运费年份"]').setValue('2026')
    await wrapper.find('select[aria-label="运费时间轴"]').setValue('week'); await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/freight', { params: { grain: 'week', year: 2026, weekOf: '2026-12-31', warehouse: 'ALL' }, timeout: 180000 })
    await wrapper.find('select[aria-label="运费时间轴"]').setValue('month'); await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/freight', { params: { grain: 'month', year: 2026, warehouse: 'ALL' }, timeout: 180000 })
    vi.useRealTimers()
  })
  it('drills the full previous period into the available role when dispatch is unavailable', async () => {
    access.mockResolvedValueOnce({ roles: ['allocation'], isAdmin: false })
    const { wrapper, router } = await setup()
    await wrapper.find('input[aria-label="运费上期环比"]').setValue(true)
    await wrapper.find('.freight-previous').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.params.role).toBe('allocation')
    expect(router.currentRoute.value.query).toMatchObject({ periodId: '2026-10', comparisonPeriod: 'previous' })
  })
  it('does not navigate with a role response from a previous session', async () => {
    const { wrapper, router } = await setup()
    let resolve!: (value: { roles: string[] }) => void
    access.mockReturnValueOnce(new Promise(r => { resolve = r }))
    await wrapper.find('button[data-freight-detail="YT"]').trigger('click')
    invalidateSession(); resolve({ roles: ['dispatch'] }); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.find('table').exists()).toBe(false)
  })
})
