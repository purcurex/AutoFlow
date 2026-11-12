import type { User } from './user.entity'
export const BUSINESS_ROLES = ['none', 'admin', 'department_manager', 'salesperson'] as const
export type BusinessRole = typeof BUSINESS_ROLES[number]
export interface BusinessScope {
  role: BusinessRole; departmentId: string | null; employeeId: string | null
  /** Server-only local directory snapshot. null means the current FOP user's full grant; [] means no members. */
  localOrganization?: { employeeIds: readonly string[] | null; version: string }
}
export function businessScope(user: Pick<User, 'role' | 'businessRole' | 'businessDepartmentId' | 'businessEmployeeId'>): BusinessScope {
  // 系统管理员始终具有完整本地业务范围；保留的员工归属不再成为查询条件。
  if (user.role === 'admin') return { role: 'admin', departmentId: null, employeeId: null }
  const role = user.businessRole ?? 'salesperson'
  return { role, departmentId: user.businessDepartmentId ?? null, employeeId: user.businessEmployeeId ?? null }
}
/** Display preferences only narrow data reads; assigned role/administration stays unchanged. */
export function effectiveBusinessScope(user: Parameters<typeof businessScope>[0] & { dataDisplayScope?: 'department' | 'self' }): BusinessScope {
  const scope = businessScope(user)
  return scope.role === 'department_manager' && user.dataDisplayScope !== 'department'
    ? { ...scope, role: 'salesperson' } : scope
}
export function matchesBusinessScope(scope: BusinessScope, record: { owner?: { id: string }; department?: { id: string }; departmentPathIds?: readonly string[] }, includeManagedDepartments = false): boolean {
  if (scope.role === 'none') return false
  if (scope.localOrganization) {
    const ids = scope.localOrganization.employeeIds
    return ids === null ? scope.role === 'admin' : !!record.owner?.id && ids.includes(record.owner.id)
  }
  if (scope.role === 'admin') return true
  // 其他业务维持直属部门；仅待履约显式启用已核实祖先路径，覆盖上级管理的下级部门。
  if (scope.role === 'department_manager') return !!scope.departmentId && (record.department?.id === scope.departmentId
    || includeManagedDepartments && !!record.departmentPathIds?.includes(scope.departmentId))
  return !!scope.employeeId && record.owner?.id === scope.employeeId
}
