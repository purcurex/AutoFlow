import type { WorkbenchRole } from '../users/workbench-role'

export interface OrganizationNode {
  id: string
  parentId: string | null
  name: string
  kind: 'organization' | 'department'
  sortOrder: number
  archivedEmployeeCount?: number
}

export interface OrganizationEmployee {
  accountId?: string | null
  jobTitle?: string
  phone?: string
  archivedAt?: string | null
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
