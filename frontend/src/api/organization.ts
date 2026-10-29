import type { WorkbenchRole } from '@/utils/workbench'

export interface OrganizationNode { id: string; parentId: string | null; name: string; kind: 'organization' | 'department'; sortOrder: number; archivedEmployeeCount?: number }
export interface DirectoryProfile { source: 'company-directory'; sourceAccount: string; englishName: string; departmentPaths: string[]; gender: string; originalEmail: string; enterpriseEmail: string; telephone: string; address: string }
export interface OrganizationEmployee { id: string; name: string; code: string; email: string; departmentId: string; workbenchRoles: WorkbenchRole[]; accountId?: string | null; jobTitle?: string; phone?: string; archivedAt?: string | null; directoryProfile?: DirectoryProfile | null }
export interface EmployeeAccountInput { username: string; password: string; fopBinding?: { tenantId: string; userId: string } | null }
export interface OrganizationEmployeeInput { name: string; code: string; email: string; departmentId: string; workbenchRoles: WorkbenchRole[]; jobTitle?: string; phone?: string; account?: EmployeeAccountInput | null }
export type EmployeeProfile = Pick<OrganizationEmployeeInput, 'name' | 'code' | 'email' | 'jobTitle' | 'phone'>
export interface EmployeeImportPreview { employees: EmployeeProfile[]; rowNumbers: number[]; errors: {row: number; message: string}[] }
export interface EmployeeLogin { id: string; username: string; email: string; fopBinding: {tenantId: string; userId: string} | null }
export interface OrganizationWorkspace { source: 'mock' | 'fop'; nodes: OrganizationNode[]; employees: OrganizationEmployee[]; canEdit: boolean }
export interface OrganizationNodeInput { parentId: string; name: string; sortOrder: number }
export async function getOrganization(): Promise<OrganizationWorkspace> {
  const { default: api } = await import('./index')
  return api.get('/organization')
}
export async function createOrganizationNode(input: OrganizationNodeInput): Promise<OrganizationWorkspace> {
  const { default: api } = await import('./index')
  return api.post('/organization/nodes', input)
}
export async function updateOrganizationNode(id: string, input: Partial<OrganizationNodeInput>): Promise<OrganizationWorkspace> {
  const { default: api } = await import('./index')
  return api.put(`/organization/nodes/${encodeURIComponent(id)}`, input)
}
export async function deleteOrganizationNode(id: string): Promise<OrganizationWorkspace> {
  const { default: api } = await import('./index')
  return api.delete(`/organization/nodes/${encodeURIComponent(id)}`)
}
export async function moveOrganizationEmployee(id: string, departmentId: string): Promise<OrganizationWorkspace> {
  const { default: api } = await import('./index')
  return api.put(`/organization/employees/${encodeURIComponent(id)}`, { departmentId })
}
export async function createOrganizationEmployee(input: OrganizationEmployeeInput): Promise<OrganizationWorkspace> {
  const { default: api } = await import('./index')
  return api.post('/organization/employees', input)
}
export async function createEmployeeAccount(id: string, input: EmployeeAccountInput): Promise<OrganizationWorkspace> {
  const { default: api } = await import('./index')
  return api.post(`/organization/employees/${encodeURIComponent(id)}/account`, input)
}
export async function updateOrganizationEmployee(id: string, input: Omit<OrganizationEmployeeInput, 'account'>): Promise<OrganizationWorkspace> {
  const { default: api } = await import('./index')
  return api.put(`/organization/employees/${encodeURIComponent(id)}/details`, input)
}
export async function removeOrganizationEmployees(ids: string[]): Promise<OrganizationWorkspace> {
  const { default: api } = await import('./index')
  return api.post('/organization/employees/remove', { ids })
}
export async function previewOrganizationImport(departmentId: string, file: File): Promise<EmployeeImportPreview> {
  const { default: api } = await import('./index')
  const form = new FormData(); form.append('departmentId', departmentId); form.append('file', file)
  return api.post('/organization/employees/import-preview', form, { headers: { 'Content-Type': 'multipart/form-data' } })
}
export async function importOrganizationEmployees(departmentId: string, employees: EmployeeProfile[]): Promise<OrganizationWorkspace> {
  const { default: api } = await import('./index')
  return api.post('/organization/employees/import', { departmentId, employees })
}
export async function getEmployeeLogin(id: string): Promise<EmployeeLogin> {
  const { default: api } = await import('./index')
  return api.get(`/organization/accounts/${encodeURIComponent(id)}`)
}
export async function updateEmployeeLogin(id: string, input: Omit<EmployeeLogin, 'id'> & { password?: string }): Promise<EmployeeLogin> {
  const { default: api } = await import('./index')
  return api.put(`/organization/accounts/${encodeURIComponent(id)}`, input)
}
