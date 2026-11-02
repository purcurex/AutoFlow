import type { ChartId, ChartPermissionOverride } from './fop-chart-access'
import type { WorkbenchRole } from '@/utils/workbench'
import type { FopBinding, FopBindingDetails, FopConnectionContext } from './fop-access'

export interface BusinessScope { role: 'none' | 'admin' | 'department_manager' | 'salesperson'; departmentId: string | null; employeeId: string | null }
export const accountRoles = ['administrator', 'department_manager', 'salesperson', 'collaboration'] as const
export type AccountRole = typeof accountRoles[number]
export interface AccountAccessInput { accountRole: AccountRole; businessScope: BusinessScope; workbenchRoles: WorkbenchRole[] }
export interface WorkbenchAccess { roles: WorkbenchRole[]; isAdmin: boolean; businessRole?: BusinessScope['role']; businessDepartment?: { id: string; name: string | null } | null; defaultProcurementView?: 'fulfillment' | 'purchase'; chartVisibility?: Record<ChartId, boolean> }
export interface WorkbenchAccount {
  id: string; displayId: string; email: string; username: string
  role: 'admin' | 'user'; workbenchRoles: WorkbenchRole[]
  accountRole?: AccountRole
  businessScope?: BusinessScope
  fopBinding: FopBinding | null
  fopBindingDetails?: FopBindingDetails | null
  chartPermissions: ChartPermissionOverride[]
  employee?: { id: string; name: string; code: string; department: { id: string; name: string } } | null
}
export async function getWorkbenchAccess(role?: WorkbenchRole): Promise<WorkbenchAccess> {
  const { default: api } = await import('./index')
  return api.get(role ? `/workbench/${role}/access` : '/workbench/access')
}
export async function getWorkbenchAccounts(query: { page: number; pageSize: number; search?: string; accountRole?: AccountRole }): Promise<{ items: WorkbenchAccount[]; total: number }> {
  const { default: api } = await import('./index')
  return api.get('/users/workbench-accounts', { params: query })
}
export async function updateAccountAccess(id: string, input: AccountAccessInput): Promise<WorkbenchAccount> {
  const { default: api } = await import('./index')
  return api.put(`/users/${encodeURIComponent(id)}/account-access`, input)
}
export async function updateWorkbenchRoles(id: string, workbenchRoles: WorkbenchRole[]): Promise<WorkbenchAccount> {
  const { default: api } = await import('./index')
  return api.put(`/users/${encodeURIComponent(id)}/workbench-roles`, { workbenchRoles })
}
export async function updateFopBinding(id: string, binding: FopBinding | null): Promise<WorkbenchAccount> {
  const { default: api } = await import('./index')
  return api.put(`/users/${encodeURIComponent(id)}/fop-binding`, binding ?? { tenantId: null, userId: null })
}

export async function testFopConnection(): Promise<FopConnectionContext> {
  const { default: api } = await import('./index')
  return api.post('/autoflow/integrations/fop/connection/test')
}

export async function bindCurrentFopConnection(connection: FopConnectionContext): Promise<WorkbenchAccount> {
  const { default: api } = await import('./index')
  return api.post('/autoflow/integrations/fop/connection/bind', {
    ...connection.subject, organizationId: connection.currentOrganization.id,
  })
}

export async function updateBusinessScope(id: string, scope: BusinessScope): Promise<WorkbenchAccount> {
  const { default: api } = await import('./index')
  return api.put(`/users/${encodeURIComponent(id)}/business-scope`, scope)
}

export async function updateManagementRole(id: string, role: WorkbenchAccount['role']): Promise<WorkbenchAccount> {
  const { default: api } = await import('./index')
  return api.put(`/users/${encodeURIComponent(id)}/management-role`, { role })
}

export async function updateChartPermissions(id: string, chartPermissions: ChartPermissionOverride[]): Promise<WorkbenchAccount> {
  const { default: api } = await import('./index')
  return api.put(`/users/${encodeURIComponent(id)}/chart-permissions`, { chartPermissions })
}
