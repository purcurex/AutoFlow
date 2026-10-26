import type { BusinessScope } from './workbench-access'
export interface FopBinding { tenantId: string; userId: string }
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
    business_access_disabled: ['当前账号未分配业务数据权限，系统管理权限不受影响。', 'Business data access is disabled. System management permissions are unchanged.'],
    business_scope_required: ['尚未分配部门或员工数据范围，请联系管理员配置。', 'Your department or employee data scope is not configured. Contact an administrator.'],
    fop_binding_required: ['账号尚未绑定 FOP 用户，请联系管理员完成绑定。', 'Your account is not linked to a FOP user. Contact an administrator.'],
    fop_not_configured: ['FOP 权限接口尚未接通，暂不展示业务数据。', 'The FOP permissions integration is not connected. Business data is unavailable.'],
    fop_permission_denied: ['当前 FOP 用户无权读取这些数据，请联系管理员核对后台授权。', 'Your FOP user cannot access this data. Ask an administrator to check permissions.'],
    fop_authentication_expired: ['金蝶接口认证已失效，请更新服务端认证令牌后重试。', 'Kingdee authentication expired. Update the server-side access token and retry.'],
    fop_binding_changed: ['账号绑定或授权已变更，请刷新后重试。', 'Your binding or access changed. Refresh and try again.'],
    fop_unavailable: ['FOP 权限或数据服务暂不可用，请稍后重试。', 'FOP permissions or data services are unavailable. Please retry later.'],
    fop_feature_not_configured: ['该统计查询尚未配置，请核对金蝶接口登记及本地服务端配置。', 'This query is not configured. Check the Kingdee API registration and server configuration.'],
    fop_mapping_required: ['部门、仓库或物流商的统计映射尚未配置完整，请联系管理员核对。', 'Department, warehouse or carrier reporting mappings are incomplete. Contact an administrator.'],
    fop_fx_missing: ['部分运费缺少确认日的有效美元汇率，请维护金蝶历史汇率后重试。', 'Some freight costs have no valid historical USD exchange rate. Maintain the Kingdee rates and retry.'],
    fop_result_too_large: ['当前查询数据较多，请缩小日期范围后重试；本次未返回不完整统计。', 'Too much data for this query. Narrow the date range and retry. No partial totals were returned.'],
    fop_endpoint_not_published: ['金蝶查询接口尚未发布，请先发布后端查询代码并登记 WebAPI。', 'Publish the Kingdee query code and register its WebAPI first.'],
  }
  const message = typeof code === 'string' ? messages[code] : undefined
  return message ? message[zh ? 0 : 1] : zh ? '数据加载失败，请检查查询条件及账号权限后重试。' : 'Unable to load data. Check your filters and account access, then retry.'
}
