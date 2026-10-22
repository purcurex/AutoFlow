import type { WorkbenchRole } from '@/utils/workbench'

export interface OrganizationNode { id: string; parentId: string | null; name: string; kind: 'organization' | 'department'; sortOrder: number }
export interface OrganizationEmployee { id: string; name: string; code: string; email: string; departmentId: string; workbenchRoles: WorkbenchRole[] }
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
