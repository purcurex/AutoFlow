import type { BusinessScope } from './workbench-access'
export interface FopBinding { tenantId: string; userId: string }
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
    chart_access_denied: ['当前图表未获授权。', 'This chart is not authorized.'],
    chart_details_denied: ['当前图表未获明细权限，仅可查看统计。', 'Detail access is not granted for this chart.'],
    business_access_disabled: ['当前账号未分配业务数据权限，系统管理权限不受影响。', 'Business data access is disabled. System management permissions are unchanged.'],
    business_scope_required: ['尚未分配部门或员工数据范围，请联系管理员配置。', 'Your department or employee data scope is not configured. Contact an administrator.'],
    fop_binding_required: ['账号尚未绑定 FOP 用户，请联系管理员完成绑定。', 'Your account is not linked to a FOP user. Contact an administrator.'],
    fop_not_configured: ['FOP 权限接口尚未接通，暂不展示业务数据。', 'The FOP permissions integration is not connected. Business data is unavailable.'],
    fop_permission_denied: ['当前 FOP 用户无权读取这些数据，请联系管理员核对后台授权。', 'Your FOP user cannot access this data. Ask an administrator to check permissions.'],
    fop_binding_changed: ['账号绑定或授权已变更，请刷新后重试。', 'Your binding or access changed. Refresh and try again.'],
    fop_unavailable: ['FOP 权限或数据服务暂不可用，请稍后重试。', 'FOP permissions or data services are unavailable. Please retry later.'],
  }
  const message = typeof code === 'string' ? messages[code] : undefined
  return message ? message[zh ? 0 : 1] : zh ? '数据加载失败，请检查查询条件及账号权限后重试。' : 'Unable to load data. Check your filters and account access, then retry.'
}
