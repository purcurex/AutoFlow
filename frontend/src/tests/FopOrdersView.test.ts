import { getTaskStatus } from '@/utils/workbench-status'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FopOrdersView from '@/views/autoflow/FopOrdersView.vue'
import * as orders from '@/api/fop-orders'
import api from '@/api'
import { mockFopOrders } from '@/api/fop-order-fixtures'
import * as exporter from '@/api/fop-order-export'
import * as downloads from '@/utils/export'
import { invalidateSession } from '@/utils/session'
import OrderApprovalDialog from '@/components/autoflow/OrderApprovalDialog.vue'
import { previewOrderApproval } from '@/api/fop-approvals'
vi.mock('@/api/fop-approvals', () => ({ previewOrderApproval: vi.fn(), submitOrderApproval: vi.fn() }))

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
  const filtered = mockFopOrders.filter(order => orders.matchesFopQueue(order, query.queue, query.warehouseStage) && (!query.taskStatus || getTaskStatus(order, query.queue) === query.taskStatus) && (!search || order.orderNumber.toLowerCase().includes(search)))
  return { source: 'fop', departments: [{ id: 'd1', name: '业务一部' }, { id: 'd2', name: '业务二部' }], items: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: filtered.length, page: query.page, pageSize: query.pageSize }
}) } }))

describe('fulfillment order list', () => {
  it.each([['unpaid', 'sales'], ['review', 'sales'], ['exceptions', 'sales'], ['dispatch', 'dispatch'], ['procurement', 'procurement'], ['procurement_shipping', 'procurement'], ['allocation', 'allocation'], ['allocation_review', 'allocation'], ['shipping', 'warehouse']] as const)('clears an applied search in %s automatically while retaining other filters', async (queue, role) => {
    const source = mockFopOrders.find(o => orders.matchesFopQueue(o, queue))!
    const get = vi.spyOn(orders, 'getFopOrders').mockImplementation(async query => ({ source: 'mock', items: [source], total: 101, page: query.page!, pageSize: query.pageSize!, departments: [{ id: 'd1', name: '业务一部' }], refreshedAt: '', totals: { orderCount: 101, itemQuantity: 101, amountsByCurrency: [] } }))
    const { wrapper, router } = await setup(`?queue=${queue}&search=applied&page=2&pageSize=100&departmentId=d1&warehouseCode=HZ&paidAtOrder=desc`, role)
    const input = wrapper.get('input[type="search"]')
    const calls = get.mock.calls.length
    await input.setValue('editing'); await flushPromises()
    expect(get.mock.calls.length).toBe(calls)
    await input.setValue('   '); await flushPromises()
    expect(router.currentRoute.value.query.search).toBeUndefined()
    expect(router.currentRoute.value.query).toMatchObject({ queue, page: '1', pageSize: '100', departmentId: 'd1', warehouseCode: 'HZ', paidAtOrder: 'desc' })
    expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ search: '', page: 1, pageSize: 100, departmentId: 'd1', warehouseCode: 'HZ', paidAtOrder: 'desc' }))
    const after = get.mock.calls.length
    await input.setValue(''); await flushPromises()
    expect(get.mock.calls.length).toBe(after)
    await router.back(); await flushPromises()
    expect(router.currentRoute.value.query.search).toBe('applied')
    expect((wrapper.get('input[type="search"]').element as HTMLInputElement).value).toBe('applied')
  })
  it('does not let a stale search overwrite results after clearing the query', async () => {
    const row = mockFopOrders.find(o => orders.matchesFopQueue(o, 'review'))!
    const page = { source: 'mock' as const, items: [row], total: 1, page: 1, pageSize: 50, departments: [], refreshedAt: '', totals: { orderCount: 1, itemQuantity: 1, amountsByCurrency: [] } }
    let resolveOld!: (value: orders.FopQueuePage) => void
    vi.spyOn(orders, 'getFopOrders').mockImplementation(query => query.search ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve(page))
    const { wrapper } = await setup('?queue=review&search=old', 'sales')
    await wrapper.get('input[type="search"]').setValue(''); await flushPromises()
    expect(wrapper.text()).toContain(row.orderNumber)
    resolveOld({ ...page, items: [], total: 0 }); await flushPromises()
    expect(wrapper.text()).toContain(row.orderNumber)
  })
  it('shows WMS creation time independently from order creation and receipts', async () => {
    const source = mockFopOrders.find(o => orders.matchesFopQueue(o, 'shipping'))!
    const items = ['2026-10-28T12:30:00+08:00', undefined, '2026-02-30T00:00:00Z', '2026-10-28T12:30:00'].map((wmsCreatedAt, i) => ({ ...source, id: String(i), wmsCreatedAt }))
    vi.spyOn(orders, 'getFopOrders').mockResolvedValue({ source: 'mock', items, total: 4, page: 1, pageSize: 50, departments: [], refreshedAt: '', totals: { orderCount: 4, itemQuantity: 4, amountsByCurrency: [] } })
    const { wrapper } = await setup('?queue=shipping', 'warehouse')
    expect(wrapper.findAll('td[data-label="WMS创建时间"]').map(c => c.text())).toEqual(['2026/10/28 12:30', '—', '—', '—'])
    expect(wrapper.find('td[data-label="创建时间"]').exists()).toBe(false)
  })

  it('displays current allocation completion time without a creation-time fallback', async () => {
    const source = mockFopOrders.find(o => orders.matchesFopQueue(o, 'allocation_review'))!
    const items = ['2026-10-27T04:30:00Z', undefined, '2026-02-30T00:00:00Z'].map((allocationReadyAt, i) => ({ ...source, id: String(i), allocationReadyAt }))
    vi.spyOn(orders, 'getFopOrders').mockResolvedValue({ source: 'mock', items, total: 3, page: 1, pageSize: 50, departments: [], refreshedAt: '', totals: { orderCount: 3, itemQuantity: 3, amountsByCurrency: [] } })
    const { wrapper } = await setup('?queue=allocation_review', 'allocation')
    expect(wrapper.findAll('td[data-label="齐套时间"]').map(c => c.text())).toEqual(['2026/10/27 12:30', '—', '—'])
    expect(wrapper.find('td[data-label="创建时间"]').exists()).toBe(false)
  })

  it.each([
    [0, 'normal'], [24, 'normal'], [24 + 1 / 3600000, 'warning'], [48, 'warning'], [48 + 1 / 3600000, 'danger'], [72, 'danger'], [-1, 'normal'],
  ] as const)('uses procurement payment age %s hours for shipment reminder %s', async (hours, tone) => {
    const now = Date.parse('2026-10-28T04:00:00Z')
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const source = mockFopOrders.find(o => orders.matchesFopQueue(o, 'procurement_shipping'))!
    const row = { ...source, createdAt: '2026-10-01T00:00:00Z', paidAt: '2026-10-02T00:00:00Z', procurementPaidAt: new Date(now - hours * 3600000).toISOString() }
    const page = { source: 'mock' as const, items: [row], total: 1, page: 1, pageSize: 50, departments: [], refreshedAt: new Date(now).toISOString(), totals: { orderCount: 1, itemQuantity: 1, amountsByCurrency: [] } }
    const get = vi.spyOn(orders, 'getFopOrders').mockResolvedValue(page)
    const { wrapper } = await setup('?queue=procurement_shipping', 'procurement')
    expect(wrapper.findAll('th').map(c => c.text())).toContain('采购付款时间')
    expect(wrapper.find('td[data-label="创建时间"]').exists()).toBe(false)
    expect(wrapper.get('td[data-label="采购付款时间"]').text()).not.toContain('2026/10/01')
    expect(wrapper.get('.supplier-shipment-pill').attributes('data-aging')).toBe(tone)
    for (const value of [undefined, null, 'invalid', '2026-02-30T00:00:00Z', '2026-10-01T00:00:00']) {
      get.mockResolvedValue({ ...page, items: [{ ...row, procurementPaidAt: value }] })
      window.dispatchEvent(new Event('focus')); await flushPromises()
      expect(wrapper.get('td[data-label="采购付款时间"]').text()).toBe('—')
      expect(wrapper.get('.supplier-shipment-pill').attributes('data-aging')).toBe('normal')
    }
  })

  it('updates shipment urgency while open without requiring a successful data reload', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-28T04:00:00Z'))
    const source = mockFopOrders.find(o => orders.matchesFopQueue(o, 'procurement_shipping'))!
    vi.spyOn(orders, 'getFopOrders').mockResolvedValue({ source: 'mock', items: [{ ...source, procurementPaidAt: '2026-10-27T04:00:00Z' }], total: 1, page: 1, pageSize: 50, departments: [], refreshedAt: new Date().toISOString(), totals: { orderCount: 1, itemQuantity: 1, amountsByCurrency: [] } })
    const { wrapper } = await setup('?queue=procurement_shipping', 'procurement')
    expect(wrapper.get('.supplier-shipment-pill').attributes('data-aging')).toBe('normal')
    vi.stubGlobal('navigator', { onLine: false })
    window.dispatchEvent(new Event('offline')); await flushPromises()
    await vi.advanceTimersByTimeAsync(30000); await flushPromises()
    expect(wrapper.get('.supplier-shipment-pill').attributes('data-aging')).toBe('warning')
    vi.setSystemTime(new Date('2026-10-29T04:00:01Z'))
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(wrapper.get('.supplier-shipment-pill').attributes('data-aging')).toBe('danger')
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([['unpaid', 'sales'], ['review', 'sales'], ['exceptions', 'sales'], ['dispatch', 'dispatch'], ['procurement', 'procurement'], ['procurement_shipping', 'procurement'], ['allocation', 'allocation'], ['allocation_review', 'allocation'], ['shipping', 'warehouse']] as const)('copies raw identifiers and each SKU in %s without selecting the order', async (queue, role) => {
    const copy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
    const base = mockFopOrders.find(o => orders.matchesFopQueue(o, queue))!
    const row = { ...base, shopifyOrderNumber: '#000123', allocationDocument: { id: 'ao-1', number: 'AO261028000404' },
      dispatchDocuments: [{ id: 'fy-1', number: 'FY000123', status: 'draft' as const }, { id: 'fy-2', number: 'FY000456', status: 'submitted' as const }],
      items: [{ ...base.items[0]!, sku: '000SKU-A', quantity: 3 }, { ...base.items[0]!, sku: '000SKU-B', quantity: 7 }] }
    vi.spyOn(orders, 'getFopOrders').mockResolvedValue({ source: 'mock', items: [row], total: 1, page: 1, pageSize: 50, departments: [], refreshedAt: new Date().toISOString(), totals: { orderCount: 1, itemQuantity: 10, amountsByCurrency: [] } })
    const { wrapper } = await setup(`?queue=${queue}`, role)
    const values = [['Shopify 单号', '#000123'], ['SKU', '000SKU-A'], ['SKU', '000SKU-B']]
    if (queue === 'allocation_review') values.push(['配货单号', 'AO261028000404'])
    if (['dispatch', 'allocation', 'allocation_review'].includes(queue)) values.push(['发运单编号', 'FY000123'], ['发运单编号', 'FY000456'])
    for (const [label, value] of values) {
      await wrapper.get(`button[aria-label="复制${label} ${value}"]`).trigger('click'); await flushPromises()
      expect(copy).toHaveBeenLastCalledWith(value)
    }
    expect((wrapper.get('tbody input.order-checkbox').element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.findComponent(OrderApprovalDialog).exists()).toBe(false)
  })

  it('sorts procurement by actual order approval time and preserves receipt default and filters', async () => {
    const { wrapper, router } = await setup('?queue=procurement&departmentId=d1', 'procurement')
    expect(wrapper.get('thead').text()).not.toContain('创建时间')
    expect(wrapper.get('button.sort-payment').element.closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    await wrapper.get('thead button[aria-label^="订单审核时间："]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ sortBy: 'reviewedAt', sortOrder: 'asc', departmentId: 'd1', page: '1' })
    await wrapper.get('.compact-consumer-sort').trigger('click'); await flushPromises()
    expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('fulfillment-orders'), { params: expect.objectContaining({ sortBy: 'reviewedAt', sortOrder: 'desc' }) })
    expect(wrapper.get('thead button[aria-label^="订单审核时间："]').attributes('aria-label')).toContain('审核')
    await wrapper.get('button.sort-payment').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.sortBy).toBeUndefined()
  })

  it.each([['unpaid', 'sales'], ['review', 'sales'], ['exceptions', 'sales'], ['dispatch', 'dispatch'], ['allocation', 'allocation']] as const)('sorts consumer checkout time in %s and restores oldest receipt first', async (queue, role) => {
    const { wrapper, router } = await setup(`?queue=${queue}&departmentId=d1`, role)
    expect(wrapper.get('button.sort-payment').element.closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    await wrapper.get('thead button[aria-label^="C端下单时间："]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ sortBy: 'consumerPaidAt', sortOrder: 'asc', page: '1', departmentId: 'd1' })
    expect(wrapper.get('thead button[aria-label^="C端下单时间："]').element.closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    await wrapper.get('.compact-consumer-sort').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.sortOrder).toBe('desc')
    await wrapper.get('button.refresh-orders').trigger('click'); await flushPromises()
    expect(api.get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders', { params: expect.objectContaining({ sortBy: 'consumerPaidAt', sortOrder: 'desc', departmentId: 'd1' }) })
    await wrapper.get('button.sort-payment').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.sortBy).toBeUndefined()
    expect(router.currentRoute.value.query.paidAtOrder).toBe('asc')
  })

  it.each([['dispatch_approved', 'dispatch_complete'], ['dispatch_synced', 'dispatch_complete'], ['dispatch_draft', 'dispatch_incomplete']])('migrates allocation review bookmark %s to a completion filter', async (previous, current) => {
    const { wrapper, router } = await setup(`?queue=allocation_review&departmentId=d1&page=2&taskStatus=${previous}`, 'allocation')
    expect(router.currentRoute.value.query).toMatchObject({ taskStatus: current, departmentId: 'd1', page: '1' })
    expect(wrapper.text()).not.toContain('状态筛选无效')
  })
  it('shows allocation document numbers, binary dispatch filters and enables approval for completed selections', async () => {
    const source = mockFopOrders.find(o => orders.matchesFopQueue(o, 'allocation_review'))!
    const items = [
      { ...source, id: 'ready', allocationDocument: { id: 'ao1', number: 'AO261028000404' }, dispatchDocuments: [{ id: 'fy1', number: 'FY-001', status: 'approved' as const }] },
      { ...source, id: 'waiting', allocationDocument: { id: 'ao2', number: 'AO261028000405' }, dispatchDocuments: [] },
    ]
    vi.spyOn(orders, 'getFopOrders').mockResolvedValue({ source: 'mock', items, total: 2, page: 1, pageSize: 50, departments: [], refreshedAt: new Date().toISOString(), totals: { orderCount: 2, itemQuantity: 2, amountsByCurrency: [] } })
    vi.mocked(previewOrderApproval).mockResolvedValue({ source: 'mock', queue: 'allocation_review', items: [] })
    const { wrapper } = await setup('?queue=allocation_review', 'allocation')
    expect(wrapper.get('select[aria-label="发运单状态筛选"]').findAll('option').map(o => o.text())).toEqual(['全部状态', '未完成', '已完成'])
    expect(wrapper.findAll('td[data-label="配货单号"]').map(c => c.text())).toEqual(['AO261028000404', 'AO261028000405'])
    const button = wrapper.get('[data-testid="open-approval"]')
    await wrapper.findAll('tbody input.order-checkbox')[1]!.setValue(true)
    expect(button.attributes('disabled')).toBeDefined()
    await wrapper.findAll('tbody input.order-checkbox')[0]!.setValue(true)
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click'); await flushPromises()
    expect(previewOrderApproval).toHaveBeenLastCalledWith('allocation_review', ['waiting', 'ready'])
    expect(wrapper.getComponent(OrderApprovalDialog).props('queue')).toBe('allocation_review')
  })
  it.each([
    ['taskStatus=dispatch_missing', 'taskStatus', 'dispatch_preparation'],
    ['taskStatus=logistics_pending', 'taskStatus', 'dispatch_preparation'],
    ['taskStatus=application_pending', 'taskStatus', 'purchase_order_pending'],
    ['taskStatus=unknown', 'taskStatus', undefined],
    ['procurementStage=application_pending', 'procurementStage', 'purchase_order_pending'],
    ['procurementStage=unknown', 'procurementStage', undefined],
  ])('updates an obsolete bookmarked filter %s without losing department scope', async (query, key, expected) => {
    const { router, wrapper } = await setup(`?queue=procurement&departmentId=d1&page=2&${query}`, 'procurement')
    expect(router.currentRoute.value.query[key!]).toBe(expected)
    expect(router.currentRoute.value.query.departmentId).toBe('d1')
    expect(router.currentRoute.value.query.page).toBe('1')
    expect(wrapper.text()).not.toContain('筛选无效')
  })
  it('places sales approval before search and previews single or multiple selected orders', async () => {
    vi.mocked(previewOrderApproval).mockResolvedValue({ source: 'mock', queue: 'review', items: [] })
    const { wrapper } = await setup('?queue=review', 'sales')
    const button = wrapper.get('.query-controls > [data-testid="open-approval"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.element.compareDocumentPosition(wrapper.get('.search-form').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const rows = wrapper.findAll('tbody input.order-checkbox')
    expect(rows.length).toBeGreaterThan(1)
    await rows[0]!.setValue(true)
    await button.trigger('click'); await flushPromises()
    expect(previewOrderApproval).toHaveBeenLastCalledWith('review', [rows[0]!.attributes('value')])
    wrapper.getComponent(OrderApprovalDialog).vm.$emit('close'); await flushPromises()
    await rows[1]!.setValue(true)
    await button.trigger('click'); await flushPromises()
    expect(wrapper.getComponent(OrderApprovalDialog).props('orderIds')).toHaveLength(2)
    const calls = vi.mocked(api.get).mock.calls.length
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(api.get).toHaveBeenCalledTimes(calls)
    wrapper.getComponent(OrderApprovalDialog).vm.$emit('completed'); await flushPromises()
    expect(wrapper.findComponent(OrderApprovalDialog).exists()).toBe(true)
    expect(api.get).toHaveBeenCalledTimes(calls)
    wrapper.getComponent(OrderApprovalDialog).vm.$emit('close'); await flushPromises()
    expect(api.get).toHaveBeenCalledTimes(calls + 1)
    expect(wrapper.get('[data-testid="open-approval"]').attributes('disabled')).toBeDefined()
  })

  it('merges dispatch carriers and typed tracking numbers without mixing carrier groups', async () => {
    const row = { ...mockFopOrders.find(o => orders.matchesFopQueue(o, 'dispatch'))!, logisticsInfo: [
      { carrierName: '云途YT', shopifyTracking: { type: 'full' as const, number: 'YT123' } },
      { carrierName: '4PX', shopifyTracking: { type: 'last_mile' as const, number: '9400' } },
    ] }
    vi.spyOn(orders, 'getFopOrders').mockResolvedValue({ source: 'mock', refreshedAt: new Date().toISOString(), departments: [], items: [row], total: 1, page: 1, pageSize: 50, totals: { orderCount: 1, itemQuantity: 1, amountsByCurrency: [] } })
    const { wrapper } = await setup('?queue=dispatch', 'dispatch')
    const headings = wrapper.findAll('thead th').map(cell => cell.text())
    expect(headings).toContain('物流信息')
    expect(headings).not.toContain('物流商')
    expect(headings).not.toContain('跟踪号')
    const groups = wrapper.get('td[data-label="物流信息"]').findAll('.logistics-group')
    expect(groups.map(group => group.text())).toEqual(['云途YTQC: YT123', '4PXWC: 9400'])
    expect(wrapper.findAll('tbody tr')[0]!.findAll('td')).toHaveLength(headings.length)
  })

  it('shows the custom channel and queue-specific search hint for unpaid orders', async () => {
    const row = { ...mockFopOrders.find(order => orders.matchesFopQueue(order, 'unpaid'))!, customLogisticsChannelName: 'Priority Shipping' }
    const page = { source: 'mock' as const, refreshedAt: new Date().toISOString(), items: [row], total: 1, page: 1, pageSize: 50, totals: { orderCount: 1, itemQuantity: 1, amountsByCurrency: [] }, departments: [], salespeople: [] }
    const get = vi.spyOn(orders, 'getFopOrders').mockResolvedValue(page)
    const { wrapper, router } = await setup('?queue=unpaid', 'sales')
    expect(wrapper.get('td[data-label="自定义物流渠道"]').text()).toBe('Priority Shipping')
    expect(wrapper.get('input[type="search"]').attributes('placeholder')).toContain('自定义物流渠道')
    expect(wrapper.get('input[type="search"]').attributes('title')).not.toContain('物流服务商')
    expect(wrapper.findAll('thead th').map(cell => cell.text())).not.toContain('业务部门')
    expect(wrapper.find('.salesperson-name').exists()).toBe(true)
    expect(wrapper.find('.salesperson-department').exists()).toBe(true)
    expect(wrapper.findAll('tbody tr')[0]!.findAll('td')).toHaveLength(wrapper.findAll('thead th').length)
    await wrapper.get('input[type="search"]').setValue('pRiOrItY')
    await wrapper.get('form.search-form').trigger('submit'); await flushPromises()
    expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ queue: 'unpaid', search: 'pRiOrItY', page: 1 }))
    get.mockResolvedValue({ ...page, items: [{ ...row, customLogisticsChannelName: undefined }] })
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(wrapper.get('td[data-label="自定义物流渠道"]').text()).toBe('—')
    await router.push('/workbench/sales?queue=review'); await flushPromises()
    expect(wrapper.find('td[data-label="自定义物流渠道"]').exists()).toBe(false)
    expect(wrapper.get('input[type="search"]').attributes('placeholder')).toContain('物流服务商')
  })

  it('shows actual logistics channel names and codes as separate lines only in the review queue', async () => {
    const row = { ...mockFopOrders.find(order => orders.matchesFopQueue(order, 'review'))!, logisticsChannels: [{ name: '云途标准专线', code: 'YT-STD' }, { name: '云途带电专线', code: 'YT-BAT' }] }
    const page = { source: 'mock' as const, refreshedAt: new Date().toISOString(), items: [row], total: 1, page: 1, pageSize: 50, totals: { orderCount: 1, itemQuantity: 1, amountsByCurrency: [] }, departments: [], salespeople: [] }
    const get = vi.spyOn(orders, 'getFopOrders').mockResolvedValue(page)
    const { wrapper, router } = await setup('?queue=review', 'sales')
    const headers = wrapper.findAll('thead th').map(cell => cell.text())
    expect(headers[headers.indexOf('发货仓库') + 1]).toBe('物流渠道')
    const cell = wrapper.get('td[data-label="物流渠道"]')
    expect(cell.findAll('.logistics-channel-entry').map(entry => [entry.get('.logistics-channel-name').text(), entry.get('.logistics-channel-code').text()])).toEqual([
      ['云途标准专线', 'YT-STD'], ['云途带电专线', 'YT-BAT'],
    ])
    expect(wrapper.findAll('tbody tr')[0]!.findAll('td')).toHaveLength(headers.length)
    get.mockResolvedValue({ ...page, items: [{ ...row, logisticsChannels: undefined }] })
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(wrapper.get('td[data-label="物流渠道"]').text()).toBe('—')
    await router.push('/workbench/sales?queue=unpaid'); await flushPromises()
    expect(wrapper.find('td[data-label="物流渠道"]').exists()).toBe(false)
  })
  it.each([['unpaid', 'sales'], ['review', 'sales'], ['exceptions', 'sales'], ['dispatch', 'dispatch']] as const)('shows consumer checkout payment time in %s with no creation/receipt fallback', async (queue, role) => {
    const fixture = mockFopOrders.find(order => orders.matchesFopQueue(order, queue))!
    const row = { ...fixture, createdAt: '2026-09-10T00:00:00Z', paidAt: fixture.paidAt, consumerPaidAt: '2026-10-01T21:30:00.000Z' }
    const page = { source: 'mock' as const, refreshedAt: new Date().toISOString(), items: [row], total: 1, page: 1, pageSize: 50, totals: { orderCount: 1, itemQuantity: 1, amountsByCurrency: [] }, departments: [], salespeople: [] }
    const get = vi.spyOn(orders, 'getFopOrders').mockResolvedValue(page)
    const { wrapper, router } = await setup(`?queue=${queue}`, role)
    expect(wrapper.findAll('th').map(cell => cell.text())).toContain('C端下单时间')
    expect(wrapper.get('td[data-label="C端下单时间"]').text()).toBe('2026/10/02 05:30')
    expect(wrapper.find('td[data-label="创建时间"]').exists()).toBe(false)
    get.mockResolvedValue({ ...page, items: [{ ...row, consumerPaidAt: undefined }] })
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(wrapper.get('td[data-label="C端下单时间"]').text()).toBe('—')
    get.mockResolvedValue({ ...page, items: [{ ...row, reviewedAt: undefined, paymentStatus: 'paid', reviewStatus: 'pending', procurementProgress: { purchaseOrder: 'ordered', supplierPayment: 'unpaid' } }] })
    await router.push('/workbench/procurement?queue=procurement'); await flushPromises()
    expect(wrapper.get('td[data-label="订单审核时间"]').text()).toBe('—')
    expect(wrapper.find('td[data-label="C端下单时间"]').exists()).toBe(false)
  })
  it('uses Procurement progress and excludes nonexistent filter choices', async () => {
    const { wrapper } = await setup('?queue=procurement', 'procurement')
    const filter = wrapper.get('select[aria-label="采购进度筛选"]')
    const labels = filter.findAll('option').map(o => o.text())
    expect(labels).toEqual(['全部状态', '待建采购订单', '待制作发运单', '待推1688采购', '待支付采购款', '采购退款待跟进'])
    expect(labels.join(' ')).not.toContain('物流条件待确认')
    expect(labels.join(' ')).not.toContain('采购款部分支付')
    expect(wrapper.findAll('th').map(cell => cell.text())).toContain('采购进度')
    expect(wrapper.text()).not.toContain('采购订单状态')
  })

  it('opens the order recipient below its country, updates on refresh and closes on navigation/session reset', async () => {
    const row = { ...mockFopOrders.find(order => orders.matchesFopQueue(order, 'review'))!, shippingCountryCode: 'US', shippingRecipient: { name: 'Jane Recipient', phone: '+1 202-555-0147', email: 'jane@example.com', state: 'MA', city: 'Boston', postalCode: '02108', addressLine1: '18 Example Street', addressLine2: 'Unit 4' } }
    const page = { source: 'mock' as const, refreshedAt: new Date().toISOString(), items: [row], total: 1, page: 1, pageSize: 50, totals: { orderCount: 1, itemQuantity: 1, amountsByCurrency: [] }, departments: [], salespeople: [] }
    const get = vi.spyOn(orders, 'getFopOrders').mockResolvedValue(page)
    const { wrapper, router } = await setup('?queue=review', 'sales')
    expect(wrapper.get('.country-cell').text()).toContain('USJane Recipient')
    expect(wrapper.get('.country-cell .recipient-name').text()).not.toBe(row.customerName)
    await wrapper.get('.recipient-name').trigger('click'); await flushPromises()
    let dialog = document.querySelector('dialog')!
    for (const value of ['Jane Recipient', '+1 202-555-0147', 'jane@example.com', 'Boston', '02108', '18 Example Street', 'Unit 4']) expect(dialog.textContent).toContain(value)
    get.mockResolvedValue({ ...page, items: [{ ...row, shippingRecipient: { ...row.shippingRecipient, city: 'Cambridge' } }] })
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(dialog.textContent).toContain('Cambridge')
    await router.push('/workbench/sales?queue=review&search=test'); await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
    await wrapper.get('.recipient-name').trigger('click'); await flushPromises()
    dialog = document.querySelector('dialog')!
    dialog.dispatchEvent(new Event('cancel', { cancelable: true })); await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
    await wrapper.get('.recipient-name').trigger('click'); await flushPromises()
    invalidateSession(); await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
    expect(wrapper.find('.recipient-name').exists()).toBe(false)
  })

  it('clears recipient details when a refresh removes an order and handles older adapters', async () => {
    const row = { ...mockFopOrders.find(order => orders.matchesFopQueue(order, 'review'))!, shippingRecipient: { name: null, phone: null, email: null, state: null, city: null, postalCode: null, addressLine1: 'Example Road', addressLine2: null } }
    const page = { source: 'mock' as const, refreshedAt: new Date().toISOString(), items: [row], total: 1, page: 1, pageSize: 50, totals: { orderCount: 1, itemQuantity: 1, amountsByCurrency: [] }, departments: [], salespeople: [] }
    const get = vi.spyOn(orders, 'getFopOrders').mockResolvedValue(page)
    const { wrapper } = await setup('?queue=review', 'sales')
    expect(wrapper.get('.recipient-name').text()).toBe('查看收件人')
    await wrapper.get('.recipient-name').trigger('click'); await flushPromises()
    expect(document.querySelector('dialog')?.textContent).toContain('Example Road')
    expect(document.querySelector('dialog')?.textContent).toContain('—')
    get.mockResolvedValue({ ...page, items: [] })
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
    get.mockResolvedValue({ ...page, items: [{ ...row, shippingRecipient: undefined }] })
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(wrapper.get('.recipient-empty').text()).toBe('—')
    expect(wrapper.find('.recipient-name').exists()).toBe(false)
  })
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  afterEach(() => { mounted.splice(0).forEach(w => { if (w.exists()) w.unmount() }); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard); else Reflect.deleteProperty(navigator, 'clipboard') })

  it('filters from the list toolbar and preserves the stage in search and export', async () => {
    const get = vi.spyOn(orders, 'getFopOrders').mockResolvedValue({ source: 'mock', refreshedAt: new Date().toISOString(), items: [], total: 100, page: 2, pageSize: 20,
      totals: { orderCount: 100, itemQuantity: 100, amountsByCurrency: [] }, departments: [], salespeople: [] })
    const run = vi.spyOn(exporter, 'exportFopOrders').mockResolvedValue(new Blob(['xlsx']))
    vi.spyOn(downloads, 'downloadBlob').mockImplementation(() => {})
    const { wrapper, router } = await setup('?queue=procurement&departmentId=d1&ownerId=employee-1&page=2&pageSize=20', 'procurement')
    expect(wrapper.find('thead select').exists()).toBe(false)
    expect(wrapper.get('.query-controls').element.firstElementChild).toBe(wrapper.get('.status-filter').element)
    expect(wrapper.get('.status-filter').element.nextElementSibling).toBe(wrapper.get('.search-form').element)
    await wrapper.get('div.query-controls select[aria-label="采购进度筛选"]').setValue('payment_pending'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ taskStatus: 'payment_pending', page: '1', departmentId: 'd1', ownerId: 'employee-1' })
    expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ taskStatus: 'payment_pending', page: 1 }))
    await wrapper.get('input[type="search"]').setValue('SKU-1')
    await wrapper.get('form.search-form').trigger('submit'); await flushPromises()
    expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ taskStatus: 'payment_pending', search: 'SKU-1' }))
    await wrapper.get('[data-testid="export-filtered"]').trigger('click'); await flushPromises()
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ taskStatus: 'payment_pending', search: 'SKU-1', mode: 'filtered' }), expect.any(AbortSignal))
    await wrapper.get('div.query-controls select[aria-label="采购进度筛选"]').setValue(''); await flushPromises()
    expect(router.currentRoute.value.query.taskStatus).toBeUndefined()
  })
  it('clears selected rows when changing the compact status and keeps filters usable for an empty result', async () => {
    const { wrapper, router } = await setup('?queue=allocation', 'allocation')
    await wrapper.findAll('tbody input.order-checkbox')[0]!.setValue(true)
    expect(wrapper.get('[data-testid="export-selected"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('.query-controls select[aria-label="发运单状态筛选"]').setValue('dispatch_submitted'); await flushPromises()
    expect(router.currentRoute.value.query.taskStatus).toBe('dispatch_submitted')
    expect(wrapper.get('[data-testid="export-selected"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.query-controls select[aria-label="发运单状态筛选"]').findAll('option')).toHaveLength(6)
    expect(wrapper.find('thead select').exists()).toBe(false)
    for (const row of wrapper.findAll('tbody tr').filter(row => row.find('input.order-checkbox').exists())) expect(row.get('.dispatch-stage').text()).toBe('已提交')
  })

  it('shows and clears the legacy criterion when both status filters are present', async () => {
    const get = vi.spyOn(orders, 'getFopOrders').mockResolvedValue({ source: 'mock', refreshedAt: new Date().toISOString(), items: [], total: 0, page: 1, pageSize: 50,
      totals: { orderCount: 0, itemQuantity: 0, amountsByCurrency: [] }, departments: [], salespeople: [] })
    const { wrapper, router } = await setup('?queue=procurement&taskStatus=payment_pending&procurementStage=alibaba_pending', 'procurement')
    expect(wrapper.get('.legacy-status-filter').text()).toContain('待推1688采购')
    await wrapper.get('button[aria-label="清除原采购状态筛选"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.procurementStage).toBeUndefined()
    expect(router.currentRoute.value.query.taskStatus).toBe('payment_pending')
    expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ taskStatus: 'payment_pending', procurementStage: undefined }))
  })

  it('filters warehouses without a salesperson dropdown and keeps name/carrier search', async () => {
    const get = vi.spyOn(orders, 'getFopOrders').mockResolvedValue({ source: 'mock', refreshedAt: new Date().toISOString(), items: [], total: 100, page: 2, pageSize: 20,
      totals: { orderCount: 100, itemQuantity: 100, amountsByCurrency: [] }, departments: [{ id: 'd1', name: 'Department 1' }, { id: 'd2', name: 'Department 2' }], salespeople: [{ id: 'employee-1', name: 'Employee 1' }] })
    const { wrapper, router } = await setup('?queue=shipping&departmentId=d1&ownerId=employee-1&search=YT&page=2&pageSize=20&paidAtOrder=desc', 'warehouse')
    expect(wrapper.find('select[aria-label="业务员"]').exists()).toBe(false)
    expect(wrapper.get('.legacy-owner-filter').text()).toContain('Employee 1')
    expect(wrapper.get('input[type="search"]').attributes('placeholder')).toContain('物流服务商')
    expect(wrapper.get('input[type="search"]').attributes('placeholder')).toContain('业务员')
    await wrapper.get('select[aria-label="发货仓库"]').setValue('SZ'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ warehouseCode: 'SZ', page: '1', departmentId: 'd1', search: 'YT', paidAtOrder: 'desc' })
    expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ warehouseCode: 'SZ', departmentId: 'd1', search: 'YT', page: 1 }))
    await wrapper.get('.legacy-owner-filter button').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.ownerId).toBeUndefined()
    await wrapper.get('select[aria-label="业务部门"]').setValue('d2'); await flushPromises()
    expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ ownerId: undefined, warehouseCode: 'SZ', departmentId: 'd2', page: 1 }))
    await wrapper.get('select[aria-label="发货仓库"]').setValue(''); await flushPromises()
    expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ warehouseCode: undefined }))
  })

  it('exports selected orders or all filtered pages from a non-approval queue', async () => {
    const blob = new Blob(['xlsx'])
    const run = vi.spyOn(exporter, 'exportFopOrders').mockResolvedValue(blob)
    const download = vi.spyOn(downloads, 'downloadBlob').mockImplementation(() => {})
    const { wrapper } = await setup('?queue=shipping&warehouseCode=HZ&warehouseStage=pending_outbound&departmentId=d1&ownerId=employee-1&sortBy=outboundStatus&sortOrder=desc', 'warehouse')
    expect(wrapper.find('[data-testid="open-approval"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="export-selected"]').attributes('disabled')).toBeDefined()
    await wrapper.findAll('tbody input.order-checkbox')[0]!.setValue(true)
    await wrapper.get('[data-testid="export-selected"]').trigger('click'); await flushPromises()
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'selected', orderIds: [expect.any(String)], queue: 'shipping', warehouseCode: 'HZ', warehouseStage: 'pending_outbound', departmentId: 'd1', sortBy: 'outboundStatus', sortOrder: 'desc' }), expect.any(AbortSignal))
    expect(download).toHaveBeenCalledWith(blob, expect.stringMatching(/\.xlsx$/))
    await wrapper.get('input[type="search"]').setValue('not-yet-submitted')
    await wrapper.get('[data-testid="export-filtered"]').trigger('click'); await flushPromises()
    const query = run.mock.calls.at(-1)![0]
    expect(query).toMatchObject({ mode: 'filtered', search: '', ownerId: 'employee-1' })
    expect(run.mock.calls[0]![0]).toMatchObject({ mode: 'selected', ownerId: 'employee-1' })
    expect(query).not.toHaveProperty('page')
    expect(query).not.toHaveProperty('orderIds')
  })

  it.each(['navigation', 'session', 'unmount'])('discards a pending export after %s', async cause => {
    let resolve!: (blob: Blob) => void
    const run = vi.spyOn(exporter, 'exportFopOrders').mockImplementation(() => new Promise(r => { resolve = r }))
    const download = vi.spyOn(downloads, 'downloadBlob').mockImplementation(() => {})
    const { wrapper, router } = await setup('?queue=allocation', 'allocation')
    await wrapper.get('[data-testid="export-filtered"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="export-filtered"]').attributes('disabled')).toBeDefined()
    if (cause === 'navigation') await router.push('/workbench/allocation?queue=allocation_review')
    if (cause === 'session') invalidateSession()
    if (cause === 'unmount') wrapper.unmount()
    await flushPromises()
    expect(run.mock.calls[0]![1]?.aborted).toBe(true)
    resolve(new Blob(['xlsx'])); await flushPromises()
    expect(download).not.toHaveBeenCalled()
  })

  it('shows export failures without clearing the list and allows retry', async () => {
    vi.spyOn(exporter, 'exportFopOrders').mockRejectedValue({ code: 'export_selection_changed' })
    const { wrapper } = await setup('?queue=review', 'sales')
    await wrapper.get('thead input.order-checkbox').setValue(true)
    await wrapper.get('[data-testid="export-selected"]').trigger('click'); await flushPromises()
    expect(wrapper.get('.export-feedback').text()).toContain('刷新后重新选择')
    expect(wrapper.find('tbody tr').exists()).toBe(true)
    expect(wrapper.get('[data-testid="export-selected"]').attributes('disabled')).toBeUndefined()
  })

  it('keeps selection for export or sales approval and clears it on navigation', async () => {
    const { wrapper, router } = await setup('?queue=review', 'sales')
    expect(wrapper.findAll('thead th')[1]!.text()).toBe('商品图片 / 商品信息')
    const rows = wrapper.findAll('tbody input.order-checkbox')
    expect(rows.length).toBeGreaterThan(0)
    await rows[0]!.setValue(true)
    expect(wrapper.get('.approval-toolbar').text()).toContain('已选 1 笔')
    expect(wrapper.find('[data-testid="open-approval"]').exists()).toBe(true)
    await wrapper.get('thead input.order-checkbox').setValue(true)
    expect(wrapper.get('.approval-toolbar').text()).toContain(`已选 ${rows.length} 笔`)
    await router.push('/workbench/sales?queue=review&pageSize=20'); await flushPromises()
    expect(wrapper.get('[data-testid="export-selected"]').attributes('disabled')).toBeDefined()
    await router.push('/workbench/allocation?queue=allocation_review'); await flushPromises()
    expect(wrapper.find('[data-testid="open-approval"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('业务处理请在 FOP 完成')
    expect(wrapper.get('.task-heading-description').text()).toContain('单笔或批量审核')
    expect(wrapper.find('.list-heading .info-tip-trigger').exists()).toBe(false)
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
    expect(wrapper.get('[data-testid="export-selected"]').attributes('disabled')).toBeDefined()
  })

  it('shows purchase stages instead of customer payment in procurement, and keeps payment in sales', async () => {
    const { wrapper, router } = await setup('?queue=procurement', 'procurement')
    const headers = () => wrapper.findAll('thead th').map(th => th.text())
    expect(wrapper.find('.query-controls select[aria-label="采购进度筛选"]').exists()).toBe(true)
    expect(headers()).not.toContain('支付状态')
    expect(headers()).not.toContain('供应商发货状态')
    for (const label of ['待建采购订单', '待支付采购款', '采购退款待跟进']) expect(wrapper.text()).toContain(label)
    await router.push('/workbench/procurement?queue=procurement_shipping'); await flushPromises()
    expect(wrapper.find('tbody').text()).toContain('供应商待发货')
    expect(wrapper.find('tbody').text()).toContain('供应商部分发货')
    await router.push('/workbench/sales?queue=review'); await flushPromises()
    expect(headers()).not.toContain('支付状态')
    expect(headers()).not.toContain('采购进度')
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
    expect(headers()).not.toContain('Shopify 履约状态')
    const rows = wrapper.findAll('tbody tr')
    const statusCell = rows[0]!.findAll('td')[headers().indexOf('发运单状态')]!
    const numberCell = rows[0]!.findAll('td')[headers().indexOf('发运单编号')]!
    for (const number of ['FY-001', 'FY-002', 'FY-003']) expect(numberCell.text()).toContain(number)
    expect(headers().indexOf('发运单编号')).toBe(headers().indexOf('发运单状态') - 1)
    expect(statusCell.findAll('.dispatch-stage')).toHaveLength(1)
    expect(statusCell.get('.dispatch-stage').text()).toBe('暂存')
    expect(statusCell.find('details').exists()).toBe(false)
    expect(statusCell.text()).not.toContain('FY-')
    expect(wrapper.findAll('tfoot th, tfoot td').reduce((sum, cell) => sum + Number(cell.attributes('colspan') || 1), 0)).toBe(headers().length)
    expect(rows[1]!.text()).toContain('未创建')
    expect(rows[2]!.text()).toContain('待确认')
    expect(rows[0]!.findAll('td')).toHaveLength(headers().length)
    await router.push('/workbench/sales?queue=review'); await flushPromises()
    expect(headers()).not.toContain('支付状态')
    expect(headers()).not.toContain('发运单状态')
  })

  it('offers approved unsynced follow-up and clears the obsolete completed-dispatch route', async () => {
    const original = mockFopOrders.find(o => orders.matchesFopQueue(o, 'dispatch'))!
    const pending = { ...original, dispatchDocuments: [{ id: 'd1', number: 'FY-PENDING', status: 'approved' as const }], fulfillmentProgress: { ...original.fulfillmentProgress, shopifySync: 'pending' as const } }
    const page = { source: 'mock' as const, refreshedAt: new Date().toISOString(), departments: [], items: [pending], total: 1, page: 1, pageSize: 50, totals: { orderCount: 1, itemQuantity: 1, amountsByCurrency: [{ currency: 'USD', amount: original.amount }] } }
    const get = vi.spyOn(orders, 'getFopOrders').mockResolvedValue(page)
    const { wrapper, router } = await setup('?queue=dispatch&taskStatus=dispatch_synced', 'dispatch')
    const filter = () => wrapper.get('select[aria-label="发运单状态筛选"]')
    expect(router.currentRoute.value.query.taskStatus).toBeUndefined()
    expect(filter().findAll('option').map(o => o.text())).toEqual(['全部待履约', '未创建', '暂存', '已提交', '已审核未同步'])
    await filter().setValue('dispatch_approved'); await flushPromises()
    expect(router.currentRoute.value.query.taskStatus).toBe('dispatch_approved')
    expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ taskStatus: 'dispatch_approved' }))
    expect(wrapper.find('h2').text()).toContain('待履约清单')
    expect(wrapper.get('tbody .dispatch-stage').text()).toBe('已审核未同步')
    expect(wrapper.get('tbody .dispatch-numbers').text()).toBe('FY-PENDING')
    expect(wrapper.find('tbody details').exists()).toBe(false)
    get.mockResolvedValue({ ...page, items: [], total: 0, totals: { orderCount: 0, itemQuantity: 0, amountsByCurrency: [] } })
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(wrapper.find('tbody .dispatch-stage').exists()).toBe(false)
  })

  it('puts products second, keeps multiple items in one order and copies only its order number', async () => {
    const copy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
    const original = mockFopOrders.find(o => orders.matchesFopQueue(o, 'allocation'))!
    vi.spyOn(orders, 'getFopOrders').mockResolvedValueOnce({ source: 'mock', refreshedAt: '2026-10-24T05:30:00Z', departments: [], items: [{ ...original, shippingCountryCode: 'gb', items: [original.items[0]!, { ...original.items[0]!, sku: 'ANOTHER-SKU', name: 'Second product', variant: 'Blue / XL', quantity: 3 }] }], total: 1, page: 1, pageSize: 10, totals: { orderCount: 1, itemQuantity: 4, amountsByCurrency: [{ currency: 'USD', amount: original.amount }] } })
    const { wrapper } = await setup()
    expect(wrapper.findAll('thead th').slice(0, 2).map(th => th.text())).toEqual(['订单编号', '商品图片 / 商品信息'])
    const row = wrapper.findAll('tbody tr').find(r => r.findAll('.product').length > 1)!
    expect(row.findAll('td')[1]!.findAll('.product').length).toBeGreaterThan(1)
    expect(row.findAll('.sku-item')).toHaveLength(0)
    const products = row.findAll('.product')
    expect(products[0]!.get('.product-sku').text()).toContain(original.items[0]!.sku)
    expect(products[1]!.get('.product-name').text()).toBe('Second product')
    expect(products[1]!.get('.product-sku').text()).toBe('SKU · ANOTHER-SKU')
    expect(products[1]!.get('.product-variant').text()).toBe('Blue / XL')
    expect(row.findAll('.quantity-item')).toHaveLength(0)
    expect(products[1]!.get('.product-quantity').text()).toBe('× 3')
    expect(row.findAll('td').every(cell => !!cell.attributes('data-label'))).toBe(true)
    const headers = wrapper.findAll('thead th').map(cell => cell.text())
    expect(headers.indexOf('订单金额')).toBe(headers.indexOf('Shopify 单号') + 1)
    expect(headers.indexOf('客户名称')).toBe(headers.indexOf('店铺') - 1)
    expect(headers).not.toContain('数量')
    expect(row.get('.country-code').text()).toBe('GB')
    const number = row.find('.order-cell strong').text()
    await row.get('button.copy-order').trigger('click'); await flushPromises()
    expect(copy).toHaveBeenCalledWith(number)
    expect(wrapper.text()).toContain('订单编号已复制')
    await row.get('button.copy-customer').trigger('click'); await flushPromises()
    expect(copy).toHaveBeenLastCalledWith(original.customerName)
    expect(wrapper.text()).toContain('客户名称已复制')
    expect(wrapper.get('.task-heading-description').text()).not.toBe('')
    expect(wrapper.find('.list-heading .info-tip-trigger').exists()).toBe(false)
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
    const select = () => wrapper.get('select[aria-label="业务部门"]')
    expect(select().findAll('option').map(o => o.text())).toEqual(['营销中心', '业务一部', '业务二部'])
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
    await wrapper.get('select[aria-label="业务部门"]').setValue('d2'); await flushPromises()
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
    ['dispatch', 'dispatch', '发运单状态', 'dispatchDocumentStatus'],
    ['warehouse', 'shipping', '出库进度', 'outboundStatus'],
  ])('sorts %s/%s %s and retains filters across refresh', async (role, queue, label, field) => {
    const { wrapper, router } = await setup(`?queue=${queue}&departmentId=d1&search=DEMO`, role)
    const button = () => wrapper.get(`thead button[aria-label^="${label}："]`)
    await button().trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ sortBy: field, sortOrder: 'asc', page: '1', departmentId: 'd1', search: 'DEMO' })
    expect(button().element.closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    expect(wrapper.get('button.sort-payment').element.closest('th')?.getAttribute('aria-sort')).toBe('none')
    expect(wrapper.get('.compact-status-sort').attributes('aria-label')).toContain('当前升序')
    await wrapper.get('.compact-status-sort').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.sortOrder).toBe('desc')
    expect(button().element.closest('th')?.getAttribute('aria-sort')).toBe('descending')
    await wrapper.get('button.refresh-orders').trigger('click'); await flushPromises()
    expect(api.get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders', { params: expect.objectContaining({ sortBy: field, sortOrder: 'desc', departmentId: 'd1', search: 'DEMO' }) })
    if (queue === 'shipping') {
      expect(wrapper.find('select[aria-label="配货单状态"]').exists()).toBe(false)
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
    expect((wrapper.get('select[aria-label="业务部门"]').element as HTMLSelectElement).value).toBe('unknown')
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
    expect(wrapper.find('tfoot .quantity-total').text()).toBe('456 件')
    const headerCells = wrapper.findAll('thead th')
    const totalCells = wrapper.findAll('tfoot th, tfoot td')
    const quantityCell = totalCells.findIndex(cell => cell.classes().includes('quantity-total'))
    expect(totalCells.slice(0, quantityCell).reduce((sum, cell) => sum + Number(cell.attributes('colspan') || 1), 0)).toBe(headerCells.findIndex(cell => cell.text() === '商品图片 / 商品信息'))
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
    expect(wrapper.find('h2').text()).toContain('未齐套')
    const headers = wrapper.find('thead').text()
    for (const label of ['订单编号', 'Shopify 单号', '客户名称', '商品', '发运单状态']) expect(headers).toContain(label)
    expect(headers).toContain('发运单状态')
    for (const label of ['支付状态', '审核状态', '发运状态', '发货状态']) expect(wrapper.findAll('thead th').map(th => th.text())).not.toContain(label)
    expect(wrapper.findAll('tbody tr')).toHaveLength(6)
    expect((wrapper.get('select[aria-label="每页条数"]').element as HTMLSelectElement).value).toBe('50')
    expect(api.get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders', { params: expect.objectContaining({ page: 1, pageSize: 50 }) })
    expect(wrapper.findAll('tbody img').length).toBeGreaterThan(0)
    expect(wrapper.find('thead').text()).not.toContain('配货状态')
    expect(wrapper.find('tbody').text()).not.toContain('未齐套，未配货')
    expect(wrapper.find('tbody').text()).not.toContain('已齐套未审核')
    await wrapper.find('input[type=search]').setValue('TO261015036100')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.query.queue).toBe('allocation')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('TO261015036100')
    await router.push('/workbench/dispatch?queue=dispatch')
    await flushPromises()
    expect(wrapper.find('thead').text()).not.toContain('Shopify 履约状态')
    expect(wrapper.find('thead').text()).not.toContain('配货单状态')
    expect(wrapper.find('tbody').text()).not.toContain('TO261015036100')
    await router.push('/workbench/warehouse?queue=shipping'); await flushPromises()
    const warehouseHeaders = wrapper.findAll('thead th').map(th => th.text())
    expect(warehouseHeaders).toContain('出库进度')
    expect(warehouseHeaders).not.toContain('出库状态')
    expect(warehouseHeaders).not.toContain('支付状态')
    expect(wrapper.findAll('tfoot th, tfoot td').reduce((sum, cell) => sum + Number(cell.attributes('colspan') || 1), 0)).toBe(warehouseHeaders.length)
    for (const row of wrapper.findAll('tbody tr')) {
      expect(row.findAll('td')).toHaveLength(warehouseHeaders.length)
      expect(['待出库', '部分出库']).toContain(row.findAll('td')[warehouseHeaders.indexOf('出库进度')]!.text())
    }
    expect(wrapper.find('tbody').text()).not.toContain('已齐套未审核')
    expect(wrapper.find('thead').text()).not.toContain('配货单状态')
    expect(wrapper.find('tbody').text()).not.toContain('待配货审核')
    wrapper.unmount()
  })

  it('keeps readiness and audit facts independent, with aligned rows and totals in both allocation tabs', async () => {
    const base = mockFopOrders.find(o => orders.matchesFopQueue(o, 'allocation'))!
    const spy = vi.spyOn(orders, 'getFopOrders').mockImplementation(async query => ({
      source: 'mock', refreshedAt: new Date().toISOString(), departments: [], page: 1, pageSize: 50, total: 2,
      totals: { orderCount: 2, itemQuantity: 2, amountsByCurrency: [{ currency: 'USD', amount: 30 }] },
      items: [0, 1].map(i => ({ ...base, id: `split-${i}`, fulfillmentProgress: { ...base.fulfillmentProgress, stockReadiness: query.queue === 'allocation' ? 'incomplete' : 'ready', allocationReview: 'pending' } })),
    }))
    const { wrapper, router } = await setup()
    for (const queue of ['allocation', 'allocation_review']) {
      await router.push(`/workbench/allocation?queue=${queue}`); await flushPromises()
      const headers = wrapper.findAll('thead th').map(th => th.text())
      expect(headers.slice(headers.indexOf('发运单编号'), headers.indexOf('发运单编号') + 4)).toEqual(['发运单编号', '发运单状态', '客户名称', '店铺'])
      expect(wrapper.find('details').exists()).toBe(false)
      expect(headers).toContain('Customer')
      expect(headers).not.toContain('本地 SKU / 规格')
      const rows = wrapper.findAll('tbody tr')
      rows.forEach(row => {
        const cells = row.findAll('td')
        expect(cells).toHaveLength(headers.length)
        expect(headers).not.toContain('配货状态')
        expect(headers).not.toContain('配货单状态')
      })
      expect(wrapper.findAll('tfoot tr').at(-1)!.findAll('th,td').reduce((sum, cell) => sum + Number(cell.attributes('colspan') || 1), 0)).toBe(headers.length)
    }
    wrapper.unmount(); spy.mockRestore()
  })

  it('keeps legacy pending-review warehouse links empty and offers an explicit reset', async () => {
    const { wrapper, router } = await setup('?queue=shipping&departmentId=d1&warehouseStage=pending_review', 'warehouse')
    expect(wrapper.find('select[aria-label="配货单状态"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('已齐套未审核已归入配货工作台')
    expect(wrapper.find('tbody').text()).toContain('暂无符合条件的订单')
    await wrapper.get('.read-only-note button').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.warehouseStage).toBeUndefined()
    expect(wrapper.find('thead').text()).not.toContain('配货单状态')
    await router.push('/workbench/warehouse?queue=shipping&warehouseStage=bad'); await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('配货单状态筛选无效')
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
    expect(wrapper.find('tbody').text()).not.toContain('TO261015036100')
    wrapper.unmount()
    spy.mockRestore()
  })
})
