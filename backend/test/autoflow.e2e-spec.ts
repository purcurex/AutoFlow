import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { DataSource } from 'typeorm'
import * as request from 'supertest'
import { UsersService } from '../src/modules/users/users.service'
import { LeadEntity } from '../src/modules/autoflow/entities/lead.entity'
import { CrmActivityEntity } from '../src/modules/autoflow/entities/crm-activity.entity'

jest.setTimeout(30000)

describe('AutoFlow persistence API', () => {
  let app: INestApplication
  let dataSource: DataSource
  let ownerToken: string
  let otherToken: string
  let ownerUserId: string
  let leadId: string

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DB_DATABASE = 'autoflow_test'
    process.env.ENABLE_ADMIN_BOOTSTRAP = 'false'

    const { default: migrationDataSource } = await import('../src/database/data-source')
    await migrationDataSource.initialize()
    await migrationDataSource.runMigrations()
    await migrationDataSource.destroy()

    const { AppModule } = await import('../src/app.module')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    app.setGlobalPrefix('api')
    await app.init()

    dataSource = app.get(DataSource)
    await dataSource.query('TRUNCATE TABLE "users" CASCADE')

    const usersService = app.get(UsersService)
    const owner = await usersService.create('owner@autoflow.test', 'owner', 'StrongPassword123')
    await usersService.create('other@autoflow.test', 'other', 'StrongPassword123')
    ownerUserId = owner.id

    const ownerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'owner@autoflow.test', password: 'StrongPassword123' })
      .expect(201)
    const otherLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'other@autoflow.test', password: 'StrongPassword123' })
      .expect(201)
    ownerToken = ownerLogin.body.token
    otherToken = otherLogin.body.token
  })

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.query('TRUNCATE TABLE "users" CASCADE')
    if (app) await app.close()
  })

  it('reports API and database readiness', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200)
    expect(response.body).toMatchObject({ status: 'ok', database: 'up' })
  })

  it('persists a workflow and returns it only to its owner', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/autoflow/workflows')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ seedType: 'keyword', seedValue: 'pet grooming brush', targetMarket: 'United States' })
      .expect(201)

    expect(created.body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.body.status).toBe('draft')

    const ownerList = await request(app.getHttpServer())
      .get('/api/autoflow/workflows')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)
    const otherList = await request(app.getHttpServer())
      .get('/api/autoflow/workflows')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200)

    expect(ownerList.body.items.map((item: { id: string }) => item.id)).toContain(created.body.id)
    expect(otherList.body.items).toHaveLength(0)
  })

  it('rejects unexpected profile properties instead of escalating a user role', async () => {
    await request(app.getHttpServer())
      .put('/api/users/profile')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ username: 'owner', role: 'admin' })
      .expect(400)
  })

  it('hides leads across owners and rejects invalid transitions', async () => {
    const lead = await dataSource.getRepository(LeadEntity).save({
      workflowRunId: null,
      ownerUserId,
      teamId: null,
      brandName: 'PawSpark',
      domain: 'pawspark.co',
      normalizedDomain: 'pawspark.co',
      storeUrl: 'https://pawspark.co',
      source: 'integration-test',
      country: 'United States',
      language: 'English',
      category: 'Pet Supplies',
      shopifyConfidence: 90,
      adActivityScore: 80,
      trafficScore: 70,
      contactScore: 60,
      totalScore: 78,
      status: 'new',
      recommendedAngle: 'Test angle',
    })
    leadId = lead.id

    await request(app.getHttpServer())
      .get(`/api/autoflow/leads/${leadId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404)

    await request(app.getHttpServer())
      .patch(`/api/autoflow/leads/${leadId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'won' })
      .expect(409)

    const qualified = await request(app.getHttpServer())
      .patch(`/api/autoflow/leads/${leadId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'qualified', note: 'Validated store and contact fit' })
      .expect(200)
    expect(qualified.body.status).toBe('qualified')
  })

  it('updates outreach, lead, and CRM activity in one business flow', async () => {
    const generated = await request(app.getHttpServer())
      .post(`/api/autoflow/leads/${leadId}/messages`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ channel: 'whatsapp', offer: 'fast fulfillment' })
      .expect(201)
    expect(generated.body.status).toBe('ready')

    await request(app.getHttpServer())
      .patch(`/api/autoflow/outreach-tasks/${generated.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'sent' })
      .expect(200)

    const lead = await dataSource.getRepository(LeadEntity).findOneByOrFail({ id: leadId })
    const activities = await dataSource.getRepository(CrmActivityEntity).findBy({ leadId })
    expect(lead.status).toBe('contacted')
    expect(activities.some((activity) => activity.toStatus === 'contacted')).toBe(true)
  })
})
