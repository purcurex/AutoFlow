import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FopOrdersView from '@/views/autoflow/FopOrdersView.vue'
import * as orders from '@/api/fop-orders'
import api from '@/api'
import { mockFopOrders } from '@/api/fop-order-fixtures'

vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
const mounted: VueWrapper[] = []

async function setup(query = '?queue=allocation') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/workbench/:role', name: 'RoleWorkbench', component: FopOrdersView },
    { path: '/dashboard', name: 'FopDashboard', component: { template: '<div />' } },
  ] })
  await router.push(`/workbench/allocation${query}`)
  await router.isReady()
  const wrapper = mount(FopOrdersView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  mounted.push(wrapper)
  await vi.dynamicImportSettled()
  await flushPromises()
  return { wrapper, router }
}

vi.mock('@/api/index', () => ({ default: { get: vi.fn(async (_path, { params: query }) => {
  const search = query.search?.toLowerCase() || ''
  const filtered = mockFopOrders.filter(order => orders.matchesFopQueue(order, query.queue) && (!search || order.orderNumber.toLowerCase().includes(search)))
  return { source: 'fop', departments: [{ id: 'd1', name: '业务一部' }, { id: 'd2', name: '业务二部' }], items: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: filtered.length, page: query.page, pageSize: query.pageSize }
}) } }))

describe('fulfillment order list', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  afterEach(() => { mounted.splice(0).forEach(w => { if (w.exists()) w.unmount() }); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard); else Reflect.deleteProperty(navigator, 'clipboard') })

  it('puts products second, keeps multiple items in one order and copies only its order number', async () => {
    const copy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
    const original = mockFopOrders.find(o => orders.matchesFopQueue(o, 'allocation'))!
    vi.spyOn(orders, 'getFopOrders').mockResolvedValueOnce({ source: 'mock', refreshedAt: '2026-10-24T05:30:00Z', departments: [], items: [{ ...original, items: [original.items[0]!, { ...original.items[0]!, sku: 'ANOTHER-SKU', name: 'Second product', quantity: 3 }] }], total: 1, page: 1, pageSize: 10, totals: { orderCount: 1, itemQuantity: 4, amountsByCurrency: [{ currency: 'USD', amount: original.amount }] } })
    const { wrapper } = await setup()
    expect(wrapper.findAll('thead th').slice(0, 2).map(th => th.text())).toEqual(['订单编号', '商品图片 / 商品信息'])
    const row = wrapper.findAll('tbody tr').find(r => r.findAll('.product').length > 1)!
    expect(row.findAll('td')[1]!.findAll('.product').length).toBeGreaterThan(1)
    expect(row.findAll('.sku-item')).toHaveLength(row.findAll('.product').length)
    const number = row.find('.order-cell strong').text()
    await row.get('button.copy-order').trigger('click'); await flushPromises()
    expect(copy).toHaveBeenCalledWith(number)
    expect(wrapper.text()).toContain('订单编号已复制')
    expect(wrapper.text()).toContain('业务处理请在 FOP 完成')
    wrapper.unmount(); vi.unstubAllGlobals()
  })

  it('refreshes without clearing rows or an unsubmitted search, removes advanced orders and recovers the last page', async () => {
    const { wrapper, router } = await setup('?queue=allocation&page=2&departmentId=d1')
    await wrapper.find('input[type=search]').setValue('not submitted')
    let finish!: (value: orders.FopQueuePage) => void
    const spy = vi.spyOn(orders, 'getFopOrders').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const before = wrapper.find('tbody').text()
    await wrapper.get('button.refresh-orders').trigger('click')
    expect(wrapper.find('tbody').text()).toBe(before)
    expect((wrapper.get('input[type=search]').element as HTMLInputElement).value).toBe('not submitted')
    finish({ source: 'mock', items: [], departments: [{ id: 'd1', name: '业务一部' }], total: 1, totals: { orderCount: 1, itemQuantity: 2, amountsByCurrency: [{ currency: 'USD', amount: 10 }] }, page: 2, pageSize: 10, refreshedAt: '2026-10-24T05:30:00Z' })
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ page: '1', departmentId: 'd1' })
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, departmentId: 'd1' }))
    expect((wrapper.get('input[type=search]').element as HTMLInputElement).value).toBe('not submitted')
    wrapper.unmount()
  })

  it('polls every 30 seconds only while visible and online, resumes immediately and stops after unmount', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const spy = vi.spyOn(orders, 'getFopOrders')
    const { wrapper } = await setup()
    const baseline = spy.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000); await flushPromises()
    expect(spy).toHaveBeenCalledTimes(baseline + 1)
    visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(spy).toHaveBeenCalledTimes(baseline + 1)
    visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange')); await flushPromises()
    expect(spy).toHaveBeenCalledTimes(baseline + 2)
    online.mockReturnValue(false); window.dispatchEvent(new Event('offline'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(spy).toHaveBeenCalledTimes(baseline + 2)
    expect(wrapper.text()).toContain('网络已断开')
    online.mockReturnValue(true); window.dispatchEvent(new Event('online')); await flushPromises()
    expect(spy).toHaveBeenCalledTimes(baseline + 3)
    wrapper.unmount(); window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(spy).toHaveBeenCalledTimes(baseline + 3)
  })

  it('coalesces focus and timer refreshes while a request is pending', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const { wrapper } = await setup()
    let reject!: (reason: unknown) => void
    const spy = vi.spyOn(orders, 'getFopOrders').mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    window.dispatchEvent(new Event('focus')); await flushPromises()
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(spy).toHaveBeenCalledTimes(1)
    reject({ code: 'fop_permission_denied' }); await flushPromises()
    expect(wrapper.find('tbody').exists()).toBe(false)
    expect(wrapper.get('[role=alert]').text()).toContain('刷新未成功')
    wrapper.unmount()
  })

  it('sends the department filter to the API, resets pagination and preserves search and browser history', async () => {
    const { wrapper, router } = await setup('?queue=allocation&page=2&pageSize=10&search=DEMO')
    const select = () => wrapper.get('select[aria-label="所属部门"]')
    expect(select().findAll('option').map(o => o.text())).toEqual(['全部部门', '业务一部', '业务二部'])
    await select().setValue('d2'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ departmentId: 'd2', page: '1', search: 'DEMO' })
    expect(api.get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders', { params: expect.objectContaining({ departmentId: 'd2', page: 1, search: 'DEMO' }) })
    await wrapper.find('input[type=search]').setValue('another')
    await wrapper.find('form').trigger('submit'); await flushPromises()
    expect(router.currentRoute.value.query.departmentId).toBe('d2')
    expect(wrapper.get('th[aria-sort="ascending"]').text()).toContain('收款日期')
    await router.push('/workbench/allocation?queue=allocation&departmentId=d1&page=2'); await flushPromises()
    expect((select().element as HTMLSelectElement).value).toBe('d1')
    await select().setValue(''); await flushPromises()
    expect(router.currentRoute.value.query.departmentId).toBeUndefined()
    expect(router.currentRoute.value.query.page).toBe('1')
    wrapper.unmount()
  })

  it('keeps an unavailable department selected rather than silently querying all departments', async () => {
    const { wrapper, router } = await setup('?queue=allocation&departmentId=unknown')
    expect((wrapper.get('select[aria-label="所属部门"]').element as HTMLSelectElement).value).toBe('unknown')
    expect(router.currentRoute.value.query.departmentId).toBe('unknown')
    expect(api.get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders', { params: expect.objectContaining({ departmentId: 'unknown' }) })
    wrapper.unmount()
  })

  it('shows server totals for all pages, separates currencies and keeps zero totals visible', async () => {
    const spy = vi.spyOn(orders, 'getFopOrders').mockResolvedValueOnce({
      refreshedAt: '2026-10-24T05:30:00Z', source: 'mock', total: 123, page: 1, pageSize: 10, departments: [],
      items: mockFopOrders.filter(o => orders.matchesFopQueue(o, 'allocation')).slice(0, 1),
      totals: { orderCount: 123, itemQuantity: 456, amountsByCurrency: [{ currency: 'USD', amount: 100.2 }, { currency: 'EUR', amount: 9.8 }] },
    })
    const { wrapper, router } = await setup()
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tfoot th').text()).toContain('123 笔订单')
    expect(wrapper.find('tfoot .quantity-total').text()).toBe('456')
    expect(wrapper.findAll('.order-currency-total').map(cell => cell.text())).toEqual(['$100.20', '€9.80'])
    spy.mockResolvedValueOnce({ refreshedAt: '2026-10-24T05:30:00Z', source: 'mock', total: 0, page: 1, pageSize: 10, items: [], departments: [], totals: { orderCount: 0, itemQuantity: 0, amountsByCurrency: [] } })
    await router.push('/workbench/allocation?queue=allocation&search=empty'); await flushPromises()
    expect(wrapper.find('tfoot').text()).toContain('0 笔订单')
    expect(wrapper.find('tfoot').text()).toContain('$0.00')
    wrapper.unmount(); spy.mockRestore()
  })
  it('shows the required fields and only the selected business status, retaining its queue while searching', async () => {
    const { wrapper, router } = await setup()
    expect(wrapper.find('h2').text()).toContain('待配货')
    const headers = wrapper.find('thead').text()
    for (const label of ['订单编号', 'Shopify 单号', '客户名称', '商品', '支付状态', '配货状态']) expect(headers).toContain(label)
    for (const label of ['审核状态', '发运状态', '发货状态']) expect(headers).not.toContain(label)
    expect(wrapper.findAll('tbody tr')).toHaveLength(10)
    expect(wrapper.findAll('tbody img').length).toBeGreaterThan(0)
    expect(wrapper.find('tbody').text()).toContain('库存未齐套')
    expect(wrapper.find('tbody').text()).toContain('已齐套 · 待审核')
    await wrapper.find('input[type=search]').setValue('DEMO-SO-10241')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.query.queue).toBe('allocation')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('DEMO-SO-10241')
    await router.push('/workbench/dispatch?queue=dispatch')
    await flushPromises()
    expect(wrapper.find('thead').text()).toContain('Shopify 履约状态')
    expect(wrapper.find('thead').text()).not.toContain('配货状态')
    expect(wrapper.find('tbody').text()).not.toContain('DEMO-SO-10241')
    wrapper.unmount()
  })

  it('shows an empty state and rejects unsupported queue links', async () => {
    const { wrapper, router } = await setup('?queue=allocation&search=no-such-order')
    expect(wrapper.text()).toContain('暂无符合条件的订单')
    await router.push('/workbench/allocation?queue=unknown')
    await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('无效的清单类型')
    expect(wrapper.find('tbody').exists()).toBe(false)
    wrapper.unmount()
  })

  it('removes prior records when refreshed permissions reject access', async () => {
    const { wrapper } = await setup()
    expect(wrapper.find('tbody').exists()).toBe(true)
    const spy = vi.spyOn(orders, 'getFopOrders').mockRejectedValueOnce({ code: 'fop_binding_required' })
    await wrapper.find('button.action-button').trigger('click')
    await flushPromises()
    expect(wrapper.find('tbody').exists()).toBe(false)
    expect(wrapper.find('[role=alert]').text()).toContain('业务数据暂不可查看')
    wrapper.unmount()
    spy.mockRestore()
  })

  it('discards a slow previous queue response after navigation', async () => {
    const real = orders.getFopOrders
    let resolve!: (value: orders.FopQueuePage) => void
    const spy = vi.spyOn(orders, 'getFopOrders').mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const { wrapper, router } = await setup()
    await router.push('/workbench/dispatch?queue=dispatch')
    await flushPromises()
    resolve(await real({ queue: 'allocation', page: 1, pageSize: 10 }))
    await flushPromises()
    expect(wrapper.find('h2').text()).toContain('待履约')
    expect(wrapper.find('tbody').text()).not.toContain('DEMO-SO-10241')
    wrapper.unmount()
    spy.mockRestore()
  })
})
