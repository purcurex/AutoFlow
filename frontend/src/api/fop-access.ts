import type { BusinessScope } from './workbench-access'
export interface FopBinding { tenantId: string; userId: string }
export interface FopBindingDetails {
  username: string; name: string; employeeRecordId: string; employeeMasterId: string
  departmentId: string; organizationId: string; verifiedAt: string
}
export interface FopBindingEmployee { id: string; masterId: string; membershipId: string; departmentId: string; name: string; username: string; state: 'active' | 'disabled' | 'unknown' }
export interface FopBindingEmployeePage { items: FopBindingEmployee[]; nextCursor: string | null; scopeVersion: string }
export async function getFopBindingEmployees(query: { cursor?: string; scopeVersion?: string } = {}): Promise<FopBindingEmployeePage> {
  const { default: api } = await import('./index')
  return api.get('/users/fop-employees', { params: query })
}
export async function bindFopEmployee(accountId: string, employeeId: string, membershipId: string): Promise<import('./organization').EmployeeLogin> {
  const { default: api } = await import('./index')
  return api.put(`/users/${encodeURIComponent(accountId)}/kingdee-binding`, { employeeId, membershipId })
}
export async function unbindFopEmployee(accountId: string): Promise<import('./organization').EmployeeLogin> {
  const { default: api } = await import('./index')
  return api.delete(`/users/${encodeURIComponent(accountId)}/kingdee-binding`)
}
export interface FopConnectionContext {
  subject: FopBinding
  username: string | null
  currentOrganization: { id: string; name: string }
  resources: ('orders' | 'receipts' | 'registrations' | 'freight')[]
}
export interface FopDataAccess {
  businessScope?: BusinessScope
  source?: 'mock' | 'fop'
  mode?: 'demo' | 'live'
  binding: FopBinding | null
  status: 'unbound' | 'not_configured' | 'ready' | 'unavailable' | 'denied'
}

export async function getFopDataAccess(): Promise<FopDataAccess> {
  const { default: api } = await import('./index')
  return api.get('/autoflow/integrations/fop/data-access')
}

export function fopAccessError(error: unknown, zh: boolean): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  const messages: Record<string, [string, string]> = {
    stock_inventory_orders_changed: ['所选备货订单已变化或不可查看，请关闭库存窗口，刷新清单后重新勾选。', 'Selected stock orders changed or are unavailable. Close this window, refresh the list and select again.'],
    chart_access_denied: ['暂时无法查看此图表，请联系管理员。', 'This chart is unavailable. Contact an administrator.'],
    chart_details_denied: ['当前仅可查看统计汇总，如需明细请联系管理员。', 'Only summaries are available. Contact an administrator for details.'],
    business_access_disabled: ['当前账号尚未开通业务数据，请联系管理员。', 'Business data is not enabled for your account. Contact an administrator.'],
    business_scope_required: ['业务数据暂不可查看，请联系管理员。', 'Business data is unavailable. Contact an administrator.'],
    fop_binding_required: ['业务数据暂不可查看，请联系管理员。', 'Business data is unavailable. Contact an administrator.'],
    fop_proxy_user_required: ['该员工尚未加入金蝶应用代理用户名单，请配置后重试。', 'Add this employee to the Kingdee application proxy users and retry.'],
    fop_employee_unavailable: ['金蝶员工账号不可用或状态无法核实，请核对当前数据中心的用户状态。', 'The Kingdee employee is unavailable or its current state cannot be verified.'],
    fop_api_not_authorized: ['金蝶应用尚未授权当前接口，请核对自建API授权。', 'Authorize this API for the Kingdee application.'],
    fop_employee_directory_not_configured: ['金蝶人员目录尚未接通，请核对目录接口的实际URL、API登记及应用授权。', 'Check the Kingdee employee directory URLs, API registration and application authorization.'],
    fop_not_configured: ['业务数据服务尚未接通，请联系管理员。', 'The business data service is not connected. Contact an administrator.'],
    fop_summary_not_configured: ['部门汇总暂不可用，请联系管理员。', 'Department summaries are unavailable. Contact an administrator.'],
    fop_permission_denied: ['暂时无法查看这些数据，请联系管理员。', 'This data is unavailable to your account. Contact an administrator.'],
    fop_binding_changed: ['账号设置已更新，请刷新后重试。', 'Your account settings have changed. Refresh and try again.'],
    fop_unavailable: ['业务数据暂时无法加载，请稍后重试。', 'Business data is temporarily unavailable. Please retry later.'],
    fop_authentication_expired: ['金蝶接口认证已失效，请更新服务端认证令牌后重试。', 'Kingdee authentication expired. Update the server-side access token and retry.'],
    fop_feature_not_configured: ['该统计查询尚未配置，请核对金蝶接口登记及本地服务端配置。', 'This query is not configured. Check the Kingdee API registration and server configuration.'],
    fop_mapping_required: ['部门、仓库或物流商的统计映射尚未配置完整，请联系管理员核对。', 'Department, warehouse or carrier reporting mappings are incomplete. Contact an administrator.'],
    fop_fx_missing: ['部分运费缺少确认日的有效美元汇率，请维护金蝶历史汇率后重试。', 'Some freight costs have no valid historical USD exchange rate. Maintain the Kingdee rates and retry.'],
    fop_result_too_large: ['当前查询数据较多，请缩小日期范围后重试；本次未返回不完整统计。', 'Too much data for this query. Narrow the date range and retry. No partial totals were returned.'],
    fop_endpoint_not_published: ['金蝶查询接口尚未发布，请先发布后端查询代码并登记 WebAPI。', 'Publish the Kingdee query code and register its WebAPI first.'],
  }
  const message = typeof code === 'string' ? messages[code] : undefined
  return message ? message[zh ? 0 : 1] : zh ? '数据加载失败，请稍后重试。' : 'Unable to load data. Please retry later.'
}
