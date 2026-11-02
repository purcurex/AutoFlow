import { INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { DataSource } from 'typeorm'
import * as request from 'supertest'
import { UsersService } from '../src/modules/users/users.service'
import { flattenDemoSalesDepartments } from '../src/database/flatten-demo-sales-departments'

jest.setTimeout(30000)

describe('Per-account organization sandbox persistence API', () => {
  let app: INestApplication
  let database: DataSource
  let jwt: JwtService
  let ownerId: string
  let otherId: string
  const auth = (id = ownerId) => jwt.sign({ userId: id, role: 'user' })
  const get = (id = ownerId) => request(app.getHttpServer()).get('/api/organization').auth(auth(id), { type: 'bearer' })
  const create = (body: object, id = ownerId) => request(app.getHttpServer()).post('/api/organization/nodes').auth(auth(id), { type: 'bearer' }).send(body)
  const update = (nodeId: string, body: object, id = ownerId) => request(app.getHttpServer()).put(`/api/organization/nodes/${nodeId}`).auth(auth(id), { type: 'bearer' }).send(body)
  const remove = (nodeId: string, id = ownerId) => request(app.getHttpServer()).delete(`/api/organization/nodes/${nodeId}`).auth(auth(id), { type: 'bearer' })
  const assign = (employeeId: string, departmentId: string, id = ownerId) => request(app.getHttpServer()).put(`/api/organization/employees/${employeeId}`).auth(auth(id), { type: 'bearer' }).send({ departmentId })

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DB_DATABASE = 'autoflow_test'
    process.env.ENABLE_ADMIN_BOOTSTRAP = 'false'
    const { default: migrationSource } = await import('../src/database/data-source')
    await migrationSource.initialize()
    await migrationSource.runMigrations()
    await migrationSource.destroy()
    const { AppModule } = await import('../src/app.module')
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    await app.init()
    database = app.get(DataSource)
    jwt = app.get(JwtService)
    const users = app.get(UsersService)
    ownerId = (await users.create('organization-owner@autoflow.test', 'organization-owner', 'StrongPassword123')).id
    otherId = (await users.create('organization-other@autoflow.test', 'organization-other', 'StrongPassword123')).id
    await database.query("UPDATE users SET role = 'admin', business_role = 'none' WHERE id = ANY($1::uuid[])", [[ownerId, otherId]])
  })

  afterAll(async () => {
    if (database?.isInitialized) await database.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ownerId, otherId].filter(Boolean)])
    await app?.close()
  })

  it('requires authentication and rejects caller-supplied ownership', async () => {
    await request(app.getHttpServer()).get('/api/organization').expect(401)
    await request(app.getHttpServer()).get(`/api/organization?ownerUserId=${otherId}`).auth(auth(), { type: 'bearer' }).expect(400)
  })

  it('lazily seeds independent persistent HyperZone workspaces without granting account privileges', async () => {
    const [first, again, other] = await Promise.all([get().expect(200), get().expect(200), get(otherId).expect(200)])
    expect(first.body).toMatchObject({ source: 'mock', canEdit: true })
    expect(first.headers['cache-control']).toBe('private, no-store')
    expect(first.body.nodes.filter((node: any) => node.parentId === null)).toEqual([
      expect.objectContaining({ name: 'HyperZone', kind: 'organization' }),
    ])
    expect(first.body.nodes.length).toBeGreaterThanOrEqual(25)
    expect(first.body.employees).toHaveLength(23)
    expect(first.body.employees.find((employee: any) => employee.code === 'EMP001').name).toBe('曹可滢（Ruth）')
    expect(first.body.employees.find((employee: any) => employee.code === 'EMP022').name).toBe('杨莹（Kiki）')
    // Sales staff report directly to one of the four business departments.
    for (const [name, count] of [['业务一部', 5], ['业务二部', 4], ['业务三部', 5], ['业务四部', 1]]) {
      const department = first.body.nodes.find((node: any) => node.name === name)
      expect(first.body.employees.filter((employee: any) => employee.departmentId === department.id)).toHaveLength(count as number)
      expect(first.body.nodes.filter((node: any) => node.parentId === department.id)).toHaveLength(0)
    }
    expect(first.body).toEqual(again.body)
    expect(other.body.nodes[0].id).not.toBe(first.body.nodes[0].id)
    expect(JSON.stringify(first.body)).not.toContain('password')
    expect(JSON.stringify(first.body)).not.toContain('ownerUserId')
    const owner = await app.get(UsersService).findById(ownerId)
    expect(owner?.role).toBe('admin')
    expect(owner?.businessRole).toBe('none')
    expect(owner?.workbenchRoles).toEqual(['sales'])
  })

  it('persists creation, renaming, reparenting, ordering and deletion for the owner only', async () => {
    const initial = (await get().expect(200)).body
    const root = initial.nodes.find((node: any) => node.parentId === null)
    const marketing = initial.nodes.find((node: any) => node.name === '营销中心')
    const created = (await create({ parentId: root.id, name: ' 新团队 ', sortOrder: 42 }).expect(201)).body
    const node = created.nodes.find((item: any) => item.name === '新团队')
    expect(node).toMatchObject({ parentId: root.id, kind: 'department', sortOrder: 42 })
    await update(node.id, { name: '区域团队', parentId: marketing.id, sortOrder: 7 }).expect(200)
    const persisted = (await get().expect(200)).body.nodes.find((item: any) => item.id === node.id)
    expect(persisted).toMatchObject({ name: '区域团队', parentId: marketing.id, sortOrder: 7 })
    await update(node.id, { name: 'cross-owner' }, otherId).expect(404)
    await remove(node.id, otherId).expect(404)
    await create({ parentId: root.id, name: 'cross-parent' }, otherId).expect(404)
    const deleted = await remove(node.id).expect(200)
    expect(deleted.body.nodes.some((item: any) => item.id === node.id)).toBe(false)
  })

  it('upgrades legacy demo groups without losing employees, custom groups or account data scopes', async () => {
    const initial = (await get().expect(200)).body
    const sales = initial.nodes.find((node: any) => node.name === '业务一部')
    const sales2 = initial.nodes.find((node: any) => node.name === '业务二部')
    const sales3 = initial.nodes.find((node: any) => node.name === '业务三部')
    const employee = initial.employees.find((row: any) => row.code === 'EMP001')
    const add = async (parentId: string, name: string) => (await create({ parentId, name }).expect(201)).body.nodes.find((node: any) => node.name === name)
    const legacy = await add(sales.id, '欧洲销售组')
    const custom = await add(sales.id, '自定义销售组')
    const scoped = await add(sales2.id, '北美销售组')
    const nested = await add(sales3.id, '亚太销售组')
    const child = await add(nested.id, '自定义下级')
    await assign(employee.id, legacy.id).expect(200)
    await database.query('UPDATE users SET business_department_id = $1 WHERE id = $2', [scoped.id, otherId])
    const result = await database.transaction(manager => flattenDemoSalesDepartments(manager, ownerId))
    expect(result).toMatchObject({ moved: 1, removed: 1 })
    expect(result.skipped).toHaveLength(2)
    const after = (await get().expect(200)).body
    expect(after.employees).toHaveLength(initial.employees.length)
    expect(after.employees.find((row: any) => row.id === employee.id)).toEqual(employee)
    expect(after.nodes.some((node: any) => node.id === legacy.id)).toBe(false)
    for (const kept of [custom, scoped, nested, child]) expect(after.nodes).toContainEqual(kept)
    expect((await app.get(UsersService).findById(otherId))?.businessDepartmentId).toBe(scoped.id)
    const again = await database.transaction(manager => flattenDemoSalesDepartments(manager, ownerId))
    expect(again).toMatchObject({ moved: 0, removed: 0 })
    await database.query('UPDATE users SET business_department_id = NULL WHERE id = $1', [otherId])
    for (const node of [custom, scoped, child, nested]) await remove(node.id).expect(200)
  })

  it('rejects root deletion, duplicate roots, cycles and nonempty subtree deletion', async () => {
    const initial = (await get().expect(200)).body
    const root = initial.nodes.find((node: any) => node.parentId === null)
    const marketing = initial.nodes.find((node: any) => node.name === '营销中心')
    const sales = initial.nodes.find((node: any) => node.name === '业务一部')
    await remove(root.id).expect(409)
    await update(root.id, { parentId: marketing.id }).expect(409)
    await create({ parentId: null, name: 'Another root', kind: 'organization' }).expect(400)
    await update(marketing.id, { parentId: sales.id }).expect(409)
    await update(marketing.id, { parentId: marketing.id }).expect(409)
    await remove(marketing.id).expect(409)
    const employee = initial.employees[0]
    await remove(employee.departmentId).expect(409)
    const otherRoot = (await get(otherId).expect(200)).body.nodes.find((node: any) => node.parentId === null)
    await update(marketing.id, { parentId: otherRoot.id }).expect(404)
  })

  it('persists synthetic employee assignment without permitting cross-owner or root placement', async () => {
    const initial = (await get().expect(200)).body
    const root = initial.nodes.find((node: any) => node.parentId === null)
    const employee = initial.employees[0]
    const created = (await create({ parentId: root.id, name: '员工归属测试' }).expect(201)).body
    const department = created.nodes.find((node: any) => node.name === '员工归属测试')
    await assign(employee.id, department.id, otherId).expect(404)
    const otherDepartment = (await get(otherId).expect(200)).body.employees[0].departmentId
    await assign(employee.id, otherDepartment).expect(404)
    await assign(employee.id, root.id).expect(409)
    const assigned = await assign(employee.id, department.id).expect(200)
    expect(assigned.body.employees.find((item: any) => item.id === employee.id).departmentId).toBe(department.id)
    await remove(department.id).expect(409)
    await assign(employee.id, employee.departmentId).expect(200)
    await remove(department.id).expect(200)
  })

  it('enforces unique roots and cross-owner parent/employee references in PostgreSQL too', async () => {
    const first = (await get().expect(200)).body
    const second = (await get(otherId).expect(200)).body
    const ownDepartment = first.nodes.find((node: any) => node.kind === 'department')
    const otherDepartment = second.nodes.find((node: any) => node.kind === 'department')
    await expect(database.query('INSERT INTO organization_nodes(owner_user_id, parent_id, name, kind) VALUES ($1, NULL, $2, $3)', [ownerId, 'Duplicate root', 'organization']))
      .rejects.toMatchObject({ driverError: { code: '23505' } })
    await expect(database.query('UPDATE organization_nodes SET parent_id = $1 WHERE id = $2', [otherDepartment.id, ownDepartment.id]))
      .rejects.toMatchObject({ driverError: { code: '23503' } })
    await expect(database.query('UPDATE organization_employees SET department_id = $1 WHERE id = $2', [otherDepartment.id, first.employees[0].id]))
      .rejects.toMatchObject({ driverError: { code: '23503' } })
  })

  it('serializes concurrent moves so reciprocal reparenting cannot create a cycle', async () => {
    const initial = (await get().expect(200)).body
    const root = initial.nodes.find((node: any) => node.parentId === null)
    const first = (await create({ parentId: root.id, name: '并发组A' }).expect(201)).body.nodes.find((node: any) => node.name === '并发组A')
    const second = (await create({ parentId: root.id, name: '并发组B' }).expect(201)).body.nodes.find((node: any) => node.name === '并发组B')
    const results = await Promise.all([update(first.id, { parentId: second.id }), update(second.id, { parentId: first.id })])
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
    const workspace = (await get().expect(200)).body
    const a = workspace.nodes.find((node: any) => node.id === first.id)
    const b = workspace.nodes.find((node: any) => node.id === second.id)
    expect(a.parentId === b.id && b.parentId === a.id).toBe(false)
  })

  it('rejects malformed mutation fields and forged employee grants', async () => {
    const initial = (await get().expect(200)).body
    const root = initial.nodes.find((node: any) => node.parentId === null)
    for (const body of [{ name: ' ', parentId: root.id }, { name: 'x', parentId: 'bad-id' }, { name: 'x', parentId: root.id, ownerUserId: otherId }, { name: 'x', parentId: root.id, sortOrder: -1 }]) {
      await create(body).expect(400)
    }
    await request(app.getHttpServer()).put(`/api/organization/employees/${initial.employees[0].id}`).auth(auth(), { type: 'bearer' })
      .send({ departmentId: root.id, workbenchRoles: ['admin'] }).expect(400)
  })
  it('prevents department managers and salespeople from expanding their scope by moving departments or employees', async () => {
    const workspace = (await get(otherId).expect(200)).body
    const department = workspace.nodes.find((node: any) => node.kind === 'department')
    await database.query("UPDATE users SET role = 'user', business_role = 'department_manager', business_department_id = $1 WHERE id = $2", [department.id, otherId])
    await get(otherId).expect(403)
    await create({ parentId: department.id, name: 'Scope expansion' }, otherId).expect(403)
    await assign(workspace.employees[0].id, department.id, otherId).expect(403)
    await update(department.id, { name: 'Forbidden rename' }, otherId).expect(403)
    await remove(department.id, otherId).expect(403)
  })

  it('denies reads, writes and exports across business modules for a management-only administrator', async () => {
    const paths = [
      '/autoflow/dashboard', '/autoflow/workflows', '/autoflow/leads', '/autoflow/quotes',
      '/notes', '/notes/admin/all', '/folders', '/ai/outreach-conversations',
      '/autoflow/integrations/fop/dashboard', '/autoflow/integrations/fop/order-volume',
      `/autoflow/quotes/${otherId}/versions/1/export.xlsx`,
      `/autoflow/workflows/${otherId}/sourcing`,
    ]
    for (const path of paths) {
      const result = await request(app.getHttpServer()).get(`/api${path}`).auth(auth(), { type: 'bearer' })
      expect({ path, status: result.status, code: result.body.code }).toEqual({ path, status: 403, code: 'business_access_disabled' })
    }
    for (const path of ['/autoflow/workflows', '/autoflow/quotes', '/notes', '/ai/outreach-conversations']) {
      await request(app.getHttpServer()).post(`/api${path}`).auth(auth(), { type: 'bearer' }).send({}).expect(403)
    }
    await request(app.getHttpServer()).get('/api/users/workbench-accounts').auth(auth(), { type: 'bearer' }).expect(200)
    await request(app.getHttpServer()).get('/api/users/profile').auth(auth(), { type: 'bearer' }).expect(200)
    expect((await get().expect(200)).body.canEdit).toBe(true)
  })

  it('assigns management independently, rejects self-demotion and observes revocation with the existing JWT', async () => {
    const change = (id: string, role: string, actor = ownerId) => request(app.getHttpServer())
      .put(`/api/users/${id}/management-role`).auth(auth(actor), { type: 'bearer' }).send({ role })
    await database.query("UPDATE users SET role = 'user', business_role = 'admin' WHERE id = $1", [otherId])
    await get(otherId).expect(403)
    await change(ownerId, 'admin', otherId).expect(403)
    await change(otherId, 'manager').expect(400)
    await change(ownerId, 'user').expect(409)
    const granted = await change(otherId, 'admin').expect(200)
    expect(granted.body).toMatchObject({ role: 'admin', businessScope: { role: 'admin' } })
    expect(granted.body).not.toHaveProperty('password')
    expect((await get(otherId).expect(200)).body.canEdit).toBe(true)
    await change(otherId, 'user').expect(200)
    await get(otherId).expect(403)
    await change(ownerId, 'admin', otherId).expect(403)
    expect((await app.get(UsersService).findById(otherId))?.businessRole).toBe('admin')
  })

})
