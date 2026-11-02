import { randomUUID } from 'crypto'
import * as bcrypt from 'bcrypt'
import { DataSource } from 'typeorm'
import { OrganizationEmployeeEntity } from '../modules/organization/organization-employee.entity'
import { OrganizationNodeEntity } from '../modules/organization/organization-node.entity'
import { directoryPolicy } from '../modules/organization/company-directory'
import { User, UserRole } from '../modules/users/user.entity'
import { WORKBENCH_ROLES } from '../modules/users/workbench-role'
import type { BusinessRole } from '../modules/users/business-scope'

/** 临时账号使用独立测试身份，避免占用未来通讯录的真实邮箱和源账号。 */
export const LOCAL_ROLE_ACCOUNTS = [
  { key: 'gm', name: '测试总经理', code: 'TEST-ROLE-GM', email: 'test.gm@autoflow.local', department: '总经办', parent: 'HyperZone', jobTitle: '总经理', businessRole: 'admin' },
  { key: 'manager', name: '测试部门经理', code: 'TEST-ROLE-MANAGER', email: 'test.manager@autoflow.local', department: '业务一部', parent: '营销中心', jobTitle: '部门经理', businessRole: 'department_manager' },
  { key: 'employee', name: '测试普通员工', code: 'TEST-ROLE-EMPLOYEE', email: 'test.employee@autoflow.local', department: '欧洲销售组', parent: '业务一部', jobTitle: '外贸业务员', businessRole: 'salesperson' },
  { key: 'collaborator', name: '测试协同人员', code: 'TEST-ROLE-COLLABORATOR', email: 'test.collaborator@autoflow.local', department: '订单管理', parent: '供应链中心', jobTitle: '订单协同', businessRole: 'admin' },
] as const

export interface LocalRoleAccountOptions {
  database: string
  ownerEmail: string
  apply: boolean
  passwords?: Record<string, string>
}

/** 此入口只允许本机明确命名的开发/测试库，不能用于云端或生产账号初始化。 */
export function assertLocalRoleDatabase(db: DataSource, database: string) {
  const config = db.options as { type: string; host?: string; database?: string; replication?: unknown }
  if (process.env.NODE_ENV === 'production' || config.type !== 'postgres' || config.replication
    || !['localhost', '127.0.0.1', '::1'].includes(config.host ?? '')
    || !['autoflow', 'autoflow_test', 'autoflow_local_demo'].includes(database) || config.database !== database) {
    throw new Error('仅允许明确确认的本机 autoflow / autoflow_test / autoflow_local_demo 数据库')
  }
}

/** 复用正式通讯录协同模板；只允许三种部门汇总，禁止所有分析记录、明细和分析导出。 */
export function localRolePolicy(key: string, businessRole: BusinessRole) {
  const chartPermissions = key === 'collaborator' ? directoryPolicy({
    code: 'TEST', name: '测试协同人员', englishName: 'TestCollaborator', email: 'test.collaborator@autoflow.local',
    jobTitle: '订单协同', phone: '', primaryDepartment: 'HyperZone/供应链中心/订单管理', disabled: false,
    profile: { source: 'company-directory', sourceAccount: 'TEST', englishName: 'TestCollaborator',
      departmentPaths: ['HyperZone/供应链中心/订单管理'], gender: '', originalEmail: '', enterpriseEmail: '', telephone: '', address: '' },
  }).chartPermissions : []
  return { role: UserRole.USER, businessRole, workbenchRoles: [...WORKBENCH_ROLES], chartPermissions }
}

/**
 * 在现有管理员目录中事务性新增四类测试账号，不创建新组织、不更新已有员工。
 * 预览只读；同一测试身份再次执行仅返回已有账号，不重置密码、权限或金蝶绑定。
 * 固定身份与已有资料冲突时整批失败，禁止根据姓名、手机号或邮箱猜测合并。
 */
export async function provisionLocalRoleAccounts(db: DataSource, options: LocalRoleAccountOptions) {
  assertLocalRoleDatabase(db, options.database)
  return db.transaction(options.apply ? 'READ COMMITTED' : 'REPEATABLE READ', async manager => {
    if (options.apply) {
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended('autoflow:management-roles', 0))")
    } else await manager.query('SET TRANSACTION READ ONLY')
    const users = manager.getRepository(User), employees = manager.getRepository(OrganizationEmployeeEntity)
    const owner = await users.findOneBy({ email: options.ownerEmail })
    if (!owner || owner.role !== UserRole.ADMIN || owner.accountDisabled) throw new Error('目录所有者必须是现有启用的系统管理员')
    if (options.apply) await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`autoflow:organization:${owner.id}`])
    const nodes = await manager.getRepository(OrganizationNodeEntity).findBy({ ownerUserId: owner.id })
    const nodeMap = new Map(nodes.map(node => [node.id, node]))
    const plan = []
    for (const definition of LOCAL_ROLE_ACCOUNTS) {
      const matches = nodes.filter(node => node.kind === 'department' && node.name === definition.department
        && node.parentId && nodeMap.get(node.parentId)?.name === definition.parent)
      if (matches.length !== 1) throw new Error(`测试部门不存在或不唯一：${definition.parent}/${definition.department}`)
      const departmentId = matches[0].id
      const accountMatches = await users.createQueryBuilder('u').where('LOWER(u.email) = :email OR LOWER(u.username) = :email', { email: definition.email }).getMany()
      const employeeMatches = await employees.createQueryBuilder('e').where('e.owner_user_id = :owner', { owner: owner.id })
        .andWhere('(e.code = :code OR LOWER(e.email) = :email)', { code: definition.code, email: definition.email }).getMany()
      const account = accountMatches[0], employee = employeeMatches[0]
      if (accountMatches.length > 1 || employeeMatches.length > 1 || !!account !== !!employee
        || account && (employee.accountId !== account.id || employee.code !== definition.code || employee.email !== definition.email
          || employee.archivedAt || employee.directoryProfile || account.email !== definition.email || account.username !== definition.email)) {
        throw new Error(`测试身份冲突，未修改任何账号：${definition.email}`)
      }
      const password = options.passwords?.[definition.email]
      if (options.apply && !account && (!password || password.length < 16 || Buffer.byteLength(password) > 72)) {
        throw new Error(`缺少符合要求的独立测试口令：${definition.email}`)
      }
      plan.push({ definition, departmentId, account, employee, accountId: account?.id ?? randomUUID(), employeeId: employee?.id ?? randomUUID() })
    }
    // 所有冲突和必要口令先检查完毕，再开始新增，任意数据库错误均回滚整批。
    for (const item of plan) {
      if (!options.apply || item.account) continue
      const { definition, departmentId, accountId, employeeId } = item
      await users.insert({ id: accountId, email: definition.email, username: definition.email,
        password: await bcrypt.hash(options.passwords![definition.email], 10), ...localRolePolicy(definition.key, definition.businessRole),
        businessDepartmentId: departmentId, businessEmployeeId: employeeId, accountDisabled: false,
        fopTenantId: null, fopUserId: null, fopBindingDetails: null, organizationWorkspaceOwnerId: null })
      await employees.insert({ id: employeeId, ownerUserId: owner.id, departmentId, accountId,
        code: definition.code, name: definition.name, email: definition.email, jobTitle: definition.jobTitle,
        phone: '', workbenchRoles: [...WORKBENCH_ROLES], directoryProfile: null, archivedAt: null })
    }
    return { applied: options.apply, database: options.database, ownerEmail: owner.email,
      created: options.apply ? plan.filter(item => !item.account).length : 0,
      planned: plan.filter(item => !item.account).length,
      accounts: plan.map(({ definition, departmentId, account, accountId, employeeId }) => ({
        email: definition.email, name: definition.name, department: definition.department, departmentId,
        accountId, employeeId, status: account ? 'existing' : options.apply ? 'created' : 'planned',
        role: account?.role ?? UserRole.USER, businessRole: account?.businessRole ?? definition.businessRole,
      })) }
  })
}
