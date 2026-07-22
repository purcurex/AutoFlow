import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { DataSource } from 'typeorm'
import * as request from 'supertest'
import { UsersService } from '../src/modules/users/users.service'
import { LeadEntity } from '../src/modules/autoflow/entities/lead.entity'
import { CrmActivityEntity } from '../src/modules/autoflow/entities/crm-activity.entity'
import { LeadContactEntity } from '../src/modules/autoflow/entities/lead-contact.entity'
import {
  LeadScoreEntity,
  WorkflowJobEntity,
  WorkflowLeadEntity,
  WorkflowRunEntity,
  WorkflowStepEntity,
} from '../src/modules/autoflow/entities'
import { AdCreativeEntity, ShopifyStoreEntity } from '../src/modules/discovery/entities'
import { AiService } from '../src/modules/ai/ai.service'
import { FopHandoffEntity } from '../src/modules/fop-integration/fop-handoff.entity'

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
    process.env.ENABLE_MOCK_SEARCH = 'true'
    process.env.SERPAPI_KEY = ''

    const { default: migrationDataSource } = await import('../src/database/data-source')
    await migrationDataSource.initialize()
    await migrationDataSource.runMigrations()
    await migrationDataSource.destroy()

    const { AppModule } = await import('../src/app.module')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiService)
      .useValue({ generateSalesOutreach: jest.fn().mockResolvedValue('Approved test draft') })
      .compile()
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

  it('reports FOP quote and handoff capabilities as unavailable without fake values', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/autoflow/integrations/fop/capabilities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)

    expect(response.body).toMatchObject({
      provider: 'fop',
      platform: 'kingdee-cloud-cosmic',
      productCost: { status: 'not_implemented', available: false },
      logisticsRate: { status: 'not_implemented', available: false },
      crmHandoff: { status: 'not_implemented', available: false },
    })
    expect(JSON.stringify(response.body)).not.toMatch(/amount|price|costValue|freightValue/i)
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

  it('executes discovery asynchronously and persists idempotent workflow evidence', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/autoflow/workflows')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ seedType: 'keyword', seedValue: 'portable blender', targetMarket: 'United States' })
      .expect(201)

    await request(app.getHttpServer())
      .post(`/api/autoflow/workflows/${created.body.id}/start-discovery`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404)

    const started = await request(app.getHttpServer())
      .post(`/api/autoflow/workflows/${created.body.id}/start-discovery`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(202)
    expect(started.body).toMatchObject({
      workflowRunId: created.body.id,
      status: 'running',
      scheduled: true,
      resumed: false,
    })

    let workflow: WorkflowRunEntity | null = null
    for (let attempt = 0; attempt < 60; attempt += 1) {
      workflow = await dataSource.getRepository(WorkflowRunEntity).findOneBy({ id: created.body.id })
      if (workflow?.status === 'completed' || workflow?.status === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    expect(workflow).toMatchObject({ status: 'completed', progress: 100, leadCount: 3 })
    const [ads, stores, links, scores, steps, job, contacts] = await Promise.all([
      dataSource.getRepository(AdCreativeEntity).findBy({ workflowRunId: created.body.id }),
      dataSource.getRepository(ShopifyStoreEntity).findBy({ workflowRunId: created.body.id }),
      dataSource.getRepository(WorkflowLeadEntity).findBy({ workflowRunId: created.body.id }),
      dataSource.getRepository(LeadScoreEntity).findBy({ workflowRunId: created.body.id }),
      dataSource.getRepository(WorkflowStepEntity).findBy({ workflowRunId: created.body.id }),
      dataSource.getRepository(WorkflowJobEntity).findOneBy({ workflowRunId: created.body.id }),
      dataSource.getRepository(LeadContactEntity).find(),
    ])
    expect(ads).toHaveLength(3)
    expect(stores).toHaveLength(3)
    expect(stores.every((store) => store.leadId)).toBe(true)
    expect(links).toHaveLength(3)
    expect(scores).toHaveLength(3)
    expect(scores.every((score) => score.modelVersion === 'rules-v2-evidence')).toBe(true)
    expect(scores.every((score) => score.contactScore > 0)).toBe(true)
    expect(contacts).toHaveLength(3)
    expect(contacts.every((contact) => contact.sourceType === 'search_result')).toBe(true)
    expect(job).toMatchObject({ status: 'completed', attempts: 1, lastError: null })
    expect(steps.filter((step) => step.status === 'completed').map((step) => step.stage)).toEqual(
      expect.arrayContaining(['seed', 'ad_discovery', 'store_detection', 'lead_cleaning', 'lead_scoring']),
    )
    expect(steps.filter((step) => step.status === 'skipped').map((step) => step.stage)).toEqual(
      expect.arrayContaining(['message_generation', 'outreach', 'crm']),
    )

    await request(app.getHttpServer())
      .post(`/api/autoflow/workflows/${created.body.id}/start-discovery`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(409)
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

  it('persists immutable quote versions and protects them by owner', async () => {
    const quoteDraft = {
      leadId,
      title: 'PawSpark launch quote',
      currency: 'USD',
      products: [{
        lineId: '78d81397-82c7-4e60-b106-d77fe5c96c70',
        productReference: 'SKU-PET-001',
        unit: 'piece',
        quantityTiers: [
          { minQuantity: 1, maxQuantity: 99, customerUnitPrice: '12.50' },
          { minQuantity: 100, customerUnitPrice: '10.25' },
        ],
      }],
      destinationCountries: ['US', 'GB'],
      packages: [{
        quantity: 1,
        weight: 1.25,
        weightUnit: 'kg',
        length: 20,
        width: 15,
        height: 10,
        dimensionUnit: 'cm',
      }],
    }
    const created = await request(app.getHttpServer())
      .post('/api/autoflow/quotes')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(quoteDraft)
      .expect(201)

    expect(created.body).toMatchObject({ currentVersion: 1, currency: 'USD', status: 'draft' })
    expect(created.body.versions[0]).toMatchObject({
      version: 1,
      productCostStatus: 'not_requested',
      logisticsRateStatus: 'not_requested',
      resultSnapshot: null,
    })

    await request(app.getHttpServer())
      .get(`/api/autoflow/quotes/${created.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404)

    const revised = await request(app.getHttpServer())
      .post(`/api/autoflow/quotes/${created.body.id}/versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...quoteDraft, leadId: undefined, title: undefined })
      .expect(201)
    expect(revised.body.currentVersion).toBe(2)
    expect(revised.body.versions.map((version: { version: number }) => version.version)).toEqual([2, 1])
  })

  it('persists one fail-closed, retryable FOP handoff per lead', async () => {
    await request(app.getHttpServer())
      .post(`/api/autoflow/leads/${leadId}/fop-handoff`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ reason: 'Qualified for FOP follow-up' })
      .expect(404)

    const first = await request(app.getHttpServer())
      .post(`/api/autoflow/leads/${leadId}/fop-handoff`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Qualified for FOP follow-up' })
      .expect(201)
    expect(first.body).toMatchObject({
      leadId,
      status: 'unavailable',
      attempts: 1,
      fopLeadId: null,
      fopOpportunityId: null,
    })

    const second = await request(app.getHttpServer())
      .post(`/api/autoflow/leads/${leadId}/fop-handoff`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Retry after integration check' })
      .expect(201)
    expect(second.body.id).toBe(first.body.id)
    expect(second.body.idempotencyKey).toBe(first.body.idempotencyKey)
    expect(second.body.attempts).toBe(2)
    expect(await dataSource.getRepository(FopHandoffEntity).countBy({ leadId })).toBe(1)
  })

  it('reviews outreach before updating lead and local follow-up activity', async () => {
    const generated = await request(app.getHttpServer())
      .post(`/api/autoflow/leads/${leadId}/messages`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ channel: 'whatsapp', offer: 'fast fulfillment' })
      .expect(201)
    expect(generated.body.status).toBe('draft')

    await request(app.getHttpServer())
      .patch(`/api/autoflow/outreach-tasks/${generated.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'ready', message: 'Human-reviewed test draft' })
      .expect(200)

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
