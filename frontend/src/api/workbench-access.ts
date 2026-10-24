import type { ChartPermissionOverride } from './fop-chart-access'
import type { WorkbenchRole } from '@/utils/workbench'
import type { FopBinding } from './fop-access'

export interface BusinessScope { role: 'none' | 'admin' | 'department_manager' | 'salesperson'; departmentId: string | null; employeeId: string | null }
export interface WorkbenchAccess { roles: WorkbenchRole[]; isAdmin: boolean; businessRole?: BusinessScope['role'] }
export interface WorkbenchAccount {
  id: string; displayId: string; email: string; username: string
  role: 'admin' | 'user'; workbenchRoles: WorkbenchRole[]
  businessScope?: BusinessScope
  fopBinding: FopBinding | null
  chartPermissions: ChartPermissionOverride[]
  employee?: { id: string; name: string; code: string; department: { id: string; name: string } } | null
}
export async function getWorkbenchAccess(role?: WorkbenchRole): Promise<WorkbenchAccess> {
  const { default: api } = await import('./index')
  return api.get(role ? `/workbench/${role}/access` : '/workbench/access')
}
export async function getWorkbenchAccounts(query: { page: number; pageSize: number; search?: string }): Promise<{ items: WorkbenchAccount[]; total: number }> {
  const { default: api } = await import('./index')
  return api.get('/users/workbench-accounts', { params: query })
}
export async function updateWorkbenchRoles(id: string, workbenchRoles: WorkbenchRole[]): Promise<WorkbenchAccount> {
  const { default: api } = await import('./index')
  return api.put(`/users/${encodeURIComponent(id)}/workbench-roles`, { workbenchRoles })
}
export async function updateFopBinding(id: string, binding: FopBinding | null): Promise<WorkbenchAccount> {
  const { default: api } = await import('./index')
  return api.put(`/users/${encodeURIComponent(id)}/fop-binding`, binding ?? { tenantId: null, userId: null })
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
