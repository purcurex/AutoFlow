import { CHART_IDS, ChartPermissionOverride } from '../users/chart-permissions'
import { BusinessRole } from '../users/business-scope'
import { UserRole } from '../users/user.entity'
import { WORKBENCH_ROLES, WorkbenchRole } from '../users/workbench-role'

export interface DirectoryProfile {
  source: 'company-directory'
  sourceAccount: string
  englishName: string
  departmentPaths: string[]
  gender: string
  originalEmail: string
  enterpriseEmail: string
  telephone: string
  address: string
}
export interface DirectoryMember {
  code: string; name: string; englishName: string; email: string; jobTitle: string; phone: string
  primaryDepartment: string; disabled: boolean; profile: DirectoryProfile
}
export interface DirectoryPolicy {
  role: UserRole; businessRole: BusinessRole; workbenchRoles: WorkbenchRole[]; chartPermissions: ChartPermissionOverride[]
}

const ADMIN_NAMES = new Set(['ethan', 'robin', 'nora', 'mason', 'xinke'])
const SUMMARY_CHARTS = new Set(['registrations', 'department_receipts', 'order_volume'])
export function directoryPolicy(member: DirectoryMember): DirectoryPolicy {
  if (ADMIN_NAMES.has(member.englishName.toLowerCase())) return { role: UserRole.ADMIN, businessRole: 'admin', workbenchRoles: [...WORKBENCH_ROLES], chartPermissions: [] }
  const paths = member.profile.departmentPaths
  if (/\bHR\b|人事|人力资源/i.test(member.jobTitle) || paths.some(path => path.split('/').includes('商品管理'))) return { role: UserRole.USER, businessRole: 'none', workbenchRoles: [], chartPermissions: [] }
  if (/\/(订单管理|采购管理|物流管理|仓库管理|杭州仓|深圳仓|信息管理部)(\/|$)/.test(member.primaryDepartment)) {
    return { role: UserRole.USER, businessRole: 'admin', workbenchRoles: [...WORKBENCH_ROLES], chartPermissions: CHART_IDS.map(chartId => ({
      chartId, visibility: SUMMARY_CHARTS.has(chartId) ? 'allow' : 'deny', dataScope: 'none',
      summaryMode: SUMMARY_CHARTS.has(chartId) ? 'marketing' : 'none', summaryDepartments: [], details: 'deny', export: 'deny',
    })) }
  }
  if (/\/营销中心\/业务[一二三四]部(?:\/|$)/.test(member.primaryDepartment) || paths.some(path => /\/(合作伙伴|外部伙伴)(\/|$)/.test(path))) {
    return { role: UserRole.USER, businessRole: member.jobTitle === '部门经理' && /\/营销中心\/业务[一二三四]部(?:\/|$)/.test(member.primaryDepartment) ? 'department_manager' : 'salesperson', workbenchRoles: ['sales'], chartPermissions: [] }
  }
  return { role: UserRole.USER, businessRole: 'none', workbenchRoles: [], chartPermissions: [] }
}

/** Workbook preamble is data, never instructions; only the named header and rows are parsed. */
export function directoryMembers(rows: unknown[][]): DirectoryMember[] {
  const index = rows.findIndex(row => row.includes('姓名') && row.includes('账号') && row.includes('英文名') && row.includes('部门'))
  if (index < 0) throw new Error('通讯录表头缺失')
  const header = rows[index].map(String)
  const members: DirectoryMember[] = [], emails = new Set<string>(), codes = new Set<string>()
  for (const [offset, row] of rows.slice(index + 1).entries()) {
    if (row.every(value => value === null || value === undefined || value === '')) continue
    const field = (key: string) => String(row[header.indexOf(key)] ?? '').trim()
    const line = index + offset + 2, englishName = field('英文名'), code = field('账号')
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,31}$/.test(englishName)) throw new Error(`第${line}行英文名缺失或不能直接生成邮箱`)
    if (!code || code.length > 40 || !field('姓名')) throw new Error(`第${line}行姓名或源账号无效`)
    const email = `${englishName.toLowerCase()}@hzdrop.com`
    if (emails.has(email) || codes.has(code.toLowerCase())) throw new Error(`第${line}行账号或英文名重复`)
    emails.add(email); codes.add(code.toLowerCase())
    const departmentPaths = [...new Set(field('部门').split(/[;；]/).map(path => path.split('/').map(part => part.trim()).join('/')).filter(Boolean))]
    if (!departmentPaths.length || departmentPaths.some(path => path.split('/').some(part => !part || part.length > 100))) throw new Error(`第${line}行部门无效`)
    const primaryDepartment = departmentPaths[0]
    if (!primaryDepartment.includes('/')) throw new Error(`第${line}行主部门不能仅为公司根节点`)
    const disabledText = field('禁用状态')
    if (!['', '未禁用', '已禁用', '禁用', '正常', '启用'].includes(disabledText)) throw new Error(`第${line}行禁用状态无法识别`)
    members.push({ code, englishName, name: field('姓名'), email, jobTitle: field('职务'), phone: field('手机'), primaryDepartment,
      disabled: ['已禁用', '禁用'].includes(disabledText), profile: { source: 'company-directory', sourceAccount: code, englishName, departmentPaths,
        gender: field('性别'), originalEmail: field('邮箱'), enterpriseEmail: field('企业邮箱'), telephone: field('座机'), address: field('地址') } })
  }
  if (!members.length || members.length > 1000) throw new Error('通讯录必须包含1–1000名员工')
  const roots = new Set(members.flatMap(member => member.profile.departmentPaths.map(path => path.split('/')[0])))
  if (roots.size !== 1) throw new Error('同一批通讯录必须属于同一公司')
  return members
}
