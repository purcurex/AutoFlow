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

async function setup(query = '?queue=allocation', role = 'allocation') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/workbench/:role', name: 'RoleWorkbench', component: FopOrdersView },
    { path: '/dashboard', name: 'FopDashboard', component: { template: '<div />' } },
  ] })
  await router.push(`/workbench/${role}${query}`)
  await router.isReady()
  const wrapper = mount(FopOrdersView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  mounted.push(wrapper)
  await vi.dynamicImportSettled()
  await flushPromises()
  return { wrapper, router }
}

vi.mock('@/api/index', () => ({ default: { get: vi.fn(async (_path, { params: query }) => {
  const search = query.search?.toLowerCase() || ''
  const filtered = mockFopOrders.filter(order => orders.matchesFopQueue(order, query.queue, query.warehouseStage) && (!search || order.orderNumber.toLowerCase().includes(search)))
  return { source: 'fop', departments: [{ id: 'd1', name: '业务一部' }, { id: 'd2', name: '业务二部' }], items: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: filtered.length, page: query.page, pageSize: query.pageSize }
}) } }))

describe('fulfillment order list', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  afterEach(() => { mounted.splice(0).forEach(w => { if (w.exists()) w.unmount() }); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard); else Reflect.deleteProperty(navigator, 'clipboard') })

  it('selects one or all visible approval orders, preserves product column, and clears selection on navigation', async () => {
    const { wrapper, router } = await setup('?queue=review', 'sales')
    expect(wrapper.findAll('thead th')[1]!.text()).toBe('商品图片 / 商品信息')
    const rows = wrapper.findAll('tbody input.order-checkbox')
    expect(rows.length).toBeGreaterThan(0)
    await rows[0]!.setValue(true)
    expect(wrapper.get('[data-testid="open-approval"]').text()).toContain('1')
    await wrapper.get('thead input.order-checkbox').setValue(true)
    expect(wrapper.get('[data-testid="open-approval"]').text()).toContain(String(rows.length))
    await router.push('/workbench/sales?queue=review&pageSize=20'); await flushPromises()
    expect(wrapper.get('[data-testid="open-approval"]').attributes('disabled')).toBeDefined()
    await router.push('/workbench/allocation?queue=allocation_review'); await flushPromises()
    expect(wrapper.find('[data-testid="open-approval"]').exists()).toBe(true)
    await router.push('/workbench/allocation?queue=allocation'); await flushPromises()
    expect(wrapper.find('[data-testid="open-approval"]').exists()).toBe(false)
  })

  it('offers supplier follow-up only for paid purchases awaiting shipment without changing table totals alignment', async () => {
    const { wrapper, router } = await setup('?queue=procurement_shipping', 'procurement')
    const headerCount = wrapper.findAll('thead th').length
    const row = wrapper.find('tbody tr')
    expect(row.find('button.follow-up-order').exists()).toBe(true)
    expect(row.findAll('td')).toHaveLength(headerCount)
    const footerColumns = wrapper.findAll('tfoot tr').at(-1)!.findAll('th,td').reduce((sum, cell) => sum + Number(cell.attributes('colspan') || 1), 0)
    expect(footerColumns).toBe(headerCount)
    await router.push('/workbench/procurement?queue=procurement'); await flushPromises()
    expect(wrapper.find('button.follow-up-order').exists()).toBe(false)
  })

  it('changes page sizes from 20 to 100, resets the page, preserves filters and selects every visible order', async () => {
    const original = mockFopOrders.find(order => orders.matchesFopQueue(order, 'review'))!
    const items = Array.from({ length: 121 }, (_, i) => ({ ...original, id: `page-${i}`, orderNumber: `PAGE-${i}` }))
    vi.spyOn(orders, 'getFopOrders').mockImplementation(async query => ({ source: 'mock', refreshedAt: '2026-10-24T05:30:00Z', departments: [{ id: 'd1', name: '业务一部' }], items: items.slice((query.page! - 1) * query.pageSize!, query.page! * query.pageSize!), total: 121, page: query.page!, pageSize: query.pageSize!, totals: { orderCount: 121, itemQuantity: 121, amountsByCurrency: [{ currency: 'USD', amount: 121 }] } }))
    const { wrapper, router } = await setup('?queue=review&departmentId=d1&search=PAGE', 'sales')
    const select = () => wrapper.get('select[aria-label="每页条数"]')
    expect(wrapper.findAll('tbody tr')).toHaveLength(50)
    expect(select().findAll('option').map(option => option.text())).toEqual(['20', '50', '100'])
    await select().setValue('20'); await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(20)
    await wrapper.get('button[aria-label="下一页"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.page).toBe('2')
    await select().setValue('100'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ queue: 'review', departmentId: 'd1', search: 'PAGE', page: '1', pageSize: '100' })
    expect(wrapper.findAll('tbody tr')).toHaveLength(100)
    await wrapper.get('thead input.order-checkbox').setValue(true)
    expect(wrapper.findAll('tbody input.order-checkbox').every(input => (input.element as HTMLInputElement).checked)).toBe(true)
    await wrapper.get('button[aria-label="下一页"]').trigger('click'); await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(21)
    expect(wrapper.get('[data-testid="open-approval"]').attributes('disabled')).toBeDefined()
  })

  it('shows purchase stages instead of customer payment in procurement, and keeps payment in sales', async () => {
    const { wrapper, router } = await setup('?queue=procurement', 'procurement')
    const headers = () => wrapper.findAll('thead th').map(th => th.text())
    expect(headers()).toContain('采购订单状态')
    expect(headers()).not.toContain('支付状态')
    expect(headers()).toContain('供应商发货状态')
    for (const label of ['待下采购单', '部分下单', '待付采购款', '采购款部分支付', '采购退款待跟进']) expect(wrapper.text()).toContain(label)
    await router.push('/workbench/procurement?queue=procurement_shipping'); await flushPromises()
    expect(wrapper.find('tbody').text()).toContain('供应商待发货')
    expect(wrapper.find('tbody').text()).toContain('供应商部分发货')
    await router.push('/workbench/sales?queue=review'); await flushPromises()
    expect(headers()).toContain('支付状态')
    expect(headers()).not.toContain('采购订单状态')
  })

  it('shows each dispatch document status independently of payment and Shopify synchronization', async () => {
    const original = mockFopOrders.find(o => orders.matchesFopQueue(o, 'dispatch'))!
    const items = [
      { ...original, id: 'mixed', dispatchDocuments: [
        { id: 'd1', number: 'FY-001', status: 'draft' as const },
        { id: 'd2', number: 'FY-002', status: 'submitted' as const },
        { id: 'd3', number: 'FY-003', status: 'approved' as const },
      ] },
      { ...original, id: 'none', dispatchDocuments: [] },
      { ...original, id: 'unknown', dispatchDocuments: undefined },
    ]
    vi.spyOn(orders, 'getFopOrders').mockResolvedValueOnce({ source: 'mock', refreshedAt: '2026-10-24T05:30:00Z', departments: [], items, total: 3, page: 1, pageSize: 10, totals: { orderCount: 3, itemQuantity: 3, amountsByCurrency: [{ currency: 'USD', amount: original.amount * 3 }] } })
    const { wrapper, router } = await setup('?queue=dispatch', 'dispatch')
    const headers = () => wrapper.findAll('thead th').map(th => th.text())
    expect(headers()).toContain('发运单状态')
    expect(headers()).not.toContain('支付状态')
    expect(headers()).toContain('Shopify 履约状态')
    const rows = wrapper.findAll('tbody tr')
    const statusCell = rows[0]!.findAll('td')[headers().indexOf('发运单状态')]!
    for (const label of ['暂存', '已提交', '已审核', 'FY-001', 'FY-002', 'FY-003']) expect(statusCell.text()).toContain(label)
    expect(rows[0]!.text()).toContain('待同步 Shopify 发货')
    expect(rows[1]!.text()).toContain('未生成发运单')
    expect(rows[2]!.text()).toContain('待确认')
    expect(rows[0]!.findAll('td')).toHaveLength(headers().length)
    await router.push('/workbench/sales?queue=review'); await flushPromises()
    expect(headers()).toContain('支付状态')
    expect(headers()).not.toContain('发运单状态')
  })

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
    await row.get('button.copy-customer').trigger('click'); await flushPromises()
    expect(copy).toHaveBeenLastCalledWith(original.customerName)
    expect(wrapper.text()).toContain('客户名称已复制')
    expect(wrapper.text()).toContain('业务处理请在 FOP 完成')
    wrapper.unmount(); vi.unstubAllGlobals()
  })

  it('refreshes without clearing rows or an unsubmitted search, removes advanced orders and recovers the last page', async () => {
    const original = mockFopOrders.find(order => orders.matchesFopQueue(order, 'allocation'))!
    vi.spyOn(orders, 'getFopOrders').mockResolvedValueOnce({ source: 'mock', refreshedAt: '2026-10-24T05:30:00Z', departments: [{ id: 'd1', name: '业务一部' }], items: [original], total: 21, page: 2, pageSize: 20, totals: { orderCount: 21, itemQuantity: 21, amountsByCurrency: [{ currency: 'USD', amount: 210 }] } })
    const { wrapper, router } = await setup('?queue=allocation&page=2&pageSize=20&departmentId=d1')
    await wrapper.find('input[type=search]').setValue('not submitted')
    let finish!: (value: orders.FopQueuePage) => void
    const spy = vi.spyOn(orders, 'getFopOrders').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const before = wrapper.find('tbody').text()
    await wrapper.get('button.refresh-orders').trigger('click')
    expect(wrapper.find('tbody').text()).toBe(before)
    expect((wrapper.get('input[type=search]').element as HTMLInputElement).value).toBe('not submitted')
    finish({ source: 'mock', items: [], departments: [{ id: 'd1', name: '业务一部' }], total: 1, totals: { orderCount: 1, itemQuantity: 2, amountsByCurrency: [{ currency: 'USD', amount: 10 }] }, page: 2, pageSize: 20, refreshedAt: '2026-10-24T05:30:00Z' })
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
    const { wrapper, router } = await setup('?queue=allocation&page=2&pageSize=20&search=DEMO')
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

  it('toggles payment sorting before pagination and preserves it on refresh and filtering', async () => {
    const { wrapper, router } = await setup('?queue=allocation&page=2&pageSize=20&departmentId=d1&search=DEMO')
    expect(wrapper.get('th[aria-sort]').attributes('aria-sort')).toBe('ascending')
    await wrapper.get('button.sort-payment').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ paidAtOrder: 'desc', page: '1', departmentId: 'd1', search: 'DEMO' })
    expect(wrapper.get('th[aria-sort]').attributes('aria-sort')).toBe('descending')
    expect(api.get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders', { params: expect.objectContaining({ paidAtOrder: 'desc', page: 1 }) })
    await wrapper.get('button.refresh-orders').trigger('click'); await flushPromises()
    expect(api.get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders', { params: expect.objectContaining({ paidAtOrder: 'desc' }) })
    await wrapper.get('select[aria-label="所属部门"]').setValue('d2'); await flushPromises()
    expect(router.currentRoute.value.query.paidAtOrder).toBe('desc')
    await wrapper.get('button.sort-payment').trigger('click'); await flushPromises()
    expect(wrapper.get('th[aria-sort]').attributes('aria-sort')).toBe('ascending')
    expect(api.get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders', { params: expect.objectContaining({ paidAtOrder: 'asc' }) })
    await router.push('/workbench/allocation?queue=allocation&paidAtOrder=invalid'); await flushPromises()
    expect(wrapper.find('tbody').exists()).toBe(false)
    expect(wrapper.get('[role=alert]').text()).toContain('排序')
  })

  it.each([
    ['allocation', 'allocation', '发运单状态', 'dispatchDocumentStatus'],
    ['allocation', 'allocation_review', '发运单状态', 'dispatchDocumentStatus'],
    ['allocation', 'allocation_review', '配货单状态', 'allocationDocumentStatus'],
    ['dispatch', 'dispatch', '发运单状态', 'dispatchDocumentStatus'],
    ['warehouse', 'shipping', '配货单状态', 'allocationDocumentStatus'],
    ['warehouse', 'shipping', '出库状态', 'outboundStatus'],
  ])('sorts %s/%s %s and retains filters across refresh', async (role, queue, label, field) => {
    const { wrapper, router } = await setup(`?queue=${queue}&departmentId=d1&search=DEMO`, role)
    const button = () => wrapper.get(`button[aria-label^="${label}："]`)
    await button().trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ sortBy: field, sortOrder: 'asc', page: '1', departmentId: 'd1', search: 'DEMO' })
    expect(button().element.closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    expect(wrapper.get('button.sort-payment').element.closest('th')?.getAttribute('aria-sort')).toBe('none')
    await button().trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.sortOrder).toBe('desc')
    expect(button().element.closest('th')?.getAttribute('aria-sort')).toBe('descending')
    await wrapper.get('button.refresh-orders').trigger('click'); await flushPromises()
    expect(api.get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders', { params: expect.objectContaining({ sortBy: field, sortOrder: 'desc', departmentId: 'd1', search: 'DEMO' }) })
    if (queue === 'shipping') {
      await wrapper.get('select[aria-label="出库阶段"]').setValue('pending_review'); await flushPromises()
      expect(router.currentRoute.value.query).toMatchObject({ sortBy: field, sortOrder: 'desc', warehouseStage: 'pending_review' })
    }
    await wrapper.get('button.sort-payment').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.sortBy).toBeUndefined()
    expect(router.currentRoute.value.query.sortOrder).toBeUndefined()
    expect(wrapper.get('button.sort-payment').element.closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    await router.push(`/workbench/${role}?queue=${queue}&sortBy=invalid`); await flushPromises()
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.get('[role=alert]').text()).toContain('排序')
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
    const headerCells = wrapper.findAll('thead th')
    const totalCells = wrapper.findAll('tfoot th, tfoot td')
    const quantityCell = totalCells.findIndex(cell => cell.classes().includes('quantity-total'))
    expect(totalCells.slice(0, quantityCell).reduce((sum, cell) => sum + Number(cell.attributes('colspan') || 1), 0)).toBe(headerCells.findIndex(cell => cell.text() === '数量'))
    expect(totalCells.reduce((sum, cell) => sum + Number(cell.attributes('colspan') || 1), 0)).toBe(headerCells.length)
    expect(wrapper.findAll('.order-currency-total').map(cell => cell.text())).toEqual(['$100.20', '€9.80'])
    spy.mockResolvedValueOnce({ refreshedAt: '2026-10-24T05:30:00Z', source: 'mock', total: 0, page: 1, pageSize: 10, items: [], departments: [], totals: { orderCount: 0, itemQuantity: 0, amountsByCurrency: [] } })
    await router.push('/workbench/allocation?queue=allocation&search=empty'); await flushPromises()
    expect(Number(wrapper.get('tbody tr td').attributes('colspan'))).toBe(wrapper.findAll('thead th').length)
    expect(wrapper.find('tfoot').text()).toContain('0 笔订单')
    expect(wrapper.find('tfoot').text()).toContain('$0.00')
    wrapper.unmount(); spy.mockRestore()
  })
  it('shows the required fields and only the selected business status, retaining its queue while searching', async () => {
    const { wrapper, router } = await setup()
    expect(wrapper.find('h2').text()).toContain('待配货')
    const headers = wrapper.find('thead').text()
    for (const label of ['订单编号', 'Shopify 单号', '客户名称', '商品', '配货单状态']) expect(headers).toContain(label)
    expect(headers).toContain('发运单状态')
    for (const label of ['支付状态', '审核状态', '发运状态', '发货状态']) expect(wrapper.findAll('thead th').map(th => th.text())).not.toContain(label)
    expect(wrapper.findAll('tbody tr')).toHaveLength(14)
    expect((wrapper.get('select[aria-label="每页条数"]').element as HTMLSelectElement).value).toBe('50')
    expect(api.get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders', { params: expect.objectContaining({ page: 1, pageSize: 50 }) })
    expect(wrapper.findAll('tbody img').length).toBeGreaterThan(0)
    expect(wrapper.find('tbody').text()).toContain('未齐套，未配货')
    expect(wrapper.find('tbody').text()).not.toContain('已齐套未审核')
    await wrapper.find('input[type=search]').setValue('DEMO-SO-10241')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.query.queue).toBe('allocation')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('DEMO-SO-10241')
    await router.push('/workbench/dispatch?queue=dispatch')
    await flushPromises()
    expect(wrapper.find('thead').text()).toContain('Shopify 履约状态')
    expect(wrapper.find('thead').text()).not.toContain('配货单状态')
    expect(wrapper.find('tbody').text()).not.toContain('DEMO-SO-10241')
    await router.push('/workbench/warehouse?queue=shipping'); await flushPromises()
    const warehouseHeaders = wrapper.findAll('thead th').map(th => th.text())
    expect(warehouseHeaders).toContain('配货单状态')
    expect(warehouseHeaders).toContain('出库状态')
    expect(warehouseHeaders).not.toContain('支付状态')
    for (const row of wrapper.findAll('tbody tr')) {
      expect(row.findAll('td')).toHaveLength(warehouseHeaders.length)
      expect(['已齐套未审核', '已审核未出库']).toContain(row.findAll('td')[warehouseHeaders.indexOf('配货单状态')]!.text())
    }
    expect(wrapper.find('tbody').text()).toContain('已齐套未审核')
    expect(wrapper.find('tbody').text()).toContain('已审核未出库')
    expect(wrapper.find('tbody').text()).toContain('待配货审核')
    wrapper.unmount()
  })

  it('filters warehouse stages through the API and preserves them during search, sort and refresh', async () => {
    const { wrapper, router } = await setup('?queue=shipping&departmentId=d1&page=2&pageSize=20', 'warehouse')
    const filter = () => wrapper.get('select[aria-label="出库阶段"]')
    expect(filter().findAll('option').map(o => o.text())).toEqual(['全部待出库', '已齐套未审核', '已审核未出库'])
    await filter().setValue('pending_review'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ warehouseStage: 'pending_review', departmentId: 'd1', page: '1' })
    expect(api.get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders', { params: expect.objectContaining({ warehouseStage: 'pending_review', departmentId: 'd1', page: 1 }) })
    expect(wrapper.find('tbody').text()).toContain('已齐套未审核')
    expect(wrapper.find('tbody').text()).not.toContain('已审核未出库')
    await wrapper.get('button.sort-payment').trigger('click'); await flushPromises()
    await wrapper.get('button.refresh-orders').trigger('click'); await flushPromises()
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(api.get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders', { params: expect.objectContaining({ warehouseStage: 'pending_review', paidAtOrder: 'desc' }) })
    await filter().setValue('pending_outbound'); await flushPromises()
    expect(wrapper.find('tbody').text()).not.toContain('已齐套未审核')
    expect(wrapper.find('tbody').text()).toContain('已审核未出库')
    await router.push('/workbench/warehouse?queue=shipping&warehouseStage=bad'); await flushPromises()
    expect(wrapper.find('tbody').exists()).toBe(false)
    expect(wrapper.get('[role=alert]').text()).toContain('出库阶段筛选无效')
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
