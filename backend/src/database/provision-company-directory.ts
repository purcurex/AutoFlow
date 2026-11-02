import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import * as bcrypt from 'bcrypt'
import { DataSource } from 'typeorm'
import { User } from '../modules/users/user.entity'
import { OrganizationNodeEntity } from '../modules/organization/organization-node.entity'
import { OrganizationEmployeeEntity } from '../modules/organization/organization-employee.entity'
import { DirectoryMember, directoryPolicy } from '../modules/organization/company-directory'

export interface DirectoryProvisionOptions { apply: boolean; password?: string; backupDirectory?: string; ownerEmail?: string }

/** Explicit administrative import. No FOP calls, invitations, deletes or password resets. */
export async function provisionCompanyDirectory(db: DataSource, members: DirectoryMember[], options: DirectoryProvisionOptions) {
  const ownerEmail = options.ownerEmail ?? 'ethan@hzdrop.com'
  const ownerMember = members.find(member => member.email === ownerEmail)
  if (!ownerMember || directoryPolicy(ownerMember).role !== 'admin' || ownerMember.disabled) throw new Error('公司目录所有者必须是本批启用的指定管理员')
  if (options.apply && (!options.password || options.password.length < 10 || Buffer.byteLength(options.password) > 72 || !options.backupDirectory)) throw new Error('执行需要10字符以上初始密码及备份目录')
  return db.transaction(async manager => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended('autoflow:management-roles', 0))")
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`autoflow:directory-import:${ownerEmail}`])
    const users = manager.getRepository(User), employees = manager.getRepository(OrganizationEmployeeEntity), nodes = manager.getRepository(OrganizationNodeEntity)
    const emails = members.map(member => member.email)
    const existingUsers = await users.createQueryBuilder('u').where('LOWER(u.email) IN (:...emails) OR LOWER(u.username) IN (:...emails)', { emails }).getMany()
    const owner = existingUsers.find(user => user.email.toLowerCase() === ownerEmail)
    const ownerId = owner?.id ?? randomUUID()
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`autoflow:organization:${ownerId}`])
    const existingEmployees = owner ? await employees.findBy({ ownerUserId: ownerId }) : []
    const existingNodes = owner ? await nodes.findBy({ ownerUserId: ownerId }) : []
    const plan = members.map(member => {
      const employee = existingEmployees.find(item => item.directoryProfile?.sourceAccount === member.code)
      const accountMatches = existingUsers.filter(user => user.email.toLowerCase() === member.email || user.username.toLowerCase() === member.email)
      const account = accountMatches[0]
      if (accountMatches.length > 1 || account && (!employee || employee.accountId !== account.id)
        || employee && (!account || employee.archivedAt || employee.directoryProfile?.source !== 'company-directory')
        || existingEmployees.some(item => item.id !== employee?.id && (item.code.toLowerCase() === member.code.toLowerCase() || item.email.toLowerCase() === member.email))) {
        throw new Error(`账号或员工来源冲突：${member.email}；未保存任何更改`)
      }
      return { member, employee, account, policy: directoryPolicy(member), employeeId: employee?.id ?? randomUUID(), accountId: account?.id ?? (member.email === ownerEmail ? ownerId : randomUUID()) }
    })
    const nodePaths = new Map<string, OrganizationNodeEntity>()
    const nodeById = new Map(existingNodes.map(node => [node.id, node]))
    const pathOf = (node: OrganizationNodeEntity, seen = new Set<string>()): string => {
      if (seen.has(node.id)) throw new Error('现有组织存在循环')
      seen.add(node.id)
      const parent = node.parentId ? nodeById.get(node.parentId) : undefined
      if (node.parentId && !parent) throw new Error('现有组织父节点缺失')
      return parent ? `${pathOf(parent, seen)}/${node.name}` : node.name
    }
    for (const node of existingNodes) {
      const path = pathOf(node)
      if (nodePaths.has(path)) throw new Error(`组织路径重复：${path}`)
      nodePaths.set(path, node)
    }
    const rootName = ownerMember.primaryDepartment.split('/')[0]
    if (existingNodes.some(node => !node.parentId && node.name !== rootName)) throw new Error('现有公司根节点与通讯录不一致')
    const result = { total: plan.length, created: plan.filter(item => !item.account).length, updated: plan.filter(item => item.account).length,
      applied: options.apply, ownerId, backupPath: null as string | null,
      accounts: plan.map(({ member, policy, employeeId, accountId }) => ({ email: member.email, name: `${member.name}（${member.englishName}）`, department: member.primaryDepartment, employeeId, accountId, ...policy, disabled: member.disabled })) }
    if (!options.apply) return result
    // Persist preimages before the first mutation. Password hashes remain in a 0600 local backup only.
    await mkdir(options.backupDirectory!, { recursive: true, mode: 0o700 })
    result.backupPath = join(options.backupDirectory!, `directory-before-${Date.now()}-${randomUUID()}.json`)
    await writeFile(result.backupPath, JSON.stringify({ ownerId, importedEmails: emails, users: existingUsers, employees: existingEmployees, nodes: existingNodes }, null, 2), { mode: 0o600, flag: 'wx' })
    if (!owner) {
      await users.insert({ id: ownerId, email: ownerEmail, username: ownerEmail, password: await bcrypt.hash(options.password!, 10), ...directoryPolicy(ownerMember), accountDisabled: false, fopTenantId: null, fopUserId: null })
    }
    const ensurePath = async (path: string): Promise<string> => {
      const found = nodePaths.get(path)
      if (found) return found.id
      const parts = path.split('/'), name = parts.pop()!
      const parentId = parts.length ? await ensurePath(parts.join('/')) : null
      const node = await nodes.save(nodes.create({ id: randomUUID(), ownerUserId: ownerId, parentId, name, kind: parentId ? 'department' : 'organization', sortOrder: nodePaths.size }))
      nodePaths.set(path, node)
      return node.id
    }
    for (const { member, policy, employee, account, employeeId, accountId } of plan) {
      for (const path of member.profile.departmentPaths) await ensurePath(path)
      const departmentId = nodePaths.get(member.primaryDepartment)!.id
      // Preserve manually configured external IDs. Only locally linked assignments follow the roster.
      const accountFields = { email: member.email, username: member.email, ...policy, accountDisabled: member.disabled,
        businessEmployeeId: account?.businessEmployeeId && account.businessEmployeeId !== employee?.id ? account.businessEmployeeId : employeeId,
        businessDepartmentId: account?.businessDepartmentId && account.businessDepartmentId !== employee?.departmentId ? account.businessDepartmentId : departmentId }
      if (account) {
        const changed = Object.entries(accountFields).some(([key, value]) => JSON.stringify(account[key as keyof User]) !== JSON.stringify(value))
        if (changed) await users.update(accountId, { ...accountFields, sessionVersion: () => 'session_version + 1' })
      } else if (accountId === ownerId) await users.update(accountId, accountFields)
      else await users.insert({ id: accountId, ...accountFields, password: await bcrypt.hash(options.password!, 10), fopTenantId: null, fopUserId: null })
      const fields = { ownerUserId: ownerId, departmentId, accountId, name: `${member.name}（${member.englishName}）`, code: member.code,
        email: member.email, jobTitle: member.jobTitle, phone: member.phone, workbenchRoles: policy.workbenchRoles, directoryProfile: member.profile }
      if (employee) await employees.update(employeeId, fields)
      else await employees.insert({ id: employeeId, ...fields, archivedAt: null })
    }
    return result
  })
}
