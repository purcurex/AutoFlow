import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { DataSource } from 'typeorm'
import * as request from 'supertest'
import { UsersService } from '../src/modules/users/users.service'
import { OrganizationService } from '../src/modules/organization/organization.service'
import { DemoFopDataProvider } from '../src/modules/fop-data/fop-demo.provider'
import { FopDataService } from '../src/modules/fop-data/fop-data.service'

jest.setTimeout(30000)
describe('Administrator employee account provisioning', () => {
  let app: INestApplication, db: DataSource, jwt: JwtService, adminId: string, otherId: string, staffId: string
  let departmentId: string, otherDepartmentId: string
  const created: string[] = []
  const auth = (id = adminId) => jwt.sign({ userId: id, role: 'admin' })
  const get = (id = adminId) => request(app.getHttpServer()).get('/api/organization').auth(auth(id), { type: 'bearer' })
  const create = (body: object, actor = adminId) => request(app.getHttpServer()).post('/api/organization/employees').auth(auth(actor), { type: 'bearer' }).send(body)
  const open = (id: string, body: object, actor = adminId) => request(app.getHttpServer()).post(`/api/organization/employees/${id}/account`).auth(auth(actor), { type: 'bearer' }).send(body)
  const account = (suffix: string) => ({ username: `employee-${suffix}`, password: 'EmployeeLocal123', fopBinding: null })
  const employee = (suffix: string) => ({ name: `测试员工 ${suffix}`, code: `NEW-${suffix}`, email: `employee-${suffix}@autoflow.test`, departmentId, workbenchRoles: ['sales', 'dispatch'] })
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.DB_DATABASE = 'autoflow_test'; process.env.ENABLE_ADMIN_BOOTSTRAP = 'false'
    const { default: source } = await import('../src/database/data-source')
    await source.initialize(); await source.runMigrations(); await source.destroy()
    const { AppModule } = await import('../src/app.module')
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = module.createNestApplication(); app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    await app.init(); db = app.get(DataSource); jwt = app.get(JwtService)
    const users = app.get(UsersService)
    adminId = (await users.create('employee-admin@autoflow.test', 'employee-admin', 'StrongPassword123')).id
    otherId = (await users.create('employee-other@autoflow.test', 'employee-other', 'StrongPassword123')).id
    staffId = (await users.create('employee-staff@autoflow.test', 'employee-staff', 'StrongPassword123')).id
    await db.query("UPDATE users SET role = 'admin', business_role = 'none' WHERE id = ANY($1::uuid[])", [[adminId, otherId]])
    departmentId = (await get().expect(200)).body.nodes.find((node: any) => node.name === '业务一部').id
    otherDepartmentId = (await get(otherId).expect(200)).body.nodes.find((node: any) => node.name === '业务一部').id
  })
  afterAll(async () => {
    if (db?.isInitialized) {
      // Accounts created by a failed assertion are cleaned too.
      await db.query("DELETE FROM users WHERE email LIKE 'employee-%@autoflow.test'")
    }
    await app?.close()
  })
  it('creates a department employee and a working ordinary login atomically, exposing no credentials', async () => {
    const result = await create({ ...employee('one'), account: account('one') }).expect(201)
    const member = result.body.employees.find((row: any) => row.code === 'NEW-one')
    expect(member).toMatchObject({ departmentId, accountId: expect.any(String), workbenchRoles: ['sales', 'dispatch'] })
    created.push(member.accountId)
    expect(JSON.stringify(result.body)).not.toMatch(/EmployeeLocal123|password|\$2[aby]\$/)
    const saved = await app.get(UsersService).findById(member.accountId)
    expect(saved).toMatchObject({ role: 'user', businessRole: 'salesperson', businessEmployeeId: member.id, businessDepartmentId: departmentId, fopTenantId: null, fopUserId: null })
    expect(saved!.password).not.toBe('EmployeeLocal123')
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email: employee('one').email, password: account('one').password }).expect(201)
    expect(login.body.user.id).toBe(member.accountId)
    await get(member.accountId).expect(403)
    const page = await request(app.getHttpServer()).get('/api/users/workbench-accounts').auth(auth(), { type: 'bearer' }).expect(200)
    expect(page.body.items.find((row: any) => row.id === member.accountId).employee).toMatchObject({ id: member.id, name: member.name, department: { id: departmentId, name: '业务一部' } })
  })
  it('allows employee-only creation and later opens exactly one account with an optional FOP identity', async () => {
    const result = await create(employee('later')).expect(201)
    const member = result.body.employees.find((row: any) => row.code === 'NEW-later')
    expect(member.accountId).toBeNull()
    const binding = { tenantId: 'employee-test-tenant', userId: 'fop-worker-1' }
    const linked = await open(member.id, { ...account('later'), fopBinding: binding }).expect(201)
    const id = linked.body.employees.find((row: any) => row.id === member.id).accountId
    created.push(id)
    expect(await app.get(UsersService).findById(id)).toMatchObject({ fopTenantId: binding.tenantId, fopUserId: binding.userId, role: 'user' })
    await open(member.id, account('duplicate')).expect(409)
    await create({ ...employee('duplicate-fop'), account: { ...account('duplicate-fop'), fopBinding: binding } }).expect(409)
    expect((await get().expect(200)).body.employees.some((row: any) => row.code === 'NEW-duplicate-fop')).toBe(false)
  })
  it('rejects unauthenticated, non-management, forged grants and cross-directory creation', async () => {
    await request(app.getHttpServer()).post('/api/organization/employees').send(employee('unauth')).expect(401)
    await create(employee('forbidden'), staffId).expect(403)
    await db.query("UPDATE users SET business_role = 'admin' WHERE id = $1", [staffId])
    await create(employee('business-admin'), staffId).expect(403)
    await create({ ...employee('cross'), departmentId: otherDepartmentId }).expect(404)
    await create({ ...employee('forged'), account: { ...account('forged'), role: 'admin' } }).expect(400)
    await create({ ...employee('owner'), ownerUserId: otherId }).expect(400)
    const root = (await get().expect(200)).body.nodes.find((row: any) => row.parentId === null)
    await create({ ...employee('root'), departmentId: root.id }).expect(409)
    const existing = (await get().expect(200)).body.employees.find((row: any) => row.code === 'EMP001')
    await open(existing.id, account('cross'), otherId).expect(404)
  })
  it('rolls back duplicate and invalid provisioning without orphan employees or accounts', async () => {
    const before = (await get().expect(200)).body.employees.length
    await create({ ...employee('email-duplicate'), email: employee('one').email, account: account('email-duplicate') }).expect(409)
    await create({ ...employee('name-duplicate'), account: account('one') }).expect(409)
    await create({ ...employee('one'), email: 'employee-different@autoflow.test' }).expect(409)
    await create({ ...employee('weak'), account: { ...account('weak'), password: 'short' } }).expect(400)
    await create({ ...employee('bad-fop'), account: { ...account('bad-fop'), fopBinding: { tenantId: 't' } } }).expect(400)
    for (const invalid of [[], [account('array')]]) await create({ ...employee('array-account'), account: invalid }).expect(400)
    for (const invalid of [[], [{ tenantId: 't', userId: 'u' }]]) await create({ ...employee('array-binding'), account: { ...account('array-binding'), fopBinding: invalid } }).expect(400)
    const unopened = (await get().expect(200)).body.employees.find((row: any) => !row.accountId)
    await open(unopened.id, { ...account('array-later'), fopBinding: [{ tenantId: 't', userId: 'u' }] }).expect(400)
    expect((await get().expect(200)).body.employees).toHaveLength(before)
  })
  it('keeps the linked demo directory consistent while returning only the new employee’s own business data', async () => {
    const user = await app.get(UsersService).findById(created[0])
    const org = app.get(OrganizationService)
    const workspace = await org.getWorkspace(created[0])
    expect(workspace.employees.find(row => row.code === 'NEW-one')?.id).toBe(user!.businessEmployeeId)
    const data = new FopDataService(app.get(UsersService), new DemoFopDataProvider(org, { NODE_ENV: 'test', FOP_DATA_MODE: 'demo' }))
    const rows = await data.getOrders(created[0], { queue: 'dispatch', page: 1, pageSize: 100 })
    expect(rows.total).toBeGreaterThan(0)
    expect(rows.items.every(row => row.owner?.id === user!.businessEmployeeId)).toBe(true)
  })
  it('serializes duplicate provisioning and keeps a single employee-account pair', async () => {
    const body = { ...employee('concurrent'), account: account('concurrent') }
    const results = await Promise.all([create(body), create(body)])
    expect(results.map(row => row.status).sort()).toEqual([201, 409])
    const members = (await get().expect(200)).body.employees.filter((row: any) => row.code === body.code)
    expect(members).toHaveLength(1)
    expect(members[0].accountId).toBeTruthy()
  })
  it('updates personal local assignments on a department move but preserves independently configured manager scopes', async () => {
    const directory = (await get().expect(200)).body
    const member = directory.employees.find((row: any) => row.accountId === created[0])
    const target = directory.nodes.find((row: any) => row.name === '业务二部')
    const move = (department: string) => request(app.getHttpServer()).put(`/api/organization/employees/${member.id}`).auth(auth(), { type: 'bearer' }).send({ departmentId: department })
    await move(target.id).expect(200)
    expect(await app.get(UsersService).findById(created[0])).toMatchObject({ businessDepartmentId: target.id, businessEmployeeId: member.id, role: 'user' })
    await db.query("UPDATE users SET business_role = 'department_manager', business_department_id = 'fop-managed-dept' WHERE id = $1", [created[0]])
    await move(departmentId).expect(200)
    expect(await app.get(UsersService).findById(created[0])).toMatchObject({ businessDepartmentId: 'fop-managed-dept', businessRole: 'department_manager' })
  })
  it('edits member and account details without changing grants and revokes sessions on password reset', async () => {
    const result = await create({ ...employee('edit'), account: account('edit') }).expect(201)
    const member = result.body.employees.find((row: any) => row.code === 'NEW-edit')
    const put = (path: string, body: object, actor = adminId) => request(app.getHttpServer()).put(`/api/organization/${path}`).auth(auth(actor), { type: 'bearer' }).send(body)
    await put(`employees/${member.id}/details`, { ...employee('edit'), name: 'Edited employee', email: 'employee-edit-updated@autoflow.test', phone: '+1 555 0100', jobTitle: '外贸业务员' }).expect(200)
    expect(await app.get(UsersService).findById(member.accountId)).toMatchObject({ email: 'employee-edit-updated@autoflow.test', role: 'user', businessRole: 'salesperson', workbenchRoles: ['sales', 'dispatch'] })
    await put(`employees/${member.id}/details`, employee('edit'), otherId).expect(404)
    const oldToken = auth(member.accountId)
    await put(`accounts/${member.accountId}`, { username: 'employee-edited', email: 'employee-edit-updated@autoflow.test', password: 'UpdatedPassword123', fopBinding: { tenantId: 'test', userId: 'edited' } }).expect(200)
    await request(app.getHttpServer()).get('/api/users/profile').auth(oldToken, { type: 'bearer' }).expect(401)
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'employee-edit-updated@autoflow.test', password: 'UpdatedPassword123' }).expect(201)
    await put(`accounts/${member.accountId}`, { username: 'employee-edited', email: 'employee-edit-updated@autoflow.test', role: 'admin' }).expect(400)
  })
  it('previews CSV and atomically imports members in the selected department without opening accounts', async () => {
    const preview = await request(app.getHttpServer()).post('/api/organization/employees/import-preview').auth(auth(), { type: 'bearer' })
      .field('departmentId', departmentId).attach('file', Buffer.from('\ufeff姓名,员工编号,邮箱,职务,手机\n"导入,甲",IMPORT-A,employee-import-a@autoflow.test,外贸业务员,0101\n导入乙,IMPORT-B,employee-import-b@autoflow.test,采购员,0102'), 'employees.csv').expect(201)
    expect(preview.body.errors).toEqual([])
    expect(preview.body.employees[0]).toMatchObject({ name: '导入,甲', code: 'IMPORT-A', phone: '0101' })
    const payload = { departmentId, employees: preview.body.employees }
    await request(app.getHttpServer()).post('/api/organization/employees/import').auth(auth(), { type: 'bearer' }).send(payload).expect(201)
    const imported = (await get().expect(200)).body.employees.filter((row: any) => row.code.startsWith('IMPORT-'))
    expect(imported).toHaveLength(2); expect(imported.every((row: any) => row.departmentId === departmentId && row.accountId === null)).toBe(true)
    const conflict = { ...payload, employees: [{ ...payload.employees[0], code: 'NEW-ROLLBACK', email: 'employee-import-new@autoflow.test' }, payload.employees[1]] }
    await request(app.getHttpServer()).post('/api/organization/employees/import').auth(auth(), { type: 'bearer' }).send(conflict).expect(409)
    expect((await get().expect(200)).body.employees.some((row: any) => row.code === 'NEW-ROLLBACK')).toBe(false)
    await request(app.getHttpServer()).post('/api/organization/employees/import').auth(auth(staffId), { type: 'bearer' }).send(payload).expect(403)
  })
  it('removes members from the active list, disables linked logins and retains historical identities', async () => {
    const result = await create({ ...employee('remove'), account: account('remove') }).expect(201)
    const member = result.body.employees.find((row: any) => row.code === 'NEW-remove')
    const remove = (ids: string[], actor = adminId) => request(app.getHttpServer()).post('/api/organization/employees/remove').auth(auth(actor), { type: 'bearer' }).send({ ids })
    await remove([member.id], otherId).expect(404)
    const removed = await remove([member.id]).expect(201)
    expect(removed.body.employees.some((row: any) => row.id === member.id)).toBe(false)
    expect((await db.query('SELECT archived_at FROM organization_employees WHERE id = $1', [member.id]))[0].archived_at).toBeTruthy()
    expect(await app.get(UsersService).findById(member.accountId)).toMatchObject({ accountDisabled: true })
    await request(app.getHttpServer()).get('/api/users/profile').auth(auth(member.accountId), { type: 'bearer' }).expect(401)
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: employee('remove').email, password: account('remove').password }).expect(401)
    await remove([member.id]).expect(404)
    const preview = await request(app.getHttpServer()).post('/api/organization/employees/import-preview').auth(auth(), { type: 'bearer' })
      .field('departmentId', departmentId).attach('file', Buffer.from('姓名,员工编号,邮箱,职务,手机\n,,,,\n甲,NEW-remove,employee-remove@autoflow.test,,'), 'archived.csv').expect(201)
    expect(preview.body.errors).toContainEqual({ row: 3, message: expect.stringContaining('已删除成员') })
    const promoted = await create({ ...employee('protected'), account: account('protected') }).expect(201)
    const adminMember = promoted.body.employees.find((row: any) => row.code === 'NEW-protected')
    await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [adminMember.accountId])
    await remove([adminMember.id]).expect(409)
  })
})
