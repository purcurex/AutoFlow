import { ForbiddenException, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import * as request from 'supertest'
import { Repository } from 'typeorm'
import { UsersService } from '../users/users.service'
import { User, UserRole } from '../users/user.entity'
import { FopDataService } from './fop-data.service'
import { FopApprovalService } from './fop-approval.service'
import { KingdeeFopDataProvider } from './fop-kingdee.provider'
import { FOP_DATA_PROVIDER, FopDataProvider, FopPermissionDeniedError } from './fop-data.types'
import { FulfillmentOrdersController } from '../users/workbench.controller'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { LocalWorkbenchService } from '../workbench-replica/local-workbench.service'

const subject = { tenantId: 'offline-company', userId: '100' }
const company = { id: '10', name: 'Test Company' }
const connection = { subject, username: 'offline-user', currentOrganization: company, resources: ['orders' as const] }
const grants = { orders: ['10'], receipts: [], registrations: [], freight: [] }
const envelope = (data: unknown) => new Response(JSON.stringify({ status: true, errorCode: '0', data }))
const configuration = () => ({ FOP_KINGDEE_QUERY_URL: 'https://offline.test/review', FOP_KINGDEE_SUMMARY_URL: 'https://offline.test/summary',
  FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL: 'https://offline.test/permissions', FOP_KINGDEE_IDENTITY: 'offline-identity', FOP_KINGDEE_ACCESS_TOKEN: 'offline-token' })

describe('Kingdee company connection discovery', () => {
  it('discovers authenticated identity/current company without configured IDs or an openapi signature', async () => {
    const config = configuration(), request = jest.fn(async () => envelope({ subject, currentOrganization: company, grants }))
    const provider = new KingdeeFopDataProvider({ get: key => (config as Record<string, string>)[key] }, request)
    expect(provider.isConfigured()).toBe(true)
    const result = await provider.getConnectionContext()
    expect(result).toEqual({ ...connection, username: null })
    expect(JSON.stringify(result)).not.toContain(config.FOP_KINGDEE_ACCESS_TOKEN)
    const call = (request.mock.calls as unknown as [URL, RequestInit][])[0]
    expect(JSON.parse(String(call[1].body))).toEqual({ query: { scopeRole: 'admin', page: 1, pageSize: 100 } })
    expect(call[1].headers).not.toHaveProperty('openapisign')
    await expect(provider.resolvePermissions({ ...subject, userId: '999' }, { role: 'admin', departmentId: null, employeeId: null })).rejects.toBeInstanceOf(FopPermissionDeniedError)
  })

  it.each([
    { orders: ['20'], receipts: [], registrations: [], freight: [] },
    { orders: [], receipts: [], registrations: [], freight: [] },
    { orders: ['10', '10'], receipts: [], registrations: [], freight: [] },
  ])('refuses foreign, duplicate or empty company grants: %j', async invalidGrants => {
    const config = configuration()
    const provider = new KingdeeFopDataProvider({ get: key => (config as Record<string, string>)[key] }, async () => envelope({ subject, currentOrganization: company, grants: invalidGrants }))
    await expect(provider.getConnectionContext()).rejects.toBeInstanceOf(FopPermissionDeniedError)
  })

  it('continues enforcing an explicitly configured identity', async () => {
    const config: Record<string, string> = { ...configuration(), FOP_KINGDEE_USER_ID: '999' }
    const provider = new KingdeeFopDataProvider({ get: key => config[key] }, async () => envelope({ subject, currentOrganization: company, grants }))
    await expect(provider.getConnectionContext()).rejects.toBeInstanceOf(FopPermissionDeniedError)
  })
})

describe('Kingdee automatic token lifecycle', () => {
  function setup(businessFailure?: number, alwaysFails = false) {
    const config: Record<string, string> = { ...configuration(), FOP_KINGDEE_TOKEN_URL: 'https://offline.test/getToken',
      FOP_KINGDEE_CLIENT_ID: 'offline-client', FOP_KINGDEE_CLIENT_SECRET: 'offline-secret', FOP_KINGDEE_ACCOUNT_ID: '200', FOP_KINGDEE_USERNAME: 'offline-user' }
    let tokens = 0, reads = 0
    const request = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/getToken')) { tokens++; return envelope({ access_token: `token-${tokens}`, expires_in: 7_200_000 }) }
      reads++
      if (businessFailure && (reads === 1 || alwaysFails)) return businessFailure === 200
        ? new Response(JSON.stringify({ status: false, errorCode: '401', data: null })) : new Response('', { status: businessFailure })
      expect((init?.headers as Record<string, string>).access_token).toBe(`token-${tokens}`)
      return envelope({ subject, currentOrganization: company, grants })
    })
    const provider = new KingdeeFopDataProvider({ get: key => config[key] }, request)
    return { provider, request, counts: () => ({ tokens, reads }) }
  }

  it('coalesces concurrent token requests and keeps credentials out of connection responses', async () => {
    const { provider, request, counts } = setup()
    const results = await Promise.all([provider.getConnectionContext(), provider.getConnectionContext()])
    expect(counts()).toEqual({ tokens: 1, reads: 1 })
    const tokenRequest = JSON.parse(String(request.mock.calls[0][1]?.body))
    expect(tokenRequest).toMatchObject({ client_id: 'offline-client', client_secret: 'offline-secret', accountId: '200', username: 'offline-user', language: 'zh_CN' })
    expect(tokenRequest.nonce).toMatch(/^[a-f0-9-]{36}$/)
    expect(Number.isFinite(Date.parse(tokenRequest.timestamp))).toBe(true)
    expect(JSON.stringify(results)).not.toMatch(/offline-secret|token-1/)
  })

  it('renews before expiry using the documented millisecond duration', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    try {
      const { provider, counts } = setup()
      await provider.getConnectionContext()
      clock.mockReturnValue(1_000_000 + 7_200_000 - 20_000)
      await provider.getConnectionContext()
      expect(counts()).toEqual({ tokens: 2, reads: 2 })
    } finally { clock.mockRestore() }
  })

  it.each([200, 401])('renews once for an authentication failure carried by HTTP %s', async status => {
    const { provider, counts } = setup(status)
    await provider.getConnectionContext()
    expect(counts()).toEqual({ tokens: 2, reads: 2 })
  })

  it('stops after a second authentication failure', async () => {
    const { provider, counts } = setup(200, true)
    await expect(provider.getConnectionContext()).rejects.toMatchObject({ code: 'fop_authentication_expired' })
    expect(counts()).toEqual({ tokens: 2, reads: 2 })
  })

  it('does not expose upstream token errors or repeatedly retry invalid application credentials', async () => {
    const config: Record<string, string> = { ...configuration(), FOP_KINGDEE_TOKEN_URL: 'https://offline.test/getToken',
      FOP_KINGDEE_CLIENT_ID: 'app', FOP_KINGDEE_CLIENT_SECRET: 'private-secret', FOP_KINGDEE_ACCOUNT_ID: '200', FOP_KINGDEE_USERNAME: 'user' }
    const request = jest.fn(async () => new Response(JSON.stringify({ status: false, errorCode: '401', message: 'private-secret' })))
    const provider = new KingdeeFopDataProvider({ get: key => config[key] }, request)
    await expect(provider.getConnectionContext()).rejects.toThrow('application authentication failed')
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('explicit current-admin binding', () => {
  function setup() {
    const user = { id: 'local-admin', role: UserRole.ADMIN, businessRole: 'admin', businessDepartmentId: null, businessEmployeeId: null,
      fopTenantId: null, fopUserId: null, workbenchRoles: ['sales'] } as User
    const users = { findById: jest.fn(async () => user), connectCurrentAdminFop: jest.fn(async () => ({ fopBinding: subject })) }
    const provider = { isConfigured: () => true, administratorIdentity: async () => null, getConnectionContext: jest.fn(async () => connection) }
    return { user, users, provider, service: new FopDataService(users as unknown as UsersService, provider as unknown as FopDataProvider) }
  }
  const expected = { ...subject, organizationId: company.id }

  it('keeps connection tests read-only and binds only the authenticated local account on confirmation', async () => {
    const { service, users } = setup()
    await expect(service.testConnection('local-admin')).resolves.toEqual(connection)
    expect(users.connectCurrentAdminFop).not.toHaveBeenCalled()
    await service.connectCurrentAdmin('local-admin', expected)
    expect(users.connectCurrentAdminFop).toHaveBeenCalledWith('local-admin', null, subject)
  })

  it.each([{ role: UserRole.USER, businessRole: 'admin' }, { role: UserRole.USER, businessRole: 'none' }])('rejects an account without the system administrator role: %j', async roles => {
    const { user, service, provider, users } = setup()
    Object.assign(user, roles)
    await expect(service.testConnection(user.id)).rejects.toBeInstanceOf(ForbiddenException)
    expect(provider.getConnectionContext).not.toHaveBeenCalled()
    expect(users.connectCurrentAdminFop).not.toHaveBeenCalled()
  })

  it('allows a system administrator with stale closed business assignment to test its connection', async () => {
    const { user, service, users } = setup()
    user.businessRole = 'none'
    await expect(service.testConnection(user.id)).resolves.toEqual(connection)
    expect(users.connectCurrentAdminFop).not.toHaveBeenCalled()
  })

  it.each([{ ...expected, userId: '999' }, { ...expected, tenantId: 'another-tenant' }, { ...expected, organizationId: '20' }])('rejects preview identity/company changes: %j', async stale => {
    const { service, users } = setup()
    await expect(service.connectCurrentAdmin('local-admin', stale)).rejects.toMatchObject({ response: { code: 'fop_binding_changed' } })
    expect(users.connectCurrentAdminFop).not.toHaveBeenCalled()
  })

  it('rechecks administrator access after the network request', async () => {
    const { user, service, provider, users } = setup()
    provider.getConnectionContext.mockImplementation(async () => { user.role = UserRole.USER; return connection })
    await expect(service.connectCurrentAdmin(user.id, expected)).rejects.toBeInstanceOf(ForbiddenException)
    expect(users.connectCurrentAdminFop).not.toHaveBeenCalled()
  })

  it('does not silently overwrite an existing different Kingdee binding', async () => {
    const { user, service, users } = setup()
    user.fopTenantId = 'another-tenant'; user.fopUserId = '999'
    await expect(service.connectCurrentAdmin(user.id, expected)).rejects.toMatchObject({ response: { code: 'fop_binding_changed' } })
    expect(users.connectCurrentAdminFop).not.toHaveBeenCalled()
  })
})

describe('atomic administrator binding update', () => {
  it('includes administrator roles and the prior empty binding in the update condition', async () => {
    const repository = { update: jest.fn().mockResolvedValue({ affected: 1 }), findOne: jest.fn().mockResolvedValue({ role: 'admin', businessRole: 'admin', fopTenantId: subject.tenantId, fopUserId: subject.userId }) }
    const service = new UsersService(repository as unknown as Repository<User>)
    await service.connectCurrentAdminFop('local-admin', null, subject)
    expect(repository.update.mock.calls[0][0]).toMatchObject({ id: 'local-admin', role: 'admin', businessRole: 'admin', fopTenantId: { _type: 'isNull' }, fopUserId: { _type: 'isNull' } })
  })

  it('rejects concurrent role or binding changes and preserves the identity uniqueness error', async () => {
    const repository = { update: jest.fn().mockResolvedValueOnce({ affected: 0 }).mockRejectedValueOnce({ driverError: { code: '23505' } }) }
    const service = new UsersService(repository as unknown as Repository<User>)
    await expect(service.connectCurrentAdminFop('local-admin', null, subject)).rejects.toMatchObject({ response: { code: 'fop_binding_changed' } })
    await expect(service.connectCurrentAdminFop('local-admin', null, subject)).rejects.toMatchObject({ status: 409 })
  })
})

/** 只启动隔离的HTTP控制器，替换认证及用户存储边界；不加载AppModule、不连接数据库。 */
describe('current-admin connection HTTP contract', () => {
  let app: INestApplication
  const user = { id: 'session-admin', role: UserRole.ADMIN, businessRole: 'admin', fopTenantId: null, fopUserId: null } as User
  const users = { findById: jest.fn(async () => user), connectCurrentAdminFop: jest.fn(async () => ({ fopBinding: subject })) }
  const provider = { isConfigured: () => true, administratorIdentity: async () => null, getConnectionContext: jest.fn(async () => connection) }
  const path = '/api/autoflow/integrations/fop/connection'

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [FulfillmentOrdersController], providers: [FopDataService,
      { provide: LocalWorkbenchService, useValue: { enabled: false } },
      { provide: UsersService, useValue: users }, { provide: FOP_DATA_PROVIDER, useValue: provider }, { provide: FopApprovalService, useValue: {} }] })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: (context: { switchToHttp(): { getRequest(): { headers: Record<string, string>; user?: { userId: string } } } }) => {
        const req = context.switchToHttp().getRequest()
        if (req.headers['x-offline-session'] !== 'admin') throw new UnauthorizedException()
        req.user = { userId: 'session-admin' }; return true
      } }).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    await app.init()
  })
  afterAll(async () => { await app.close() })
  beforeEach(() => { jest.clearAllMocks(); user.role = UserRole.ADMIN })

  it('requires authentication on both connection routes', async () => {
    await request(app.getHttpServer()).post(`${path}/test`).expect(401)
    await request(app.getHttpServer()).post(`${path}/bind`).send({ ...subject, organizationId: '10' }).expect(401)
    expect(provider.getConnectionContext).not.toHaveBeenCalled()
    expect(users.connectCurrentAdminFop).not.toHaveBeenCalled()
  })

  it('previews without mutation and confirms only the account from the authenticated session', async () => {
    await request(app.getHttpServer()).post(`${path}/test`).set('x-offline-session', 'admin')
      .expect('Cache-Control', 'private, no-store').expect(201).expect(connection)
    expect(users.connectCurrentAdminFop).not.toHaveBeenCalled()
    await request(app.getHttpServer()).post(`${path}/bind`).set('x-offline-session', 'admin')
      .send({ ...subject, organizationId: '10' }).expect(201)
    expect(users.connectCurrentAdminFop).toHaveBeenCalledWith('session-admin', null, subject)
  })

  it.each([{ ...subject, organizationId: '10', targetUserId: 'another-user' }, { ...subject, organizationId: [] }, { tenantId: '', userId: '100', organizationId: '10' }])('rejects extra account selectors and malformed confirmation: %j', async body => {
      await request(app.getHttpServer()).post(`${path}/bind`).set('x-offline-session', 'admin').send(body).expect(400)
      expect(users.connectCurrentAdminFop).not.toHaveBeenCalled()
    })

  it('enforces live administrator roles at the HTTP entry', async () => {
    user.role = UserRole.USER
    await request(app.getHttpServer()).post(`${path}/test`).set('x-offline-session', 'admin').expect(403)
    expect(provider.getConnectionContext).not.toHaveBeenCalled()
  })
})
