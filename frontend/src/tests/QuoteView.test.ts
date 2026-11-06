import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { i18n } from '@/i18n'
import QuoteView from '@/views/autoflow/QuoteView.vue'
const mocks = vi.hoisted(() => ({ capabilities: vi.fn(), search: vi.fn() }))
vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
vi.mock('@/api/fop', () => ({ fopApi: { getCapabilities: mocks.capabilities, searchActualLogisticsChannels: mocks.search, getCustomLogisticsChannels: vi.fn(async () => ({ channels: [] })) } }))
const channel = (code: string, name: string, group = 'economy') => ({ customChannelCode: group, customChannelName: group, code, name, carrierCode: 'YT', carrierName: '云途', enabled: true })
const result = (channels = [channel('YT-001','云途标准'), channel('EX-002','极速专线','express')], total = channels.length, page = 1) => ({ provider: 'fop', source: 'fop', channels, total, page, pageSize: 24, sourceVersion: 'catalog-v1', effectiveAt: '2026-11-02T00:00:00Z', warnings: [] })
let wrapper: VueWrapper
beforeEach(() => { vi.resetAllMocks(); mocks.capabilities.mockResolvedValue({ logisticsCatalog: { available: true }, productCost: { available: false }, logisticsRate: { available: false } }); mocks.search.mockResolvedValue(result()) })
afterEach(() => { wrapper?.unmount() })
async function setup() {
 const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/quotes', component: QuoteView }] }); await router.push('/quotes')
 wrapper = mount(QuoteView, { global: { plugins: [router, i18n] } }); await flushPromises()
 return wrapper
}
it('searches actual channels from the API and retains selections across searches and pages', async () => {
 mocks.search.mockResolvedValueOnce(result(undefined,25)).mockResolvedValueOnce(result([channel('EX-002','极速专线','express')],25,2)).mockResolvedValueOnce(result([channel('YT-001','云途标准')]))
 const w = await setup()
 expect(w.find('select[aria-label="自定义物流渠道"]').exists()).toBe(false)
 expect(w.get('[data-testid="actual-channel-search"]').text()).toContain('实际物流渠道')
 await w.get('input[aria-label="选择实际物流渠道 YT-001"]').setValue(true)
 await w.get('input[aria-label="物流毛利率 YT-001"]').setValue(33)
 await w.get('[aria-label="下一页物流渠道"]').trigger('click'); await flushPromises()
 expect(mocks.search).toHaveBeenLastCalledWith({ page:2, pageSize:24 }, expect.anything())
 await w.get('input[aria-label="搜索实际物流渠道"]').setValue(' YT-001 ')
 await w.get('[data-testid="actual-channel-search"]').trigger('submit'); await flushPromises()
 expect(mocks.search).toHaveBeenLastCalledWith({ search:'YT-001', page:1, pageSize:24 }, expect.anything())
 expect((w.get('input[aria-label="选择实际物流渠道 YT-001"]').element as HTMLInputElement).checked).toBe(true)
 expect(w.get('[data-testid="selected-logistics-channels"]').text()).toContain('云途标准')
 expect((w.get('input[aria-label="物流毛利率 YT-001"]').element as HTMLInputElement).value).toBe('33')
 expect(w.get('[data-testid="selected-logistics-channels"]').text()).not.toContain('economy')
})
it('keeps the latest search when an older API response finishes later', async () => {
 const w = await setup(); let resolve!: (data: ReturnType<typeof result>) => void
 mocks.search.mockImplementationOnce(()=>new Promise(r=>{resolve=r})).mockResolvedValueOnce(result([channel('NEW','最新渠道')]))
 await w.get('input[aria-label="搜索实际物流渠道"]').setValue('old'); await w.get('[data-testid="actual-channel-search"]').trigger('submit'); await flushPromises()
 await w.get('input[aria-label="搜索实际物流渠道"]').setValue('new'); await w.get('[data-testid="actual-channel-search"]').trigger('submit'); await flushPromises()
 resolve(result([channel('OLD','过期渠道')])); await flushPromises()
 expect(w.find('input[aria-label="选择实际物流渠道 NEW"]').exists()).toBe(true)
 expect(w.find('input[aria-label="选择实际物流渠道 OLD"]').exists()).toBe(false)
})
it('does not invent catalog choices when the FOP capability is unavailable', async () => {
 mocks.capabilities.mockResolvedValue({ logisticsCatalog:{available:false},productCost:{available:false},logisticsRate:{available:false} })
 const w=await setup(); expect(mocks.search).not.toHaveBeenCalled()
 expect(w.get('[data-testid="actual-channel-search"]').text()).toContain('实际物流渠道')
 expect(w.text()).toContain('渠道清单待接入')
 expect(w.find('input[aria-label^="选择实际物流渠道 "]').exists()).toBe(false)
})
