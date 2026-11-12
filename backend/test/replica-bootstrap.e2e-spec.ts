import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import * as request from 'supertest'
import { DataSource } from 'typeorm'
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard'
import { ReplicaController } from '../src/modules/workbench-replica/replica.controller'
import { ReplicaBootstrapService } from '../src/modules/workbench-replica/replica-bootstrap.service'
import { ReplicaSyncService } from '../src/modules/workbench-replica/replica-sync.service'
import { ReplicaHttpSource } from '../src/modules/workbench-replica/replica-http-source'
import { ReplicaPublisher } from '../src/modules/workbench-replica/replica-publisher'
import { ReplicaAuthorizationService } from '../src/modules/workbench-replica/replica-authorization.service'

describe('Replica bootstrap HTTP contract (database and source boundaries injected)', () => {
  let app: INestApplication
  const companyId = 'cc6b6623-b533-4c90-945d-9dd7a119165f'
  const db = { query: jest.fn() }
  const source = { isConfigured: jest.fn(() => true), begin: jest.fn() }
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ReplicaController],
      providers: [ReplicaBootstrapService,
        { provide: ReplicaSyncService, useValue: {} },
        { provide: DataSource, useValue: db },
        { provide: ConfigService, useValue: new ConfigService({ FOP_QUERIES_PAUSED: 'true' }) },
        { provide: ReplicaHttpSource, useValue: source },
        { provide: ReplicaPublisher, useValue: {} },
        { provide: ReplicaAuthorizationService, useValue: {} },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate(context: any) {
      const req = context.switchToHttp().getRequest()
      if (!req.headers.authorization) throw new UnauthorizedException()
      req.user = { userId: req.headers.authorization === 'Bearer admin' ? 'admin' : 'member' }
      return true
    } }).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    await app.init()
  })
  beforeEach(() => { jest.clearAllMocks(); db.query.mockImplementation(async (sql: string, args: string[]) => sql.includes('JOIN users') && args[0] === 'admin' ? [{ connection_id: 'connection', company_id: companyId }] : []) })
  afterAll(async () => { await app.close() })
  const body = { companyId, requestKey: 'bootstrap-http-1' }
  it('requires authentication before starting any bootstrap work', async () => {
    await request(app.getHttpServer()).post('/api/workbench/replica/bootstrap').send(body).expect(401)
    expect(db.query).not.toHaveBeenCalled()
    expect(source.begin).not.toHaveBeenCalled()
  })
  it('rejects non-administrators before contacting the source', async () => {
    await request(app.getHttpServer()).post('/api/workbench/replica/bootstrap').auth('member', { type: 'bearer' }).send(body).expect(403)
    expect(source.begin).not.toHaveBeenCalled()
  })
  it('validates the company, resume key and rejects caller-supplied source scope', async () => {
    for (const invalid of [{ ...body, companyId: 'remote-company' }, { ...body, requestKey: 'unsafe key' }, { ...body, tenantId: 'other-tenant' }]) {
      await request(app.getHttpServer()).post('/api/workbench/replica/bootstrap').auth('admin', { type: 'bearer' }).send(invalid).expect(400)
    }
    expect(db.query).not.toHaveBeenCalled()
  })
  it('keeps paused initialization fail-closed at the real HTTP route', async () => {
    const response = await request(app.getHttpServer()).post('/api/workbench/replica/bootstrap').auth('admin', { type: 'bearer' }).send(body).expect(503)
    expect(response.body.code).toBe('fop_queries_paused')
    expect(source.begin).not.toHaveBeenCalled()
  })
  it('allows read-only resume status while FOP access remains paused', async () => {
    const response = await request(app.getHttpServer()).post('/api/workbench/replica/bootstrap/status').auth('admin', { type: 'bearer' }).send(body).expect(201)
    expect(response.body).toEqual({ state: 'not_started' })
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(source.begin).not.toHaveBeenCalled()
  })
})
