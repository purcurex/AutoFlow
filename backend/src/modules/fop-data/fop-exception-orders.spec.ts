import { FopDataService } from './fop-data.service'
import { DemoFopDataProvider } from './fop-demo.provider'
import type { FopOrderCandidate } from './fop-data.types'
import { UsersService } from '../users/users.service'
import { UserRole } from '../users/user.entity'

const workspace = {
  nodes: [
    { id: 'org-1', name: 'HyperZone', kind: 'organization' as const, parentId: null, sortOrder: 0 },
    { id: 'marketing', name: '营销中心', kind: 'department' as const, parentId: 'org-1', sortOrder: 0 },
    { id: 'sales-1', name: '业务一部', kind: 'department' as const, parentId: 'marketing', sortOrder: 0 },
  ],
  employees: [{ id: 'employee-1', name: '测试业务员', code: 'EMP001', email: 'employee@example.test',
    departmentId: 'sales-1', workbenchRoles: ['sales'] }],
}
const users = { findById: async (id: string) => ({ id, role: UserRole.ADMIN, businessRole: 'admin',
  businessEmployeeId: null, fopTenantId: null, fopUserId: null, workbenchRoles: ['sales'] }) } as unknown as UsersService

/** 仅替换授权演示订单的事实，调用真实后端清单入口验证过滤、分页和汇总。 */
function setup(overrides: Partial<FopOrderCandidate>[]) {
  const provider = new DemoFopDataProvider({ getWorkspace: async () => workspace }, { FOP_DATA_MODE: 'demo', NODE_ENV: 'development' })
  const original = provider.listOrders.bind(provider)
  jest.spyOn(provider, 'listOrders').mockImplementation(async (...args) => {
    const rows = await original(...args)
    return overrides.map((override, index) => ({ ...rows[index], paymentStatus: 'paid', cancelled: false,
      shippingStatus: 'pending', amount: 10, currency: 'USD',
      exception: { type: 'allocation_exception', reason: '库存不足', hours: 4 },
      ...override,
      fulfillmentProgress: { ...rows[index].fulfillmentProgress, outbound: 'pending', ...override.fulfillmentProgress },
    } as FopOrderCandidate))
  })
  return new FopDataService(users, provider)
}

const progress = (outbound: FopOrderCandidate['fulfillmentProgress']['outbound']) => ({
  allocationCreated: true, shopifySync: 'pending' as const, supplierShipment: 'unknown' as const,
  stockReadiness: 'incomplete' as const, allocationReview: 'pending' as const, outbound,
})

describe('异常订单清单业务范围由AutoFlow后端计算', () => {
  const query = { queue: 'exceptions' as const, page: 1, pageSize: 20 }

  it.each([
    ['未付款', { paymentStatus: 'unpaid' }],
    ['已退款', { paymentStatus: 'refunded' }],
    ['已取消', { cancelled: true }],
    ['全部出库', { fulfillmentProgress: progress('completed') }],
    ['已全部发货但残留异常', { shippingStatus: 'shipped' }],
    ['无异常', { exception: null }],
  ] as [string, Partial<FopOrderCandidate>][])('排除%s订单，数量和金额均不计入', async (_name, override) => {
    const result = await setup([override]).getOrders('exception-test', query)
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(result.totals.orderCount).toBe(0)
    expect(result.totals.amountsByCurrency).toEqual([])
  })

  it.each(['pending', 'partial'] as const)('保留已付款、%s出库且有异常的订单', async outbound => {
    const result = await setup([{ fulfillmentProgress: progress(outbound) }]).getOrders('exception-test', query)
    expect(result.total).toBe(1)
    expect(result.items[0].exception?.reason).toBe('库存不足')
  })

  it('先按异常业务范围过滤再分页，合计覆盖全部筛选结果', async () => {
    const service = setup([
      { paymentStatus: 'unpaid' },
      { amount: 12.34 },
      { fulfillmentProgress: progress('completed') },
      { amount: 23.45, fulfillmentProgress: progress('partial') },
    ])
    const first = await service.getOrders('exception-test', { ...query, pageSize: 1 })
    const second = await service.getOrders('exception-test', { ...query, page: 2, pageSize: 1 })
    expect(first.total).toBe(2)
    expect(second.total).toBe(2)
    expect(first.items).toHaveLength(1)
    expect(second.items).toHaveLength(1)
    expect(first.items[0].id).not.toBe(second.items[0].id)
    expect(first.totals.amountsByCurrency).toEqual([{ currency: 'USD', amount: 35.79 }])
    expect(second.totals).toEqual(first.totals)
  })
})
