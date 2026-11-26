import { User, UserRole } from './user.entity'
import { CHART_IDS, ChartPermissionOverride, resolveChartAccess, resolveChartSummaryPolicy, validateChartPermissions } from './chart-permissions'

const account = (extra: Partial<User> = {}): User => ({
  role: UserRole.USER, businessRole: 'salesperson', businessDepartmentId: 'sales1',
  businessEmployeeId: 'alice', workbenchRoles: ['sales'], chartPermissions: [], ...extra,
} as User)
const override = (extra: Partial<ChartPermissionOverride> = {}): ChartPermissionOverride => ({
  chartId: 'customer_orders', visibility: 'inherit', dataScope: 'inherit', summaryMode: 'inherit',
  summaryDepartments: [], details: 'inherit', export: 'inherit', ...extra,
})
const access = (user: User, chartId: string) => resolveChartAccess(user).find(chart => chart.chartId === chartId)

describe('account chart policy', () => {
  it('allows department aggregates without record analytics even with company-wide order access', () => {
    const user = account({ businessRole: 'admin', chartPermissions: [override({ chartId: 'order_volume', dataScope: 'none' as never, summaryMode: 'marketing', details: 'allow' })] })
    expect(validateChartPermissions(user.chartPermissions)).toBe(true)
    expect(access(user, 'order_volume')).toMatchObject({ visible: true, dataScope: 'none', summaryOnly: true, canViewDetails: false, summaryDepartments: ['sales1', 'sales2', 'sales3', 'sales4'] })
  })
  it('keeps salespeople on their own records and does not fabricate department totals', () => {
    expect(access(account(), 'customer_orders')).toMatchObject({ visible: true, dataScope: 'self', canViewDetails: true, summaryDepartments: [] })
    expect(access(account(), 'department_receipts')).toMatchObject({ visible: false, dataScope: 'none', canViewDetails: false })
    expect(access(account(), 'registrations')).toMatchObject({ visible: true, dataScope: 'self', summaryOnly: false })
  })

  it('管理员统一全部部门，业务员仅本人，非管理员未开通业务的账号继续关闭', () => {
    expect(access(account({ role: UserRole.ADMIN }), 'freight')?.dataScope).toBe('all')
    expect(access(account(), 'freight')).toMatchObject({visible:false,dataScope:'none',canViewDetails:false,canExport:false})
    expect(resolveChartAccess(account({ businessRole: 'none', chartPermissions: [override({ visibility: 'allow' })] })).every(chart => !chart.visible && chart.dataScope === 'none' && !chart.canExport)).toBe(true)
  })

  it.each(['none', 'salesperson'] as const)('system administrators ignore legacy %s and chart restrictions without widening nonadmins', businessRole => {
    const user = account({ role: UserRole.ADMIN, businessRole, workbenchRoles: [], chartPermissions: CHART_IDS.map(chartId => override({ chartId, visibility: 'deny', dataScope: 'none', summaryMode: 'none', details: 'deny', export: 'deny' })) })
    const charts = resolveChartAccess(user)
    expect(charts.every(chart => chart.visible && chart.canExport)).toBe(true)
    expect(charts.filter(chart => chart.chartId !== 'department_receipts').every(chart => chart.dataScope === 'all')).toBe(true)
    expect(charts.find(chart => chart.chartId === 'customer_orders')?.canViewDetails).toBe(true)
    expect(resolveChartSummaryPolicy(user, 'order_volume')).toEqual({ mode: 'marketing', departments: [] })
    user.role = UserRole.USER
    expect(resolveChartAccess(user).every(chart => !chart.visible && !chart.canExport)).toBe(true)
  })

  it('defaults managers to department records and summaries while administrators retain tenant scope', () => {
    const manager = account({ businessRole: 'department_manager', dataDisplayScope: 'department' as const })
    expect(access(manager, 'customer_orders')).toMatchObject({ dataScope: 'department' })
    expect(access(manager, 'department_receipts')).toMatchObject({ visible: true, dataScope: 'none', summaryOnly: true, canViewDetails: false, summaryDepartments: ['sales1', 'sales2', 'sales3', 'sales4'] })
    expect(resolveChartSummaryPolicy(manager, 'department_receipts')).toEqual({ mode: 'marketing', departments: [] })
    const admin = account({ businessRole: 'admin', workbenchRoles: [] })
    expect(access(admin, 'customer_orders')).toMatchObject({ visible: true, dataScope: 'all' })
    expect(access(admin, 'department_receipts')?.summaryDepartments).toEqual(['sales1', 'sales2', 'sales3', 'sales4'])
  })

  it('uses department UUIDs for manager policy and leaves hierarchy validation to the local directory', () => {
    const manager = account({ businessRole: 'department_manager', dataDisplayScope: 'department' as const, businessDepartmentId: 'department-uuid' })
    expect(resolveChartSummaryPolicy(manager, 'registrations')).toEqual({ mode: 'marketing', departments: [] })
    expect(access(manager, 'department_receipts')?.summaryDepartments).toEqual(['sales1','sales2','sales3','sales4'])
  })

  it('narrows manager record access to self while authorized peer summaries remain available', () => {
    const user = account({ businessRole: 'department_manager', dataDisplayScope: 'department' as const, chartPermissions: [override({ chartId: 'order_volume', dataScope: 'self', details: 'deny', export: 'deny' })] })
    expect(access(user, 'order_volume')).toMatchObject({ visible: true, dataScope: 'self', canViewDetails: false, canExport: false, summaryDepartments: ['sales1', 'sales2', 'sales3', 'sales4'] })
    expect(access(user, 'customer_orders')?.dataScope).toBe('department')
  })

  it('does not expand a salesperson to department scope through an allow override', () => {
    expect(access(account({ chartPermissions: [override({ visibility: 'allow', dataScope: 'department' })] }), 'customer_orders')?.dataScope).toBe('self')
  })

  it('keeps missing employee bindings empty when a manager narrows to self', () => {
    const user = account({ businessRole: 'department_manager', dataDisplayScope: 'department' as const, businessEmployeeId: null, chartPermissions: [override({ dataScope: 'self', visibility: 'allow' })] })
    expect(access(user, 'customer_orders')).toMatchObject({ visible: true, dataScope: 'none', summaryOnly: true, canViewDetails: false })
  })

  it('业务员不能通过指定部门汇总读取其他人员的数据', () => {
    const user = account({ chartPermissions: [override({ chartId: 'department_receipts', summaryMode: 'selected', summaryDepartments: ['sales2', 'sales4'], details: 'allow' })] })
    expect(access(user, 'department_receipts')).toMatchObject({ visible: false, dataScope: 'none', summaryDepartments: [] })
    expect(access(user, 'customer_orders')?.dataScope).toBe('self')
  })

  it('managers retain department charts even with personal lists, with independent peer summaries', () => {
    const manager=account({businessRole:'department_manager',dataDisplayScope:'self'})
    for(const chartId of ['registrations','salesperson_receipts','order_volume','customer_orders']) {
      expect(access(manager,chartId)).toMatchObject({dataScope:'department',summaryOnly:false,summaryDepartments:['sales1','sales2','sales3','sales4']})
    }
    expect(access(manager,'freight')?.visible).toBe(false)
    const limited=account({...manager,chartPermissions:[override({chartId:'order_volume',summaryMode:'selected',summaryDepartments:['sales2']})]})
    expect(resolveChartSummaryPolicy(limited,'order_volume')).toEqual({mode:'selected',departments:['sales2']})
  })

  it('denies every capability when a chart is disabled', () => {
    expect(access(account({ businessRole: 'admin', chartPermissions: [override({ chartId: 'department_receipts', visibility: 'deny', details: 'allow', export: 'allow' })] }), 'department_receipts')).toMatchObject({ visible: false, dataScope: 'none', canViewDetails: false, canExport: false, summaryDepartments: [] })
  })

  it('uses workbench assignments for defaults and accepts explicit features without increasing record scope', () => {
    const user = account({ workbenchRoles: ['warehouse'] })
    expect(access(user, 'customer_orders')?.visible).toBe(false)
    user.chartPermissions = [override({ visibility: 'allow' })]
    expect(access(user, 'customer_orders')).toMatchObject({ visible: true, dataScope: 'self' })
  })

  it.each(['dispatch', 'warehouse', 'allocation', 'procurement'] as const)('keeps freight administrator-only for the %s role', role => {
    const user = account({ workbenchRoles: [role] })
    expect(access(user, 'freight')).toMatchObject({ visible: false, dataScope: 'none', canViewDetails: false, canExport:false })
    expect(access(user, 'customer_orders')?.visible).toBe(false)
  })

  it('fails closed on malformed persisted policy and never returns unknown charts', () => {
    const user = account({ chartPermissions: [override({ chartId: 'future_chart' as never })] })
    expect(resolveChartAccess(user)).toHaveLength(7)
    expect(resolveChartAccess(user).every(chart => !chart.visible)).toBe(true)
    expect(CHART_IDS).not.toContain('future_chart')
  })
})

describe('chart override validation', () => {
  it('accepts empty inheritance and complete valid unique overrides', () => {
    expect(validateChartPermissions([])).toBe(true)
    expect(validateChartPermissions([override(), override({ chartId: 'registrations', summaryMode: 'selected', summaryDepartments: ['sales1'] })])).toBe(true)
  })

  it.each([
    null, {}, [override(), override()], [override({ chartId: 'unknown' as never })],
    [override({ dataScope: 'all' as never })], [override({ summaryMode: 'selected', summaryDepartments: ['sales1', 'sales2', 'sales3', 'sales4'] })],
    [override({ chartId: 'registrations', summaryMode: 'selected' })],
    [override({ chartId: 'registrations', summaryMode: 'selected', summaryDepartments: ['sales1', 'sales1'] })],
    [override({ chartId: 'registrations', summaryMode: 'marketing', summaryDepartments: ['sales1', 'sales2', 'sales3', 'sales4'] })],
    [{ ...override(), injected: true }], [{ chartId: 'customer_orders' }],
  ])('rejects malformed, duplicate, unsupported or inconsistent policy %j', (value) => {
    expect(validateChartPermissions(value)).toBe(false)
  })
})

it.each(['salesperson','department_manager','admin'] as const)('never grants freight to a nonadministrator %s through an explicit override',businessRole=>{
 const user=account({businessRole,workbenchRoles:['sales','dispatch','procurement','allocation','warehouse'],chartPermissions:[override({chartId:'freight',visibility:'allow',details:'allow',export:'allow'})]})
 expect(access(user,'freight')).toMatchObject({visible:false,dataScope:'none',canViewDetails:false,canExport:false})
 expect(access({...user,role:UserRole.ADMIN},'freight')).toMatchObject({visible:true,dataScope:'all',canViewDetails:true,canExport:true})
})
