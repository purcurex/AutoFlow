import type { WorkbenchRole } from '../users/workbench-role'

export interface OrganizationNode {
  id: string
  parentId: string | null
  name: string
  kind: 'organization' | 'department'
  sortOrder: number
}

export interface OrganizationEmployee {
  id: string
  name: string
  code: string
  email: string
  departmentId: string
  workbenchRoles: WorkbenchRole[]
}

export interface OrganizationWorkspace {
  source: 'mock'
  nodes: OrganizationNode[]
  employees: OrganizationEmployee[]
  canEdit: boolean
}
