import type { User } from './user.entity'
export const BUSINESS_ROLES = ['none', 'admin', 'department_manager', 'salesperson'] as const
export type BusinessRole = typeof BUSINESS_ROLES[number]
export interface BusinessScope { role: BusinessRole; departmentId: string | null; employeeId: string | null }
export function businessScope(user: Pick<User, 'role' | 'businessRole' | 'businessDepartmentId' | 'businessEmployeeId'>): BusinessScope {
  return { role: user.businessRole ?? 'salesperson', departmentId: user.businessDepartmentId ?? null, employeeId: user.businessEmployeeId ?? null }
}
export function matchesBusinessScope(scope: BusinessScope, record: { owner?: { id: string }; department?: { id: string }; departmentPathIds?: readonly string[] }): boolean {
  if (scope.role === 'none') return false
  if (scope.role === 'admin') return true
  if (scope.role === 'department_manager') return !!scope.departmentId && (record.department?.id === scope.departmentId || !!record.departmentPathIds?.includes(scope.departmentId))
  return !!scope.employeeId && record.owner?.id === scope.employeeId
}
