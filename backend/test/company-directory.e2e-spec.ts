import { DataSource } from 'typeorm'
import * as bcrypt from 'bcrypt'
import { directoryMembers } from '../src/modules/organization/company-directory'
import { provisionCompanyDirectory } from '../src/database/provision-company-directory'
import { consolidateLocalDirectory } from '../src/database/consolidate-local-directory'
import { CompanyDirectoryAllWorkbenches1793200002000 } from '../src/database/migrations/1793200002000-CompanyDirectoryAllWorkbenches'
import { WORKBENCH_ROLES } from '../src/modules/users/workbench-role'
import { User } from '../src/modules/users/user.entity'
import { OrganizationEmployeeEntity } from '../src/modules/organization/organization-employee.entity'
import { OrganizationService } from '../src/modules/organization/organization.service'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

jest.setTimeout(30000)
describe('company directory transaction (isolated test database)', () => {
  let db: DataSource, backupDirectory: string
  let createdIds: string[] = []
  const emails = ['ethan@hzdrop.com', 'cici@hzdrop.com', 'reid@hzdrop.com']
  const members = directoryMembers([
    ['姓名', '账号', '英文名', '职务', '部门'],
    ['测试总经理', 'directory-test-owner', 'Ethan', '总经理', '测试公司/总经办'],
    ['测试经理', 'directory-test-manager', 'Cici', '部门经理', '测试公司/营销中心/业务一部'],
    ['测试开发', 'directory-test-staff', 'Reid', '后端开发', '测试公司/信息管理部'],
  ])
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.DB_DATABASE = 'autoflow_test'
    db = (await import('../src/database/data-source')).default
    expect(db.options.database).toBe('autoflow_test')
    await db.initialize(); await db.runMigrations()
    if (await db.getRepository(User).createQueryBuilder('u').where('u.email IN (:...emails)', { emails }).getCount()) throw new Error('Test identities already exist; refusing to overwrite')
    backupDirectory = await mkdtemp(join(tmpdir(), 'directory-test-'))
  })
  afterAll(async () => {
    if (db?.isInitialized) {
      if (createdIds.length) {
        await db.query('DELETE FROM organization_employees WHERE account_id = ANY($1::uuid[])', [createdIds])
        await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdIds])
      }
      await db.destroy()
    }
    if (backupDirectory) await rm(backupDirectory, { recursive: true })
  })
  it('previews without creating accounts, then provisions shared directory and distinct scopes', async () => {
    expect(await provisionCompanyDirectory(db, members, { apply: false })).toMatchObject({ total: 3, created: 3, updated: 0 })
    expect(await db.getRepository(User).findOneBy({ email: emails[0] })).toBeNull()
    const imported = await provisionCompanyDirectory(db, members, { apply: true, password: 'TestOnlyPassword123', backupDirectory })
    createdIds = imported.accounts.map(account => account.accountId)
    const owner = await db.getRepository(User).findOneByOrFail({ email: emails[0] })
    const manager = await db.getRepository(User).findOneByOrFail({ email: emails[1] })
    const staff = await db.getRepository(User).findOneByOrFail({ email: emails[2] })
    expect(owner.role).toBe('admin'); expect(manager.role).toBe('user')
    expect(manager.businessRole).toBe('department_manager')
    expect(manager.workbenchRoles).toEqual([...WORKBENCH_ROLES])
    expect(staff.businessRole).toBe('admin')
    expect(staff.chartPermissions.find(p => p.chartId === 'order_volume')?.dataScope).toBe('none')
    expect(await bcrypt.compare('TestOnlyPassword123', manager.password)).toBe(true)
    expect(manager.fopUserId).toBeNull()
    const service = new OrganizationService(db)
    expect((await service.getManagementWorkspace(owner.id)).employees).toHaveLength(3)
    expect((await service.getWorkspace(staff.id)).nodes).toEqual((await service.getWorkspace(owner.id)).nodes)
    await expect(service.getManagementWorkspace(staff.id)).rejects.toMatchObject({ status: 403 })
  })
  it('is idempotent and preserves changed passwords and real FOP bindings on reimport', async () => {
    const owner = await db.getRepository(User).findOneByOrFail({ email: emails[0] })
    await db.getRepository(User).update(owner.id, { password: await bcrypt.hash('ChangedPassword123', 10), fopTenantId: 'real-tenant', fopUserId: 'real-user', businessEmployeeId: 'fop-employee-id', businessDepartmentId: 'fop-department-id' })
    expect(await provisionCompanyDirectory(db, members, { apply: true, password: 'AnotherInitial123', backupDirectory })).toMatchObject({ created: 0, updated: 3 })
    const again = await db.getRepository(User).findOneByOrFail({ id: owner.id })
    expect(await bcrypt.compare('ChangedPassword123', again.password)).toBe(true)
    expect(again.fopUserId).toBe('real-user')
    expect(again.businessEmployeeId).toBe('fop-employee-id')
    expect(again.businessDepartmentId).toBe('fop-department-id')
    expect(await db.getRepository(OrganizationEmployeeEntity).countBy({ ownerUserId: owner.id })).toBe(3)
  })
  it('rejects conflicting identity before applying any profile changes', async () => {
    const conflicting = structuredClone(members)
    conflicting[1].code = 'another-source-person'
    conflicting[1].profile.sourceAccount = 'another-source-person'
    conflicting[0].phone = 'changed'
    await expect(provisionCompanyDirectory(db, conflicting, { apply: true, password: 'TestOnlyPassword123', backupDirectory })).rejects.toThrow(/冲突/)
    expect((await db.getRepository(OrganizationEmployeeEntity).findOneByOrFail({ code: members[0].code })).phone).toBe('')
  })
  it('upgrades existing company workbench grants without changing scopes or unrelated accounts', async () => {
    const users = db.getRepository(User)
    const manager = await users.findOneByOrFail({ email: emails[1] })
    await users.update(manager.id, { workbenchRoles: ['sales'] })
    const unrelated = await users.save(users.create({ email: 'directory-unrelated@example.test', username: 'directory-unrelated', password: 'test-only-hash', businessRole: 'salesperson', workbenchRoles: ['sales'] }))
    createdIds.push(unrelated.id)
    const before = await users.findOneByOrFail({ id: manager.id })
    const runner = db.createQueryRunner()
    try {
      await runner.connect()
      await new CompanyDirectoryAllWorkbenches1793200002000().up(runner)
      const after = await users.findOneByOrFail({ id: manager.id })
      expect(after).toEqual({ ...before, workbenchRoles: [...WORKBENCH_ROLES], sessionVersion: before.sessionVersion + 1, updatedAt: expect.any(Date) })
      expect((await users.findOneByOrFail({ id: unrelated.id })).workbenchRoles).toEqual(['sales'])
      await new CompanyDirectoryAllWorkbenches1793200002000().up(runner)
      expect((await users.findOneByOrFail({ id: manager.id })).sessionVersion).toBe(after.sessionVersion)
      await users.update(manager.id, { businessRole: 'none', workbenchRoles: [] })
      await new CompanyDirectoryAllWorkbenches1793200002000().up(runner)
      expect((await users.findOneByOrFail({ id: manager.id })).workbenchRoles).toEqual([])
      await users.update(manager.id, { businessRole: before.businessRole, workbenchRoles: [...WORKBENCH_ROLES] })
    } finally { await runner.release() }
  })
  it('database accepts none but still rejects malformed policies', async () => {
    const [row] = await db.query(`SELECT autoflow_valid_chart_permissions($1::jsonb) AS valid`, [JSON.stringify([{ chartId: 'order_volume', visibility: 'allow', dataScope: 'none', summaryMode: 'marketing', summaryDepartments: [], details: 'deny', export: 'deny' }])])
    expect(row.valid).toBe(true)
    for (const value of ['{}', '[null]', '[{"dataScope":"none"}]']) expect((await db.query('SELECT autoflow_valid_chart_permissions($1::jsonb) AS valid', [value]))[0].valid).toBe(false)
  })
  it('retains a single non-employee admin linked to the shared directory and removes only explicitly selected legacy accounts', async () => {
    const users = db.getRepository(User)
    if (await users.findOneBy({ email: 'admin@hzdrop.com' })) throw new Error('Test admin already exists')
    const legacy = await users.save(users.create({ email: 'directory-legacy@example.test', username: 'directory-test-legacy', password: await bcrypt.hash('LegacyOnly123', 10) }))
    createdIds.push(legacy.id)
    const result = await consolidateLocalDirectory(db, { keepEmails: emails, removeEmails: [legacy.email], password: 'TestOnlyPassword123', backupDirectory })
    createdIds.push(result.adminId)
    const admin = await users.findOneByOrFail({ id: result.adminId })
    expect(admin.email).toBe('admin@hzdrop.com')
    expect(await users.findOneBy({ id: legacy.id })).toBeNull()
    expect(await db.getRepository(OrganizationEmployeeEntity).findOneBy({ accountId: admin.id })).toBeNull()
    expect((await new OrganizationService(db).getManagementWorkspace(admin.id)).employees).toHaveLength(3)
    // Remove the link first during cleanup; FK intentionally protects the company owner.
    await users.update(admin.id, { organizationWorkspaceOwnerId: null })
  })
})
