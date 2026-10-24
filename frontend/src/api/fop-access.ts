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
    chart_access_denied: ['暂时无法查看此图表，请联系管理员。', 'This chart is unavailable. Contact an administrator.'],
    chart_details_denied: ['当前仅可查看统计汇总，如需明细请联系管理员。', 'Only summaries are available. Contact an administrator for details.'],
    business_access_disabled: ['当前账号尚未开通业务数据，请联系管理员。', 'Business data is not enabled for your account. Contact an administrator.'],
    business_scope_required: ['业务数据暂不可查看，请联系管理员。', 'Business data is unavailable. Contact an administrator.'],
    fop_binding_required: ['业务数据暂不可查看，请联系管理员。', 'Business data is unavailable. Contact an administrator.'],
    fop_not_configured: ['业务数据服务尚未接通，请联系管理员。', 'The business data service is not connected. Contact an administrator.'],
    fop_summary_not_configured: ['部门汇总暂不可用，请联系管理员。', 'Department summaries are unavailable. Contact an administrator.'],
    fop_permission_denied: ['暂时无法查看这些数据，请联系管理员。', 'This data is unavailable to your account. Contact an administrator.'],
    fop_binding_changed: ['账号设置已更新，请刷新后重试。', 'Your account settings have changed. Refresh and try again.'],
    fop_unavailable: ['业务数据暂时无法加载，请稍后重试。', 'Business data is temporarily unavailable. Please retry later.'],
  }
  const message = typeof code === 'string' ? messages[code] : undefined
  return message ? message[zh ? 0 : 1] : zh ? '数据加载失败，请稍后重试。' : 'Unable to load data. Please retry later.'
}
