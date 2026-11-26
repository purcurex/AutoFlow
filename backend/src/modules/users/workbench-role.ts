export const WORKBENCH_ROLES = ['sales', 'procurement', 'allocation', 'dispatch', 'warehouse'] as const
export type WorkbenchRole = typeof WORKBENCH_ROLES[number]

export function isWorkbenchRole(value: unknown): value is WorkbenchRole {
  return typeof value === 'string' && WORKBENCH_ROLES.includes(value as WorkbenchRole)
}
import type { User } from './user.entity'
import { businessScope } from './business-scope'

/** Workbench entry permissions do not broaden employee/department or chart data scope. */
export function effectiveWorkbenchRoles(user: Pick<User, 'role' | 'businessRole' | 'businessDepartmentId' | 'businessEmployeeId' | 'accountDisabled' | 'workbenchRoles'>): WorkbenchRole[] {
  const role = businessScope(user).role
  if (user.accountDisabled) return []
  if (role === 'admin' || role === 'salesperson') return [...WORKBENCH_ROLES]
  return [...new Set((user.workbenchRoles ?? []).filter(isWorkbenchRole))]
}
