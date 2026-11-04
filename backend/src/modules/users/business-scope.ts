import type { User } from './user.entity'
export const BUSINESS_ROLES = ['none', 'admin', 'department_manager', 'salesperson'] as const
export type BusinessRole = typeof BUSINESS_ROLES[number]
export interface BusinessScope { role: BusinessRole; departmentId: string | null; employeeId: string | null }
export function businessScope(user: Pick<User, 'role' | 'businessRole' | 'businessDepartmentId' | 'businessEmployeeId'>): BusinessScope {
  // 已开通业务的系统管理员统一查看全部部门；总经办沿用admin数据角色，不授予系统管理权。
  const role = user.businessRole === 'none' ? 'none' : user.role === 'admin' ? 'admin' : user.businessRole ?? 'salesperson'
  return { role, departmentId: user.businessDepartmentId ?? null, employeeId: user.businessEmployeeId ?? null }
}
export function matchesBusinessScope(scope: BusinessScope, record: { owner?: { id: string }; department?: { id: string }; departmentPathIds?: readonly string[] }, includeManagedDepartments = false): boolean {
  if (scope.role === 'none') return false
  if (scope.role === 'admin') return true
  // 其他业务维持直属部门；仅待履约显式启用已核实祖先路径，覆盖上级管理的下级部门。
  if (scope.role === 'department_manager') return !!scope.departmentId && (record.department?.id === scope.departmentId
    || includeManagedDepartments && !!record.departmentPathIds?.includes(scope.departmentId))
  return !!scope.employeeId && record.owner?.id === scope.employeeId
}
