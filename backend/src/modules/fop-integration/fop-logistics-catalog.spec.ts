import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import * as request from 'supertest'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { FopDataService } from '../fop-data/fop-data.service'
import { FopIntegrationController } from './fop-integration.controller'
import { FopIntegrationService } from './fop-integration.service'
import { FopLogisticsCatalogPort, FopProductCostPort } from './fop-integration.types'
import { SandboxFopLogisticsCatalogAdapter } from './fop-sandbox.adapters'

describe('actual logistics channel catalog search', () => {
  let app: INestApplication
  const adapter = new SandboxFopLogisticsCatalogAdapter()
  const permission = jest.fn().mockResolvedValue(undefined)
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [FopIntegrationController], providers: [
      { provide: FopIntegrationService, useValue: {} }, { provide: FopProductCostPort, useValue: {} },
      { provide: FopLogisticsCatalogPort, useValue: adapter }, { provide: FopDataService, useValue: { requireResourcePermission: permission } },
    ] }).overrideGuard(JwtAuthGuard).useValue({ canActivate(context: any) { context.switchToHttp().getRequest().user = { userId: 'employee-1' }; return true } }).compile()
    app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init()
  })
  afterAll(async () => { await app?.close() })
  it.each(['pOsTaL', 'SANDBOX-POST', 'Sandbox Post'])('matches name, code or carrier case-insensitively: %s', async search => {
    const res = await request(app.getHttpServer()).get('/autoflow/integrations/fop/logistics/actual-channels').query({ search: ` ${search} ` }).expect(200)
    expect(res.body).toMatchObject({ source: 'sandbox', total: 1, page: 1, pageSize: 24 })
    expect(res.body.channels[0]).toMatchObject({ code: 'SANDBOX-POST', customChannelCode: 'SANDBOX-ECONOMY', customChannelName: 'Sandbox Economy', carrierCode: 'SANDBOX-POST', carrierName: 'Sandbox Post' })
    expect(permission).toHaveBeenCalledWith('employee-1')
  })
  it('searches the complete actual catalog across categories before paginating', async () => {
    const first = await request(app.getHttpServer()).get('/autoflow/integrations/fop/logistics/actual-channels?pageSize=2&page=1').expect(200)
    const next = await request(app.getHttpServer()).get('/autoflow/integrations/fop/logistics/actual-channels?pageSize=2&page=2').expect(200)
    expect(first.body.total).toBe(3); expect(next.body.total).toBe(3)
    const rows = [...first.body.channels, ...next.body.channels]
    expect(new Set(rows.map((row: any) => row.code)).size).toBe(3)
    expect(new Set(rows.map((row: any) => row.customChannelCode)).size).toBe(2)
    expect(rows.every((row: any) => row.enabled)).toBe(true)
    const empty = await request(app.getHttpServer()).get('/autoflow/integrations/fop/logistics/actual-channels?search=no-match').expect(200)
    expect(empty.body).toMatchObject({ total: 0, channels: [] })
  })
  it.each(['page=0','pageSize=101','page=1.5','search=a&search=b','ownerId=forged',`search=${'x'.repeat(121)}`])('rejects malformed or caller-supplied scope: %s', async query => {
    await request(app.getHttpServer()).get(`/autoflow/integrations/fop/logistics/actual-channels?${query}`).expect(400)
  })
})
