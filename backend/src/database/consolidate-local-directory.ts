import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import * as bcrypt from 'bcrypt'
import { DataSource } from 'typeorm'
import { User, UserRole } from '../modules/users/user.entity'
import { OrganizationEmployeeEntity } from '../modules/organization/organization-employee.entity'
import { WORKBENCH_ROLES } from '../modules/users/workbench-role'

interface ConsolidationOptions { keepEmails: string[]; removeEmails: string[]; password: string; backupDirectory: string }
/** Explicit local-test housekeeping. Never runs at boot or as a migration. */
export async function consolidateLocalDirectory(db: DataSource, options: ConsolidationOptions) {
  const connection = db.options as { host?: string; database?: string }
  if (!['localhost', '127.0.0.1'].includes(connection.host ?? '') || !['autoflow_local_demo', 'autoflow_test'].includes(connection.database ?? '')) throw new Error('账号清理仅支持明确的本机开发/测试数据库')
  if (!options.keepEmails.length || options.removeEmails.some(email => options.keepEmails.includes(email) || email === 'admin@hzdrop.com')) throw new Error('保留与删除账号列表冲突')
  if (options.password.length < 10 || Buffer.byteLength(options.password) > 72) throw new Error('初始密码长度无效')
  return db.transaction(async manager => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended('autoflow:management-roles', 0))")
    const users = manager.getRepository(User), employees = manager.getRepository(OrganizationEmployeeEntity)
    const accounts = await users.find()
    const keep = accounts.filter(user => options.keepEmails.includes(user.email))
    if (keep.length !== options.keepEmails.length) throw new Error('通讯录账号尚未全部创建')
    const staff = await employees.createQueryBuilder('e').where('e.account_id IN (:...ids)', { ids: keep.map(user => user.id) }).getMany()
    if (staff.length !== keep.length || staff.some(employee => employee.archivedAt || employee.directoryProfile?.source !== 'company-directory') || new Set(staff.map(employee => employee.ownerUserId)).size !== 1) throw new Error('保留账号必须来自同一套有效通讯录')
    const ownerId = staff[0].ownerUserId
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`autoflow:organization:${ownerId}`])
    const existing = accounts.find(user => user.email === 'admin@hzdrop.com')
    if (existing && (await employees.existsBy({ accountId: existing.id }) || existing.organizationWorkspaceOwnerId !== ownerId)) throw new Error('测试管理员与现有员工或其他目录冲突')
    if (accounts.some(user => user.id !== existing?.id && user.username.toLowerCase() === 'admin@hzdrop.com')) throw new Error('测试管理员登录名称冲突')
    const removed = accounts.filter(user => options.removeEmails.includes(user.email))
    const removedIds = removed.map(user => user.id)
    if (removedIds.includes(ownerId)) throw new Error('不能删除公司目录所有者')
    await mkdir(options.backupDirectory, { recursive: true, mode: 0o700 })
    const backupPath = join(options.backupDirectory, `accounts-before-cleanup-${Date.now()}-${randomUUID()}.json`)
    await writeFile(backupPath, JSON.stringify({ users: [...removed, ...(existing ? [existing] : [])], keepIds: keep.map(user => user.id), ownerId }, null, 2), { flag: 'wx', mode: 0o600 })
    const adminId = existing?.id ?? randomUUID()
    const grants = { role: UserRole.ADMIN, businessRole: 'admin' as const, workbenchRoles: [...WORKBENCH_ROLES], chartPermissions: [], accountDisabled: false, organizationWorkspaceOwnerId: ownerId, businessEmployeeId: null, businessDepartmentId: null }
    if (existing) await users.update(adminId, { ...grants, sessionVersion: () => 'session_version + 1' })
    else await users.insert({ id: adminId, email: 'admin@hzdrop.com', username: 'admin@hzdrop.com', password: await bcrypt.hash(options.password, 10), ...grants, fopTenantId: null, fopUserId: null })
    if (removedIds.length) {
      // Preserve local notes rather than deleting unrelated work. Other restrictive
      // business FKs intentionally abort the transaction for explicit reconciliation.
      await manager.query('UPDATE folders SET user_id = $1 WHERE user_id = ANY($2::uuid[])', [adminId, removedIds])
      await manager.query('UPDATE notes SET user_id = $1 WHERE user_id = ANY($2::uuid[])', [adminId, removedIds])
      await employees.createQueryBuilder().delete().where('owner_user_id IN (:...ids)', { ids: removedIds }).execute()
      await users.delete(removedIds)
    }
    return { adminId, ownerId, removedEmails: removed.map(user => user.email), keptEmployees: staff.length, backupPath }
  })
}
