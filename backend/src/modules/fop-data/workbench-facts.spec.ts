import { KingdeeFopDataProvider } from './fop-kingdee.provider'
import { FopDataService } from './fop-data.service'
import type { FopOrderPageQuery } from './fop-data.types'
import type { User } from '../users/user.entity'
import { UserRole } from '../users/user.entity'
import { UsersService } from '../users/users.service'
import type { ListFulfillmentOrdersDto } from '../users/dto/workbench.dto'
import { projectWorkbenchFacts } from './workbench-facts-projector'
import { synchronized, type Fact } from './workbench-facts'
import * as ExcelJS from 'exceljs'

const identity = { tenantId: 'raw-test', userId: '100' }
const scope = { role: 'admin' as const, employeeId: null, departmentId: null }
const ref = (id: string, name = `name-${id}`) => ({ id, name, number: `code-${id}` })
const now = () => new Date(Date.now() - 60_000).toISOString()
const line = (id = '10011', qty = '2', sku = '601', seq = '1'): Fact => ({ id, seq, pid: '0', hzkj_qty: qty,
  hzkj_local_sku: { ...ref(sku), hzkj_sku_values: { name: 'variant' } }, hzkj_purcqty: '0', hzkj_use_stock: '0' })
const order = (id = '1001', extra: Fact = {}): Fact => ({ id, billno: `SO${id}`, billstatus: 'C', createtime: now(), auditdate: now(),
  hzkj_sourceid: `platform-${id}`, hzkj_source_number: `#${id}`, hzkj_org: ref('10'), hzkj_dept: ref('400'), hzkj_operator: ref('501'),
  departmentPathIds: ['10', '400'], hzkj_use_status: '1', hzkj_orderstatus: '2', hzkj_receipt_status: '1',
  hzkj_billtype: { number: 'hzkj_orders_BT' }, hzkj_delivery_status: '0', hzkj_refund_status: 'none', hzkj_addr_check_status: 'B',
  hzkj_order_amount: '12.34', hzkj_currency: { number: 'USD' }, hzkj_receipt_date: now(), hzkj_datetimefield: now(),
  hzkj_customer: ref('200'), hzkj_shop: ref('300'), hzkj_dst_warehouse: ref('500'), hzkj_country: { twocountrycode: 'CA' },
  hzkj_orders_billentry: [line(`${id}1`)], hzkj_logistics_info: [{ hzkj_combofield: '1' }], ...extra })
const doc = (id: string, extra: Fact = {}): Fact => ({ id, billno: `DOC${id}`, organizationId: '10', ...extra })
const dispatch = (id = '801', extra: Fact = {}): Fact => doc(id, { createtime: now(), auditdate: now(), billstatus: 'C', hzkj_order_no: 'SO1001',
  hzkj_customer: ref('200'), hzkj_platform_orderid: 'platform-1001', hzkj_src_package: '1', hzkj_delivery_status: 'READY',
  hzkj_upload_no: true, hzkj_logistics_orderno: 'HEAD', hzkj_logistics_trackno: 'TAIL', ...extra })
const allocation = (state = 'pending', status = 'B', extra: Fact = {}): Fact => doc('701', { billstatus: status,
  hzkj_order_id: '1001', hzkj_order_no: 'SO1001', hzkj_pkg_no: '1', hzkj_warehouse: ref('500'), hzkj_alloc_status: state, hzkj_complete_time: now(),
  hzkj_alloc_entry: [{ id: '711', hzkj_src_entry_number: '10011', hzkj_sku: ref('601'), hzkj_req_qty: '2', hzkj_cust_occ_qty: '0', hzkj_common_occ_qty: '0' }], ...extra })
const product = (id = '601') => ({ id, organizationId: null, hzkj_good: { hzkj_good_carrier: '1', hzkj_goodtype: { number: 'physical' } } })
const facts = (extra: Fact = {}): Fact => ({ dispatches: [], allocations: [], deliveryNotices: [], outbounds: [], freightIssues: [], inventoryPools: [],
  products: [product()], applications: [], purchases: [], receiptNotices: [], applicationLinks: {}, purchaseLinks: {}, receiptLinks: {}, ...extra })
const purchase = (extra: Fact = {}): Fact => doc('901', { billstatus: 'C', hzkj_purchase_channel: '1', hzkj_paystatus: 'C', hzkj_pay_status: '1',
  hzkj_pay_time: now(), hzkj_supplier: ref('71'), hzkj_1688_order_n: '1688-901', hasAlibabaOffer: true,
  hzkj_billentry: [{ id: '911', hzkj_salbillentryid: '10011', hzkj_qty: '2' }], ...extra })
const notice = () => doc('851', { billno: 'NOTICE851', hzkj_deliver_billno: 'DOC801', hzkj_is_push: '1', hzkj_bill_create_time: now() })
const outbound = (qty: string, extra: Fact = {}) => doc('861', { billstatus: 'C', auditdate: now(), biztype: { number: '100' },
  billentry: [{ id: '871', srcbillnumber: 'NOTICE851', hzkj_entry_billno: 'SO1001', sourceEntryId: '10011', hzkj_local_sku: ref('601'), qty }], ...extra })
const rawQuery = (queue: ListFulfillmentOrdersDto['queue'], completed = false): ListFulfillmentOrdersDto => ({ queue, page: 1, pageSize: 20, ...(completed ? { completed, timeRange: '1w' } : {}) })
const project = (items: Fact[], data: Fact, query = rawQuery('exceptions')) => projectWorkbenchFacts(items, data, ['10'], scope, query, { '500': 'HZ' })

/** 以真实适配器和服务入口串联：上游只按主键游标给事实，业务筛选、分页、金额合计均在BFF。 */
function setup(pages: { items: Fact[]; facts: Fact }[], transform?: (value: Record<string, unknown>, page: number) => unknown) {
  const settings: Record<string, string> = { FOP_KINGDEE_WORKBENCH_FACTS_MODE: 'raw', FOP_KINGDEE_QUERY_URL: 'https://example.test/query',
    FOP_KINGDEE_SUMMARY_URL: 'https://example.test/summary', FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL: 'https://example.test/permissions',
    FOP_KINGDEE_TENANT_ID: identity.tenantId, FOP_KINGDEE_USER_ID: identity.userId, FOP_KINGDEE_ORGANIZATION_IDS: '10',
    FOP_KINGDEE_ACCESS_TOKEN: 'fixture', FOP_KINGDEE_IDENTITY: 'fixture', FOP_KINGDEE_WAREHOUSE_MAP: '{"500":"HZ"}' }
  const request = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const q = JSON.parse(String(init?.body)).query
    const p = pages[q.page - 1]
    const value = String(url).endsWith('/permissions') ? { subject: identity, grants: { orders: ['10'], receipts: [], registrations: [], freight: [] }, orderQueues: ['unpaid', 'review', 'dispatch'] }
      : transform?.({ subject: identity, organizationIds: ['10'], workbenchFactsSchemaVersion: 1, queue: q.queue, page: q.page, pageSize: q.pageSize,
        hasMore: q.page < pages.length, nextAfterOrderId: p.items.slice(-1)[0]?.id ?? null,
        departments: [ref('400')], ...p }, q.page) ?? { subject: identity, organizationIds: ['10'], workbenchFactsSchemaVersion: 1,
        queue: q.queue, page: q.page, pageSize: q.pageSize, hasMore: q.page < pages.length, nextAfterOrderId: p.items.slice(-1)[0]?.id ?? null, departments: [ref('400')], ...p }
    return new Response(JSON.stringify({ status: true, errorCode: '0', data: value }))
  })
  const provider = new KingdeeFopDataProvider({ get: key => settings[key] }, request)
  const user = { id: 'raw-user', role: 'admin', businessRole: 'admin', businessDepartmentId: null, businessEmployeeId: null,
    workbenchRoles: ['sales', 'procurement', 'allocation', 'dispatch', 'warehouse'], fopTenantId: identity.tenantId, fopUserId: identity.userId,
    fopBindingDetails: { username: 'fixture', name: 'fixture', employeeRecordId: '100', employeeMasterId: '100', departmentId: '400', organizationId: '10',
      localEmployeeId: null, localDepartmentId: null, verifiedAt: now() } } as User
  const users = { findById: jest.fn().mockImplementation(async () => user) } as unknown as UsersService
  return { provider, request, user, service: new FopDataService(users, provider) }
}

describe('原始事实模式覆盖11个清单', () => {
  const synced = () => dispatch('801', { hzkj_delivery_status: 'FULFILLED', checkpoint: { tracking: 'HEAD', fulfillmentId: 'f1' } })
  it.each([
    ['unpaid', false, () => order('1001', { hzkj_orderstatus: '1', hzkj_receipt_status: '0', billstatus: 'B' }), () => facts()],
    ['review', false, () => order('1001', { billstatus: 'B' }), () => facts()],
    ['exceptions', false, () => order('1001', { hzkj_addr_check_status: 'C' }), () => facts()],
    ['procurement', false, () => order(), () => facts()],
    ['procurement_shipping', false, () => order(), () => facts({ purchases: [purchase()] })],
    ['allocation', false, () => order(), () => facts({ allocations: [allocation()] })],
    ['allocation_review', false, () => order(), () => facts({ allocations: [allocation('completed')] })],
    ['dispatch', false, () => order(), () => facts()],
    ['dispatch', true, () => order(), () => facts({ dispatches: [synced()] })],
    ['shipping', false, () => order(), () => facts({ allocations: [allocation('completed', 'C')] })],
    ['shipping', true, () => order(), () => facts({ allocations: [allocation('completed', 'C')], dispatches: [dispatch()], deliveryNotices: [notice()], outbounds: [outbound('2')] })],
  ] as const)('%s清单（completed=%s）由真实BFF入口返回', async (queue, completed, makeOrder, makeFacts) => {
    const { service, request, user } = setup([{ items: [makeOrder()], facts: makeFacts() }])
    const result = await service.getOrders(user.id, rawQuery(queue, completed))
    expect(result.total).toBe(1)
    expect(result.items[0].id).toBe('1001')
    expect(result.totals.orderCount).toBe(1)
    const upstream = request.mock.calls.filter(([url]) => String(url).endsWith('/query')).map(([, init]) => JSON.parse(String(init?.body)).query)
    expect(upstream[0]).toMatchObject({ rawWorkbenchFacts: true, pageSize: 100 })
    expect(upstream[0].completed).toBeUndefined()
  })
  it('完整读取候选后过滤、排序与分页，两个页面合计相同', async () => {
    const { service, user, request } = setup([
      { items: [order('1001', { billstatus: 'B' }), order('1002')], facts: facts() },
      { items: [order('1003', { billstatus: 'B', hzkj_order_amount: '23.45' })], facts: facts() },
    ])
    const first = await service.getOrders(user.id, { ...rawQuery('review'), pageSize: 1, sortBy: 'paidAt', sortOrder: 'asc' })
    const second = await service.getOrders(user.id, { ...rawQuery('review'), page: 2, pageSize: 1, sortBy: 'paidAt', sortOrder: 'asc' })
    expect(first.total).toBe(2); expect(second.total).toBe(2)
    expect(first.items[0].id).not.toBe(second.items[0].id)
    expect(first.totals).toEqual(second.totals)
    expect(first.totals.amountsByCurrency).toEqual([{ currency: 'USD', amount: 35.79 }])
    expect(request.mock.calls.some(([, init]) => JSON.parse(String(init?.body)).query.afterOrderId === '1002')).toBe(true)
  })
  it('部门、业务员、仓库、国家和关键字筛选在同一完整集合上生效', async () => {
    const { service, user } = setup([{ items: [order('1001', { billstatus: 'B' }), order('1002', { billstatus: 'B', hzkj_country: { twocountrycode: 'AU' } })], facts: facts() }])
    expect((await service.getOrders(user.id, { ...rawQuery('review'), departmentId: '10', ownerId: '501', warehouseCode: 'HZ', shippingCountryCode: 'CA', search: '#1001' })).total).toBe(1)
    expect((await service.getOrders(user.id, { ...rawQuery('review'), ownerId: '999' })).total).toBe(0)
  })
  it.each(['schema', 'subject', 'organization', 'cursor'] as const)('拒绝%s不一致，不返回部分成功的合计', async kind => {
    const { provider } = setup([{ items: [order()], facts: facts() }], value => ({ ...value,
      ...(kind === 'schema' ? { workbenchFactsSchemaVersion: 0 } : kind === 'subject' ? { subject: { ...identity, userId: '101' } }
        : kind === 'organization' ? { organizationIds: ['20'] } : { hasMore: true, nextAfterOrderId: '99' }) }))
    await expect(provider.readWorkbenchOrders(identity, { subject: identity, allowedOrderIds: [], orderQuery: { queues: ['review'], organizationIds: ['10'] } }, scope, rawQuery('review'))).rejects.toThrow()
  })
  it('角色无权时不访问业务事实接口', async () => {
    const { user, service, request } = setup([{ items: [order()], facts: facts() }]); user.workbenchRoles = ['sales']; user.role = UserRole.USER; user.businessRole = 'salesperson'; user.businessEmployeeId = '501'
    await expect(service.getOrders(user.id, rawQuery('shipping'))).rejects.toThrow('Workbench access denied')
    expect(request).not.toHaveBeenCalled()
  })
  it('导出复用全部候选的筛选结果，下载前重读范围，不受当前显示分页影响', async () => {
    const { service, user } = setup([
      { items: [order('1001', { billstatus: 'B' })], facts: facts() },
      { items: [order('1002', { billstatus: 'B' })], facts: facts() },
    ])
    const buffer = await service.exportOrders(user.id, { queue: 'review', mode: 'filtered' }, 0)
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const serialized = JSON.stringify(workbook.getWorksheet('订单清单')!.getSheetValues())
    expect(serialized).toContain('SO1001'); expect(serialized).toContain('SO1002')
    await expect(service.exportOrders(user.id, { queue: 'review', mode: 'selected', orderIds: ['999'] }, 0)).rejects.toMatchObject({ status: 409, response: { code: 'export_selection_changed' } })
  })
})

describe('跨单据归类和数量边界', () => {
  it('已发运必须覆盖全部期望包裹；旧失败被同包裹最新成功替换', () => {
    const data = facts({ dispatches: [dispatch('800', { createtime: '2026-01-01T00:00:00Z', hzkj_delivery_status: 'SYNC_FAILED' }),
      dispatch('801', { hzkj_delivery_status: 'FULFILLED', checkpoint: { tracking: 'HEAD', fulfillmentId: 'f1' } })] })
    expect(project([order()], data, rawQuery('dispatch', true)).orders[0].dispatchTaskStatus).toBe('dispatch_synced')
    expect(project([order('1001', { hzkj_logistics_info: [{ hzkj_combofield: '1' }, { hzkj_combofield: '2' }] })], data, rawQuery('dispatch')).orders[0].dispatchTaskStatus).toBe('dispatch_missing')
    expect(project([order()], data).orders[0].exception).toBeNull()
  })
  it('损坏的部分履约ID、待尾程及没有物流号都不伪装完成/异常', () => {
    const bill = dispatch('801', { hzkj_delivery_status: 'FULFILLED', checkpoint: { tracking: 'HEAD', partialFulfillmentIds: ['f1', null] } })
    expect(synchronized(bill)).toBe(false)
    expect(project([order()], facts({ dispatches: [dispatch('801', { hzkj_delivery_status: 'WAITING_LAST_MILE', checkpoint: { waitingLastMile: true } })] })).orders[0].exception).toBeNull()
  })
  it.each(['A', 'B', 'D'])('地址状态%s不作为当前失败，历史异常通知不代表仍未解决', status => {
    expect(project([order('1001', { hzkj_addr_check_status: status })], facts({ freightIssues: [doc('991', { hzkj_issue_detail: 'history', hzkj_send_status: '1' })] })).orders[0].exception).toBeNull()
  })
  it('异常可以按次级原因筛选；缺少首次发生时间时输出null而非订单创建时刻', async () => {
    const { service, user } = setup([{ items: [order('1001', { hzkj_addr_check_status: 'C' })], facts: facts({ dispatches: [dispatch('801', { hzkj_delivery_status: 'SYNC_FAILED' })] }) }])
    const result = await service.getOrders(user.id, { ...rawQuery('exceptions'), taskStatus: 'dispatch_exception' })
    expect(result.total).toBe(1)
    expect(result.items[0].exception).toMatchObject({ hours: null, types: ['address_exception', 'dispatch_exception'] })
  })
  it('同物料多个SKU合并库存需求，不重复使用一份余额', () => {
    const row = order('1001', { hzkj_orders_billentry: [line('10011', '2'), line('10012', '2', '602', '2')] })
    const alloc = allocation('pending', 'B', { hzkj_alloc_entry: [
      { id: '711', hzkj_src_entry_number: '10011', hzkj_sku: ref('601'), hzkj_req_qty: '2' },
      { id: '712', hzkj_src_entry_number: '10012', hzkj_sku: ref('602'), hzkj_req_qty: '2' },
    ] })
    const inventoryPools = ['601', '602'].flatMap(sku => [{ id: `${sku}:500:200`, materialId: '9001', onHand: '3', occupied: '0' }, { id: `${sku}:500:0`, materialId: '9001', onHand: '0', occupied: '0' }])
    expect(project([row], facts({ allocations: [alloc], inventoryPools })).orders[0].exception).toMatchObject({ type: 'stock_exception', affectedSkus: ['code-601', 'code-602'] })
  })
  it('释放后的占用、已出库数量和其他订单占用共同参与真实缺货判断', () => {
    const alloc = allocation('pending', 'B', { hzkj_alloc_entry: [{ id: '711', hzkj_src_entry_number: '10011', hzkj_sku: ref('601'), hzkj_req_qty: '2', hzkj_cust_occ_qty: '2' }] })
    const data = facts({ allocations: [alloc], dispatches: [dispatch()], deliveryNotices: [notice()], outbounds: [outbound('1')],
      inventoryPools: [{ id: '601:500:200', materialId: '9001', onHand: '1', occupied: '1' }, { id: '601:500:0', materialId: '9001', onHand: '-1', occupied: '0' }] })
    expect(project([order()], data).orders[0].exception).toBeNull()
  })
  it('配货单记录原始占用，已经出库消耗的部分不能再次加回可用库存', () => {
    const alloc = allocation('completed', 'C', { hzkj_alloc_entry: [{ id: '711', hzkj_src_entry_number: '10011', hzkj_sku: ref('601'), hzkj_req_qty: '2', hzkj_cust_occ_qty: '2' }] })
    const data = facts({ allocations: [alloc], dispatches: [dispatch()], deliveryNotices: [notice()], outbounds: [outbound('1')],
      inventoryPools: [{ id: '601:500:200', materialId: '9001', onHand: '0', occupied: '1' }, { id: '601:500:0', materialId: '9001', onHand: '0', occupied: '0' }] })
    expect(project([order()], data).orders[0].exception?.types).toContain('stock_exception')
  })
  it('同SKU不同来源行精确匹配，十进制包裹数量相加不超量', () => {
    const a = allocation('completed', 'C', { hzkj_alloc_entry: [{ id: '711', hzkj_src_entry_number: '10011', hzkj_sku: ref('601'), hzkj_req_qty: '0.1' }] })
    const b = allocation('completed', 'C', { id: '702', hzkj_pkg_no: '2', hzkj_alloc_entry: [{ id: '712', hzkj_src_entry_number: '10011', hzkj_sku: ref('601'), hzkj_req_qty: '0.2' }] })
    const value = project([order('1001', { hzkj_orders_billentry: [line('10011', '0.3'), line('10012', '5', '601', '2')] })], facts({ allocations: [a, b] }), rawQuery('shipping')).orders[0]
    expect(value.items.map(row => [row.id, row.quantity])).toEqual([['10011', 0.3]])
    expect(value.allocationDocuments).toHaveLength(2)
    expect(() => project([order('1001', { hzkj_orders_billentry: [line('10011', '9007199254740992')] })], facts(), rawQuery('review'))).toThrow('quantity overflow')
  })
  it('分批出库到达需求时才完成，完成时间取累计足量的审核事件', () => {
    const first = outbound('0.1', { id: '861', auditdate: '2026-01-01T00:00:00Z' }), second = outbound('0.2', { id: '862', auditdate: now() })
    const alloc = allocation('completed', 'C', { hzkj_alloc_entry: [{ id: '711', hzkj_src_entry_number: '10011', hzkj_sku: ref('601'), hzkj_req_qty: '0.3' }] })
    const data = facts({ allocations: [alloc], dispatches: [dispatch()], deliveryNotices: [notice()], outbounds: [first] })
    expect(project([order()], data, rawQuery('shipping')).orders[0].fulfillmentProgress.outbound).toBe('partial')
    data.outbounds = [first, second]
    expect(project([order()], data, rawQuery('shipping')).orders).toEqual([])
    expect(project([order()], data, rawQuery('shipping', true)).orders[0].outboundCompletedAt).toBe(second.auditdate)
  })
  it('来源无法确认时输出诊断，SKU冲突、重复包裹及超量不能静默合并', () => {
    const mismatch = allocation('pending', 'B', { hzkj_alloc_entry: [{ id: '711', hzkj_src_entry_number: 'missing', hzkj_sku: ref('601'), hzkj_req_qty: '2' }] })
    expect(project([order()], facts({ allocations: [mismatch] }), rawQuery('allocation')).orders[0].allocationIssues?.[0].code).toBe('ALLOCATION_SOURCE_UNRESOLVED')
    expect(() => project([order()], facts({ allocations: [allocation(), allocation('pending', 'B', { id: '702' })] }), rawQuery('allocation'))).toThrow('Ambiguous allocation')
    expect(() => project([order('1001', { hzkj_orders_billentry: [line('10011', '1')] })], facts({ allocations: [allocation()] }), rawQuery('allocation'))).toThrow('exceeds')
    expect(() => project([order()], facts({ allocations: [allocation('completed', 'C')], dispatches: [dispatch()], deliveryNotices: [notice()], outbounds: [outbound('2', { billentry: [{ id: '871', srcbillnumber: 'NOTICE851', hzkj_entry_billno: 'SO1001', sourceEntryId: '10011', hzkj_local_sku: ref('999'), qty: '2' }] })] }), rawQuery('shipping'))).toThrow('Outbound source mismatch')
  })
  it('同张采购单多个来源行只合并单头，线下未知发货量保持null', async () => {
    const row = order('1001', { hzkj_orders_billentry: [line(), line('10012', '3', '601', '2')] })
    const po = purchase({ hzkj_purchase_channel: '2', hzkj_1688_order_n: null, hzkj_billentry: [{ id: '911', hzkj_salbillentryid: '10011', hzkj_qty: '2' }, { id: '912', hzkj_salbillentryid: '10012', hzkj_qty: '3' }] })
    const { service, user } = setup([{ items: [row], facts: facts({ purchases: [po] }) }])
    const groups = await service.getPurchaseGroups(user.id, { queue: 'procurement_shipping', page: 1, pageSize: 20 })
    expect(groups.total).toBe(1); expect(groups.items[0].quantity).toBe(5); expect(groups.items[0].shippedQuantity).toBeNull()
  })
  it('采购申请覆盖与剩余未申请需求分开计算，取消单不占需求', () => {
    const data = facts({ applications: [doc('921', { billstatus: 'B', entryentity: [{ id: '931', hzkj_srcbillnumber: 'SO1001', hzkj_srcbillentryseq: '1', hzkj_applyqty: '1' }] })], purchases: [purchase({ hzkj_cancelstatus: 'B' })] })
    expect(project([order()], data, rawQuery('procurement')).links[0].obligations?.[0].lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ quantity: 1, demandStage: 'application_pending' }), expect.objectContaining({ quantity: 1, demandStage: 'purchase_order_pending' })]))
  })
  it('1688已发根据实际采购来源和包裹计量，拒绝无来源、重复包裹及超发', () => {
    const receipt = doc('941', { hzkj_1688_order_n: '1688-901', hzkj_logistics_number: 'PKG', entryentity: [{ id: '951', hzkj_srcbillentity: 'hzkj_purorderbill', hzkj_srcbillentryid: '911', hzkj_qty: '1' }] })
    const data = facts({ purchases: [purchase()], receiptNotices: [receipt] })
    expect(project([order()], data, rawQuery('procurement_shipping')).links[0].obligations?.[0].lines[0].shippedQuantity).toBe(1)
    expect(() => project([order()], facts({ purchases: [purchase()], receiptNotices: [receipt, { ...receipt, id: '942' }] }), rawQuery('procurement_shipping'))).toThrow('Duplicate supplier')
    expect(() => project([order()], facts({ purchases: [purchase()], receiptNotices: [{ ...receipt, entryentity: [{ id: '951', hzkj_qty: '1' }] }] }), rawQuery('procurement_shipping'))).toThrow('Missing supplier')
  })
  it('原始数据与关联单据均校验组织；经理只能读取已授权部门路径', () => {
    expect(() => project([order('1001', { hzkj_org: ref('20') })], facts())).toThrow('scope mismatch')
    expect(() => project([order()], facts({ dispatches: [dispatch('801', { organizationId: '20' })] }))).toThrow('scope mismatch')
    expect(() => projectWorkbenchFacts([order()], facts(), ['10'], { role: 'department_manager', departmentId: '999', employeeId: null }, rawQuery('exceptions'), {})).toThrow('outside workbench')
  })
})
