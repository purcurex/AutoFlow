import type { AccountRole, WorkbenchAccount } from '@/api/workbench-access'
import { englishDisplayName } from './user-display'

export function employeeDisplayName(account: WorkbenchAccount): string {
  const name = account.employee?.name.replace(/[（(][^()（）]*[）)]$/u, '').trim() ?? ''
  return name.toLowerCase() === englishDisplayName(account).toLowerCase() ? '' : name
}

export const accountRoleNames: Record<AccountRole, [string, string]> = {
  administrator: ['管理员', 'Administrator'], department_manager: ['部门经理', 'Department manager'],
  salesperson: ['外贸业务员', 'Sales representative'], collaboration: ['协同管理岗', 'Operations coordinator'],
}
export const accountRoleDescriptions: Record<AccountRole, [string, string]> = {
  administrator: ['全部业务数据与系统管理', 'All business data and system management'],
  department_manager: ['仅本部门业务', 'Own department records only'],
  salesperson: ['本人负责的业务', 'Own business records'],
  collaboration: ['跨部门待办 · 部门汇总', 'Cross-team tasks · Department summaries'],
}
export function getAccountRole(account: WorkbenchAccount): AccountRole {
  if (account.role === 'admin') return 'administrator'
  if (account.businessScope?.role === 'department_manager') return 'department_manager'
  if ((account.businessScope?.role ?? 'salesperson') === 'salesperson') return 'salesperson'
  return 'collaboration'
}
export function scopeName(account: Pick<WorkbenchAccount, 'businessScope'>): [string, string] {
  switch (account.businessScope?.role) {
    case 'none': return ['未开通业务数据', 'Business access off']
    case 'admin': return ['全部业务部门', 'All business departments']
    case 'department_manager': return ['本部门', 'Own department']
    default: return ['本人业务', 'Own records']
  }
}
