import { User, UserRole } from './user.entity'

export const ACCOUNT_ROLES = ['administrator', 'department_manager', 'salesperson', 'collaboration'] as const
export type AccountRole = typeof ACCOUNT_ROLES[number]

// Public role vocabulary. Internal system authority and record scope remain independent.
// Accounts without business access (e.g. HR) are collaboration accounts with access closed.
export function accountRole(user: Pick<User, 'role' | 'businessRole'>): AccountRole {
  if (user.role === UserRole.ADMIN) return 'administrator'
  if (user.businessRole === 'department_manager') return 'department_manager'
  if ((user.businessRole ?? 'salesperson') === 'salesperson') return 'salesperson'
  return 'collaboration'
}
