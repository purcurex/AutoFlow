import { INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import * as request from 'supertest'
import * as bcrypt from 'bcrypt'
import { UsersModule } from '../src/modules/users/users.module'
import { User, UserRole } from '../src/modules/users/user.entity'
import { AuthController } from '../src/modules/auth/auth.controller'
import { AuthService } from '../src/modules/auth/auth.service'
import { JwtStrategy } from '../src/modules/auth/jwt.strategy'
import { VerificationService } from '../src/modules/auth/verification.service'
import { AutoflowController } from '../src/modules/autoflow/autoflow.controller'
import { AutoflowService } from '../src/modules/autoflow/autoflow.service'
import { WorkflowExecutionService } from '../src/modules/discovery/workflow-execution.service'
import { WorkflowSeedAssetService } from '../src/modules/autoflow/workflow-seed-asset.service'

describe('Workbench authorization HTTP API (repository boundary stub)', () => {
  let app: INestApplication
  let jwt: JwtService
  let accounts: Map<string, any>
  const userId = '2fbc1fd8-5af5-4a1f-9a1e-3206109c43cf'
  const adminId = '2fbc1fd8-5af5-4a1f-9a1e-3206109c43ca'
  const secret = 'workbench-test-secret'
  const token = (id = userId) => jwt.sign({ userId: id, role: 'admin', email: 'stale@example.test' })
  const get = (path: string, id = userId) => request(app.getHttpServer()).get(`/api${path}`).auth(token(id), { type: 'bearer' })
  const put = (roles: unknown, id = adminId) => request(app.getHttpServer())
    .put(`/api/users/${userId}/workbench-roles`).auth(token(id), { type: 'bearer' }).send({ workbenchRoles: roles })

  beforeAll(async () => {
    const repository = {
      findOne: async ({ where }: any) => [...accounts.values()].find((account) =>
        Object.entries(where).every(([key, value]) => account[key] === value)) ?? null,
      save: async (account: any) => { accounts.set(account.id, account); return account },
      update: async (id: string, changes: any) => { Object.assign(accounts.get(id), changes) },
      create: (account: any) => ({ id: 'new-user', displayId: '000003', ...account }),
      findAndCount: async ({ skip = 0, take = 20 }: any) => [
        [...accounts.values()].slice(skip, skip + take), accounts.size,
      ],
    }
    const module = await Test.createTestingModule({
      imports: [UsersModule, JwtModule.register({ secret })],
      controllers: [AuthController, AutoflowController],
      providers: [
        AuthService, JwtStrategy,
        { provide: ConfigService, useValue: new ConfigService({ JWT_SECRET: secret }) },
        { provide: VerificationService, useValue: { verifyCode: () => ({ valid: true }) } },
        { provide: AutoflowService, useValue: { getDashboard: () => ({ leadCount: 0 }) } },
        { provide: WorkflowExecutionService, useValue: {} },
        { provide: WorkflowSeedAssetService, useValue: {} },
      ],
    }).overrideProvider(getRepositoryToken(User)).useValue(repository).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    jwt = module.get(JwtService)
    await app.init()
  })

  beforeEach(async () => {
    const password = await bcrypt.hash('StrongPassword123', 4)
    accounts = new Map([
      [userId, { id: userId, displayId: '000001', email: 'sales@example.test', username: 'sales', password, role: UserRole.USER, workbenchRoles: ['sales'] }],
      [adminId, { id: adminId, displayId: '000002', email: 'admin@example.test', username: 'admin', password, role: UserRole.ADMIN, businessRole: 'admin', workbenchRoles: [] }],
    ])
  })

  afterAll(async () => { await app?.close() })

  it('requires authentication and reads effective grants from the current database account', async () => {
    await request(app.getHttpServer()).get('/api/workbench/access').expect(401)
    const response = await get('/workbench/access').expect(200)
    expect(response.body).toMatchObject({ roles: ['sales'], isAdmin: false })
    await get('/workbench/procurement/access').expect(403)
    await get('/workbench/not-a-role/access').expect(400)
    accounts.get(userId).workbenchRoles = []
    await get('/workbench/sales/access').expect(403)
    accounts.delete(userId)
    await get('/workbench/access').expect(401)
  })

  it('keeps business grants unchanged when system management is revoked', async () => {
    const response = await get('/workbench/access', adminId).expect(200)
    expect(response.body).toMatchObject({ roles: ['sales', 'procurement', 'allocation', 'dispatch', 'warehouse'], isAdmin: true })
    accounts.get(adminId).role = UserRole.USER
    await get('/workbench/warehouse/access', adminId).expect(200)
    await get('/users/workbench-accounts', adminId).expect(403)
  })

  it('restricts account enumeration and updates to database admins without returning passwords', async () => {
    await get('/users/workbench-accounts').expect(403)
    await put(['warehouse'], userId).expect(403)
    const listing = await get('/users/workbench-accounts?page=1&pageSize=1', adminId).expect(200)
    expect(listing.body.total).toBe(2)
    expect(listing.body.items).toHaveLength(1)
    expect(listing.body.items[0]).not.toHaveProperty('password')
    const updated = await put(['procurement', 'warehouse']).expect(200)
    expect(updated.body).toMatchObject({ id: userId, role: 'user', workbenchRoles: ['procurement', 'warehouse'] })
    expect(updated.body).not.toHaveProperty('password')
    await get('/workbench/warehouse/access').expect(200)
    await get('/workbench/sales/access').expect(403)
    await put([]).expect(200)
    await get('/workbench/warehouse/access').expect(403)
  })

  it.each([null, 'sales', ['admin'], ['sales', 'sales'], ['sales', 'procurement', 'allocation', 'dispatch', 'warehouse', 'sales']])('rejects invalid role input %j', async (roles) => {
    await put(roles).expect(400)
    expect(accounts.get(userId).workbenchRoles).toEqual(['sales'])
  })

  it('prevents self profile escalation and validates bounded account queries', async () => {
    await request(app.getHttpServer()).put('/api/users/profile').auth(token(), { type: 'bearer' })
      .send({ workbenchRoles: ['warehouse'] }).expect(400)
    for (const query of ['page=0', 'pageSize=101', 'page=1.5', 'search=' + 'x'.repeat(201), 'extra=true']) {
      await get(`/users/workbench-accounts?${query}`, adminId).expect(400)
    }
  })

  it('returns persisted workbench assignments from login, registration and profiles', async () => {
    const login = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: 'sales@example.test', password: 'StrongPassword123' }).expect(201)
    expect(login.body.user.workbenchRoles).toEqual(['sales'])
    const registered = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ email: 'new@example.test', username: 'new-user', password: 'StrongPassword123', verificationCode: '123456' }).expect(201)
    expect(registered.body.user.workbenchRoles).toEqual(['sales'])
    for (const path of ['/users/profile', '/auth/profile']) {
      const profile = await get(path).expect(200)
      expect(profile.body.workbenchRoles).toEqual(['sales'])
      expect(profile.body).not.toHaveProperty('password')
    }
  })

  it.each([
    ['review', 'sales'], ['exceptions', 'sales'], ['procurement', 'procurement'],
    ['allocation', 'allocation'], ['dispatch', 'dispatch'], ['shipping', 'warehouse'],
  ])('authorizes queue %s as %s before returning a genuine unavailable status', async (queue, role) => {
    accounts.get(userId).workbenchRoles = []
    await get(`/autoflow/integrations/fop/fulfillment-orders?queue=${queue}`).expect(403)
    accounts.get(userId).workbenchRoles = [role]
    accounts.get(userId).fopTenantId = 'tenant-test'
    accounts.get(userId).fopUserId = 'employee-test'
    const response = await get(`/autoflow/integrations/fop/fulfillment-orders?queue=${queue}&workbenchRole=${role}`).expect(503)
    expect(response.body.code).toBe('fop_not_configured')
    expect(response.body).not.toHaveProperty('items')
  })

  it('rejects mismatched roles and invalid fulfillment filters', async () => {
    for (const query of ['queue=unknown', 'queue=shipping&workbenchRole=sales', 'queue=review&pageSize=101', 'queue=review&page=0', 'queue=review&orderNumber=' + 'x'.repeat(101), 'queue=review&search=' + 'x'.repeat(201), '']) {
      await get(`/autoflow/integrations/fop/fulfillment-orders?${query}`).expect(400)
    }
  })

  it('requires sales permission before serving the dashboard', async () => {
    await get('/autoflow/dashboard').expect(200)
    accounts.get(userId).workbenchRoles = ['warehouse']
    await get('/autoflow/dashboard').expect(403)
  })
  it('keeps management-only administrators out of every business endpoint while retaining account management', async () => {
    accounts.get(adminId).businessRole = 'none'
    accounts.get(adminId).workbenchRoles = ['sales', 'warehouse']
    const access = await get('/workbench/access', adminId).expect(200)
    expect(access.body).toMatchObject({ roles: [], isAdmin: true, businessRole: 'none' })
    await get('/users/workbench-accounts', adminId).expect(200)
    for (const path of ['/autoflow/dashboard', '/autoflow/integrations/fop/dashboard', '/autoflow/integrations/fop/fulfillment-orders?queue=review']) {
      const denied = await get(path, adminId).expect(403)
      expect(denied.body.code).toBe('business_access_disabled')
    }
    await request(app.getHttpServer()).put(`/api/users/${adminId}/business-scope`).auth(token(adminId), { type: 'bearer' })
      .send({ role: 'admin', departmentId: null, employeeId: null }).expect(200)
    expect((await get('/workbench/access', adminId).expect(200)).body.roles).toHaveLength(5)
    expect(accounts.get(adminId).role).toBe('admin')
  })

})
