vi.mock('@/api/fop-chart-access', async importOriginal => { const { chartAccessFixture } = await import('./chart-access-fixtures'); return { ...await importOriginal<object>(), getChartAccess: vi.fn(async () => chartAccessFixture()) } })
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkbenchView from '@/views/autoflow/WorkbenchView.vue'
import { invalidateSession } from '@/utils/session'
import { freightPage } from './freight-fixtures'
const get = vi.hoisted(() => vi.fn())
vi.mock('@/api/index', () => ({ default: { get } }))
vi.mock('@/composables/useWorkbenchAccess', async () => { const { ref } = await import('vue'); return { useWorkbenchAccess: () => ({ roles: ref(['dispatch']) }) } })
vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
vi.mock('@/components/FopDataAccessNotice.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/views/autoflow/DashboardView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/views/autoflow/FopOrdersView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/order-volume/OrderVolumeAnalysis.vue', () => ({ default: { template: '<div />' } }))
enableAutoUnmount(afterEach)
async function setup(query = 'grain=month&year=2026&warehouse=HZ&carrierCode=YT&periodId=2026-10') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/:role/freight', name: 'RoleWorkbenchFreight', component: WorkbenchView }, { path: '/workbench/:role', name: 'RoleWorkbench', component: { template: '<div />' } }, { path: '/dashboard', component: { template: '<div />' } }] })
  await router.push(`/workbench/dispatch/freight?${query}`)
  const wrapper = mount(WorkbenchView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  await flushPromises(); return { wrapper, router }
}
describe('actual freight workbench details', () => {
  beforeEach(() => get.mockReset().mockResolvedValue(structuredClone(freightPage)))
  it('shows delivery identities, actual confirmation dates, exchange-rate provenance and whole-filter totals', async () => {
    const { wrapper } = await setup()
    expect(wrapper.text()).toContain('实际运费明细')
    expect(wrapper.text()).toContain('DEL-001')
    expect(wrapper.text()).toContain('ORDER-001')
    expect(wrapper.text()).toContain('TRACK-001')
    expect(wrapper.text()).toContain('2026/10/1')
    expect(wrapper.text()).toContain('FOP daily USD rate')
    expect(wrapper.find('tfoot').text()).toContain('$600.00')
    expect(wrapper.find('tfoot').text()).toContain('CNY 1,400.00')
    expect(wrapper.find('tfoot').text()).toContain('USD 400.00')
    expect(get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/freight/details', { params: { grain: 'month', year: 2026, warehouse: 'HZ', carrierCode: 'YT', periodId: '2026-10', comparisonPeriod: 'current', workbenchRole: 'dispatch', page: 1, pageSize: 20 } })
  })
  it('preserves comparison and week scope during pagination, and resets page when changing carrier', async () => {
    const { wrapper, router } = await setup('grain=week&year=2026&weekOf=2026-10-22&warehouse=SZ&carrierCode=YT&periodId=2026-10-19&comparisonPeriod=previous')
    await wrapper.findAll('button').find(button => button.text() === '下一页')!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ weekOf: '2026-10-22', warehouse: 'SZ', carrierCode: 'YT', periodId: '2026-10-19', comparisonPeriod: 'previous', page: '2' })
    await wrapper.find('select[aria-label="运费明细服务商"]').setValue('4PX'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ carrierCode: '4PX', comparisonPeriod: 'previous', page: '1' })
  })
  it('preserves the actual carrier identity when the carrier belongs to Other and has a generic channel', async () => {
    const sample = structuredClone(freightPage)
    sample.items[0] = { ...sample.items[0]!, carrierCode: 'OTHER', carrierName: '顺友物流', channelName: '标准小包' }
    get.mockResolvedValueOnce(sample)
    const { wrapper } = await setup('grain=month&year=2026&warehouse=ALL&carrierCode=OTHER')
    const carrierCell = wrapper.find('tbody tr').findAll('td')[2]!
    expect(carrierCell.text()).toContain('顺友物流')
    expect(carrierCell.text()).toContain('其他')
    expect(carrierCell.text()).toContain('标准小包')
  })
  it('removes sensitive cost data on denied refresh and on session changes', async () => {
    const { wrapper } = await setup()
    get.mockRejectedValueOnce({ code: 'fop_permission_denied' })
    await wrapper.findAll('button').find(button => button.text() === '刷新')!.trigger('click'); await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('无法查看这些数据')
    expect(wrapper.find('tfoot').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('DEL-001')
    let resolve!: (value: typeof freightPage) => void
    get.mockReturnValueOnce(new Promise(r => { resolve = r }))
    await wrapper.findAll('button').find(button => button.text() === '刷新')!.trigger('click')
    invalidateSession(); resolve(freightPage); await flushPromises()
    expect(wrapper.text()).not.toContain('DEL-001')
  })
})
