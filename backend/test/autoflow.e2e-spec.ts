import { ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { NestExpressApplication } from '@nestjs/platform-express'
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
import { PromptTemplateService } from '../src/modules/ai/prompt-template.service'
import { StorefrontEnrichmentService } from '../src/modules/discovery/storefront-enrichment.service'
import { FopHandoffEntity } from '../src/modules/fop-integration/fop-handoff.entity'
import { rm } from 'fs/promises'
import { join } from 'path'

jest.setTimeout(30000)

describe('AutoFlow persistence API', () => {
  let app: NestExpressApplication
  let dataSource: DataSource
  let ownerCookie: string
  let otherCookie: string
  let ownerUserId: string
  let leadId: string

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DB_DATABASE = 'autoflow_test'
    process.env.ENABLE_ADMIN_BOOTSTRAP = 'false'
    process.env.ENABLE_MOCK_SEARCH = 'true'
    process.env.SERPAPI_KEY = ''
    process.env.PIPIADS_API_KEY = ''
    process.env.ALIBABA_1688_ENABLED = 'false'

    const { default: migrationDataSource } = await import('../src/database/data-source')
    await migrationDataSource.initialize()
    await migrationDataSource.runMigrations()
    await migrationDataSource.destroy()

    const { AppModule } = await import('../src/app.module')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiService)
      .useValue({
        generateSalesOutreach: jest.fn().mockResolvedValue('Approved test draft'),
        continueOutreachConversation: jest.fn().mockResolvedValue('请补充希望强调的产品卖点。'),
        generateBilingualOutreach: jest.fn().mockResolvedValue({
          english: { subject: 'Sourcing support', message: 'Hi, may I share a verified sourcing option?' },
          chinese: { subject: '采购支持', message: '您好，可以向您介绍一个已核实的采购方案吗？' },
          factsUsed: ['Verified prospect context'],
          missingFacts: [],
          warnings: ['Human review required'],
        }),
      })
      .overrideProvider(StorefrontEnrichmentService)
      .useValue({
        enrich: jest.fn(async (stores) => stores),
        enrichStore: jest.fn(async (store) => ({
          ...store,
          contacts: [{
            type: 'email',
            value: 'sales@pawspark.co',
            label: 'Sales Email',
            sourceUrl: 'https://pawspark.co/pages/contact',
            sourceType: 'storefront_mailto_link',
            verificationStatus: 'verified',
            confidence: 95,
            evidence: {
              extractedFrom: 'mailto_link',
              sourcePageTitle: 'Contact PawSpark',
              sourcePageKind: 'contact',
              proves: 'email',
            },
          }],
        })),
      })
      .compile()
    app = moduleRef.createNestApplication<NestExpressApplication>()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    // E2E 测试容器复用真实启动入口的上传目录配置，覆盖“上传成功但静态读取 404”的回归场景。
    app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' })
    app.setGlobalPrefix('api')
    await app.init()

    dataSource = app.get(DataSource)
    await dataSource.query('TRUNCATE TABLE "users" CASCADE')
    await app.get(PromptTemplateService).onModuleInit()

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
    ownerCookie = ownerLogin.headers['set-cookie'][0].split(';')[0]
    otherCookie = otherLogin.headers['set-cookie'][0].split(';')[0]
    expect(ownerLogin.body).not.toHaveProperty('token')
    expect(ownerLogin.body.user.displayId).toMatch(/^\d{6}$/)
    expect(ownerLogin.headers['set-cookie'][0]).toMatch(/HttpOnly/i)
    expect(ownerLogin.headers['set-cookie'][0]).toMatch(/SameSite=Lax/i)
  })

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.query('TRUNCATE TABLE "users" CASCADE')
    if (app) await app.close()
    if (ownerUserId) {
      await rm(join(process.cwd(), 'uploads', 'workflow-seeds', ownerUserId), {
        recursive: true,
        force: true,
      })
    }
  })

  it('reports API and database readiness', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200)
    expect(response.body).toMatchObject({ status: 'ok', database: 'up' })
  })

  it('returns the stable six-digit user ID from the authenticated profile', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/users/profile')
      .set('Cookie', ownerCookie)
      .expect(200)

    expect(response.body).toMatchObject({
      id: ownerUserId,
      displayId: expect.stringMatching(/^\d{6}$/),
      username: 'owner',
    })
    expect(response.body).not.toHaveProperty('password')
  })

  it('maintains owner-scoped GLM prompt templates with system fallback', async () => {
    const initialCatalog = await request(app.getHttpServer())
      .get('/api/ai/prompt-modules')
      .set('Cookie', ownerCookie)
      .expect(200)

    expect(initialCatalog.body.variables).toContain('brandName')
    expect(initialCatalog.body.modules).toHaveLength(13)
    expect(initialCatalog.body.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ moduleKey: 'channel_other' }),
    ]))
    const quoteModule = initialCatalog.body.modules.find(
      (item: { moduleKey: string }) => item.moduleKey === 'quote_combined',
    )
    expect(quoteModule.templates).toEqual([
      expect.objectContaining({ isSystem: true, isActive: true }),
    ])

    const created = await request(app.getHttpServer())
      .post('/api/ai/prompt-templates')
      .set('Cookie', ownerCookie)
      .send({
        moduleKey: 'quote_combined',
        name: 'Owner combined quote',
        content: 'Use the verified combined quote for {{brandName}} and {{country}}.',
      })
      .expect(201)
    expect(created.body).toMatchObject({
      ownerUserId,
      moduleKey: 'quote_combined',
      isSystem: false,
    })

    await request(app.getHttpServer())
      .patch(`/api/ai/prompt-templates/${created.body.id}`)
      .set('Cookie', otherCookie)
      .send({ name: 'Forbidden edit', content: 'This update must never be accepted.' })
      .expect(404)

    await request(app.getHttpServer())
      .put('/api/ai/prompt-modules/quote_combined/active')
      .set('Cookie', otherCookie)
      .send({ templateId: created.body.id })
      .expect(404)

    await request(app.getHttpServer())
      .put('/api/ai/prompt-modules/quote_combined/active')
      .set('Cookie', ownerCookie)
      .send({ templateId: created.body.id })
      .expect(204)

    const ownerCatalog = await request(app.getHttpServer())
      .get('/api/ai/prompt-modules')
      .set('Cookie', ownerCookie)
      .expect(200)
    const activeOwnerModule = ownerCatalog.body.modules.find(
      (item: { moduleKey: string }) => item.moduleKey === 'quote_combined',
    )
    expect(activeOwnerModule.activeTemplateId).toBe(created.body.id)
    expect(activeOwnerModule.templates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.body.id, isActive: true, isSystem: false }),
    ]))
    const resolvedPrompts = await app.get(PromptTemplateService).resolve(
      ownerUserId,
      ['quote_combined'],
      { brandName: 'PawSpark', country: 'US' },
    )
    expect(resolvedPrompts).toEqual(['Use the verified combined quote for PawSpark and US.'])

    const otherCatalog = await request(app.getHttpServer())
      .get('/api/ai/prompt-modules')
      .set('Cookie', otherCookie)
      .expect(200)
    const otherQuoteModule = otherCatalog.body.modules.find(
      (item: { moduleKey: string }) => item.moduleKey === 'quote_combined',
    )
    expect(otherQuoteModule.templates).toHaveLength(1)
    expect(otherQuoteModule.templates[0]).toMatchObject({ isSystem: true, isActive: true })

    await request(app.getHttpServer())
      .patch(`/api/ai/prompt-templates/${quoteModule.systemDefaultTemplateId}`)
      .set('Cookie', ownerCookie)
      .send({ name: 'System overwrite', content: 'System defaults must remain immutable.' })
      .expect(404)

    await request(app.getHttpServer())
      .delete(`/api/ai/prompt-templates/${created.body.id}`)
      .set('Cookie', ownerCookie)
      .expect(204)

    const fallbackCatalog = await request(app.getHttpServer())
      .get('/api/ai/prompt-modules')
      .set('Cookie', ownerCookie)
      .expect(200)
    const fallbackModule = fallbackCatalog.body.modules.find(
      (item: { moduleKey: string }) => item.moduleKey === 'quote_combined',
    )
    expect(fallbackModule.activeTemplateId).toBe(fallbackModule.systemDefaultTemplateId)
    expect(fallbackModule.templates).toEqual([
      expect.objectContaining({ isSystem: true, isActive: true }),
    ])
  })

  it('reports FOP quote and handoff capabilities as unavailable without fake values', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/autoflow/integrations/fop/capabilities')
      .set('Cookie', ownerCookie)
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
      .set('Cookie', ownerCookie)
      .send({ seedType: 'keyword', seedValue: 'pet grooming brush', targetMarket: 'United States' })
      .expect(201)

    expect(created.body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.body.status).toBe('draft')

    const ownerList = await request(app.getHttpServer())
      .get('/api/autoflow/workflows')
      .set('Cookie', ownerCookie)
      .expect(200)
    const otherList = await request(app.getHttpServer())
      .get('/api/autoflow/workflows')
      .set('Cookie', otherCookie)
      .expect(200)

    expect(ownerList.body.items.map((item: { id: string }) => item.id)).toContain(created.body.id)
    expect(otherList.body.items).toHaveLength(0)
  })

  it('exposes owner-scoped 1688 sourcing without fabricating offers when unconfigured', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/autoflow/workflows')
      .set('Cookie', ownerCookie)
      .send({ seedType: 'keyword', seedValue: 'pet grooming brush', targetMarket: 'United States' })
      .expect(201)

    await request(app.getHttpServer())
      .get(`/api/autoflow/workflows/${created.body.id}/sourcing`)
      .set('Cookie', otherCookie)
      .expect(404)

    const summary = await request(app.getHttpServer())
      .get(`/api/autoflow/workflows/${created.body.id}/sourcing`)
      .set('Cookie', ownerCookie)
      .expect(200)
    expect(summary.body).toEqual({
      workflowId: created.body.id,
      customerDiscoveryStatus: 'not_started',
      workflowInput: {
        name: 'pet grooming brush prospect workflow',
        seedType: 'keyword',
        seedValue: 'pet grooming brush',
        targetMarket: 'United States',
      },
      provider: 'alibaba_1688',
      providerConfigured: false,
      status: 'not_configured',
      search: null,
      latestSearch: null,
      pagination: {
        page: 1,
        pageSize: 20,
        totalRecords: null,
        totalPages: null,
        providerTotalRecords: null,
        resultLimit: 100,
        canExpand: false,
        resultCount: 0,
        loaded: false,
        status: 'pending',
        errorCode: null,
        errorMessage: null,
      },
      items: [],
      offers: [],
    })

    const started = await request(app.getHttpServer())
      .post(`/api/autoflow/workflows/${created.body.id}/sourcing/search`)
      .set('Cookie', ownerCookie)
      .send({ force: true })
      .expect(503)
    expect(started.body).toMatchObject({
      code: 'NOT_CONFIGURED',
    })
  })

  it('revises, archives, and safely deletes workflows without deleting global leads', async () => {
    const source = await request(app.getHttpServer())
      .post('/api/autoflow/workflows')
      .set('Cookie', ownerCookie)
      .send({
        name: 'Failed image search',
        seedType: 'image',
        seedValue: 'https://example.test/original.png',
        targetMarket: 'United States',
      })
      .expect(201)

    await dataSource.getRepository(WorkflowRunEntity).update(source.body.id, {
      status: 'failed',
      currentStage: 'ad_discovery',
      progress: 10,
    })
    await dataSource.getRepository(WorkflowJobEntity).save({
      workflowRunId: source.body.id,
      ownerUserId,
      status: 'failed',
      attempts: 3,
      maxAttempts: 3,
      availableAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      lastError: 'PipiAds request failed, code 442: credits are insufficient',
      completedAt: new Date(),
    })

    const detail = await request(app.getHttpServer())
      .get(`/api/autoflow/workflows/${source.body.id}`)
      .set('Cookie', ownerCookie)
      .expect(200)
    expect(detail.body).toMatchObject({
      id: source.body.id,
      failureCode: 'insufficient_credits',
      failureProvider: 'pipiads',
      failureRetryable: false,
      revisionNo: 1,
    })

    await request(app.getHttpServer())
      .post(`/api/autoflow/workflows/${source.body.id}/revisions`)
      .set('Cookie', otherCookie)
      .send({
        name: 'Revised image search',
        seedType: 'keyword',
        seedValue: 'portable blender',
        targetMarket: 'Canada',
      })
      .expect(404)

    const revision = await request(app.getHttpServer())
      .post(`/api/autoflow/workflows/${source.body.id}/revisions`)
      .set('Cookie', ownerCookie)
      .send({
        name: 'Revised image search',
        seedType: 'keyword',
        seedValue: 'portable blender',
        targetMarket: 'Canada',
      })
      .expect(201)
    expect(revision.body).toMatchObject({
      parentWorkflowRunId: source.body.id,
      rootWorkflowRunId: source.body.id,
      revisionNo: 2,
      status: 'draft',
      seedValue: 'portable blender',
    })

    const sourceImpact = await request(app.getHttpServer())
      .get(`/api/autoflow/workflows/${source.body.id}/deletion-impact`)
      .set('Cookie', ownerCookie)
      .expect(200)
    expect(sourceImpact.body).toMatchObject({
      canDelete: false,
      requiresArchive: true,
      revisionCount: 1,
    })

    await request(app.getHttpServer())
      .delete(`/api/autoflow/workflows/${source.body.id}`)
      .set('Cookie', ownerCookie)
      .expect(409)
    await request(app.getHttpServer())
      .post(`/api/autoflow/workflows/${source.body.id}/archive`)
      .set('Cookie', ownerCookie)
      .expect(201)

    const activeList = await request(app.getHttpServer())
      .get('/api/autoflow/workflows')
      .set('Cookie', ownerCookie)
      .expect(200)
    expect(activeList.body.items.map((item: { id: string }) => item.id)).not.toContain(source.body.id)

    const disposable = await request(app.getHttpServer())
      .post('/api/autoflow/workflows')
      .set('Cookie', ownerCookie)
      .send({
        name: 'Disposable failed search',
        seedType: 'keyword',
        seedValue: 'temporary product',
        targetMarket: 'Australia',
      })
      .expect(201)
    await dataSource.getRepository(WorkflowRunEntity).update(disposable.body.id, {
      status: 'failed',
      currentStage: 'ad_discovery',
      progress: 10,
    })
    const preservedLead = await dataSource.getRepository(LeadEntity).save({
      workflowRunId: disposable.body.id,
      ownerUserId,
      teamId: null,
      brandName: 'Preserved Store',
      domain: 'preserved-workflow-lead.example',
      normalizedDomain: 'preserved-workflow-lead.example',
      storeUrl: 'https://preserved-workflow-lead.example',
      productUrl: null,
      discoverySources: ['pipiads'],
      source: 'PipiAds',
      country: 'AU',
      language: 'English',
      category: 'Test',
      shopifyConfidence: 80,
      adActivityScore: 70,
      trafficScore: 60,
      contactScore: 50,
      totalScore: 65,
      status: 'new',
      recommendedAngle: '',
    })
    await dataSource.getRepository(WorkflowLeadEntity).save({
      workflowRunId: disposable.body.id,
      leadId: preservedLead.id,
      source: 'PipiAds',
      sourceReference: null,
      sourceScore: 65,
      metadata: null,
      discoveredAt: new Date(),
    })

    const deleteImpact = await request(app.getHttpServer())
      .get(`/api/autoflow/workflows/${disposable.body.id}/deletion-impact`)
      .set('Cookie', ownerCookie)
      .expect(200)
    expect(deleteImpact.body).toMatchObject({
      canDelete: true,
      associatedLeadCount: 1,
      preservedLeadCount: 1,
    })

    const deleted = await request(app.getHttpServer())
      .delete(`/api/autoflow/workflows/${disposable.body.id}`)
      .set('Cookie', ownerCookie)
      .expect(200)
    expect(deleted.body).toEqual({ deleted: true, preservedLeadCount: 1 })
    expect(await dataSource.getRepository(WorkflowRunEntity).findOneBy({ id: disposable.body.id })).toBeNull()
    expect(await dataSource.getRepository(LeadEntity).findOneBy({ id: preservedLead.id })).toMatchObject({
      id: preservedLead.id,
      workflowRunId: null,
    })
  })

  it('accepts authenticated workflow screenshots and rejects disguised files', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
    const uploaded = await request(app.getHttpServer())
      .post('/api/autoflow/workflow-images')
      .set('Cookie', ownerCookie)
      .attach('image', png, { filename: 'clipboard.png', contentType: 'image/png' })
      .expect(201)

    expect(uploaded.body).toMatchObject({
      providerReady: false,
      originalName: 'clipboard.png',
      size: png.length,
    })
    expect(uploaded.body.assetPath).toContain(`/uploads/workflow-seeds/${ownerUserId}/`)
    expect(uploaded.body.publicUrl).toContain(uploaded.body.assetPath)

    // 上传接口返回的资产路径必须能立即访问，避免开发环境从 dist/uploads 读取导致图片回显 404。
    const downloaded = await request(app.getHttpServer())
      .get(uploaded.body.assetPath)
      .expect(200)
    expect(downloaded.headers['content-type']).toMatch(/^image\/png/)
    expect(downloaded.body).toEqual(png)

    await request(app.getHttpServer())
      .post('/api/autoflow/workflow-images')
      .attach('image', png, { filename: 'clipboard.png', contentType: 'image/png' })
      .expect(401)

    await request(app.getHttpServer())
      .post('/api/autoflow/workflow-images')
      .set('Cookie', ownerCookie)
      .attach('image', Buffer.from('not an image'), {
        filename: 'disguised.png',
        contentType: 'image/png',
      })
      .expect(400)
  })

  it('propagates correlation IDs and persists payload-free write audits', async () => {
    const correlationId = 'e2e-correlation-0001'
    const created = await request(app.getHttpServer())
      .post('/api/autoflow/workflows')
      .set('Cookie', ownerCookie)
      .set('X-Correlation-ID', correlationId)
      .send({ seedType: 'keyword', seedValue: 'audit test product', targetMarket: 'United States' })
      .expect(201)
    expect(created.headers['x-correlation-id']).toBe(correlationId)

    const events = await request(app.getHttpServer())
      .get('/api/autoflow/audit-events')
      .set('Cookie', ownerCookie)
      .expect(200)
    const event = events.body.find((item: { correlationId: string }) => item.correlationId === correlationId)
    expect(event).toMatchObject({ actorUserId: ownerUserId, outcome: 'succeeded' })
    expect(event.metadata).toEqual(expect.objectContaining({ statusCode: 201 }))
    expect(event.metadata).not.toHaveProperty('body')
  })

  it('rejects unexpected profile properties instead of escalating a user role', async () => {
    await request(app.getHttpServer())
      .put('/api/users/profile')
      .set('Cookie', ownerCookie)
      .send({ username: 'owner', role: 'admin' })
      .expect(400)
  })

  it('executes discovery asynchronously and persists idempotent workflow evidence', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/autoflow/workflows')
      .set('Cookie', ownerCookie)
      .send({ seedType: 'keyword', seedValue: 'portable blender', targetMarket: 'United States' })
      .expect(201)

    await request(app.getHttpServer())
      .post(`/api/autoflow/workflows/${created.body.id}/start-discovery`)
      .set('Cookie', otherCookie)
      .expect(404)

    const started = await request(app.getHttpServer())
      .post(`/api/autoflow/workflows/${created.body.id}/start-discovery`)
      .set('Cookie', ownerCookie)
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

    expect(workflow).toMatchObject({ status: 'completed', progress: 100, leadCount: 1 })
    const [ads, stores, links, scores, steps, job, contacts] = await Promise.all([
      dataSource.getRepository(AdCreativeEntity).findBy({ workflowRunId: created.body.id }),
      dataSource.getRepository(ShopifyStoreEntity).findBy({ workflowRunId: created.body.id }),
      dataSource.getRepository(WorkflowLeadEntity).findBy({ workflowRunId: created.body.id }),
      dataSource.getRepository(LeadScoreEntity).findBy({ workflowRunId: created.body.id }),
      dataSource.getRepository(WorkflowStepEntity).findBy({ workflowRunId: created.body.id }),
      dataSource.getRepository(WorkflowJobEntity).findOneBy({ workflowRunId: created.body.id }),
      dataSource.getRepository(LeadContactEntity).find(),
    ])
    expect(ads).toHaveLength(1)
    expect(ads[0]).toMatchObject({
      provider: 'pipiads',
      rawPayload: { evidenceAuthority: 'mock', requiresOfficialVerification: true },
    })
    expect(stores).toHaveLength(1)
    expect(stores[0]).toMatchObject({
      detectionSource: 'pipiads_ad_landing_page',
      productUrl: expect.stringContaining('/products/'),
      discoverySources: ['pipiads'],
      verificationStatus: 'mock',
      verificationEvidence: {
        provider: 'pipiads',
        evidenceAuthority: 'mock',
        requiresOfficialVerification: true,
      },
    })
    expect(stores.every((store) => store.leadId)).toBe(true)
    expect(links).toHaveLength(1)
    expect(scores).toHaveLength(1)
    expect(scores.every((score) => score.modelVersion === 'rules-v3-priority-contact-ads')).toBe(true)
    expect(scores.every((score) => score.contactScore === 0)).toBe(true)
    expect(contacts).toHaveLength(0)
    expect(job).toMatchObject({ status: 'completed', attempts: 1, lastError: null })
    expect(steps.filter((step) => step.status === 'completed').map((step) => step.stage)).toEqual(
      expect.arrayContaining(['seed', 'ad_discovery', 'store_detection', 'lead_cleaning', 'lead_scoring']),
    )
    expect(steps.filter((step) => step.status === 'skipped').map((step) => step.stage)).toEqual(
      expect.arrayContaining(['message_generation', 'outreach', 'crm']),
    )

    const discoveredLead = await dataSource.getRepository(LeadEntity).findOneByOrFail({ id: links[0].leadId })
    await request(app.getHttpServer())
      .patch(`/api/autoflow/leads/${discoveredLead.id}/status`)
      .set('Cookie', ownerCookie)
      .send({ status: 'qualified', note: 'Verified before repeat discovery' })
      .expect(200)

    const repeated = await request(app.getHttpServer())
      .post('/api/autoflow/workflows')
      .set('Cookie', ownerCookie)
      .send({ seedType: 'keyword', seedValue: 'portable blender repeat', targetMarket: 'United States' })
      .expect(201)
    await request(app.getHttpServer())
      .post(`/api/autoflow/workflows/${repeated.body.id}/start-discovery`)
      .set('Cookie', ownerCookie)
      .expect(202)

    let repeatedWorkflow: WorkflowRunEntity | null = null
    for (let attempt = 0; attempt < 60; attempt += 1) {
      repeatedWorkflow = await dataSource.getRepository(WorkflowRunEntity).findOneBy({ id: repeated.body.id })
      if (repeatedWorkflow?.status === 'completed' || repeatedWorkflow?.status === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    expect(repeatedWorkflow).toMatchObject({ status: 'completed', progress: 100, leadCount: 1 })
    const matchingLeads = await dataSource.getRepository(LeadEntity).findBy({
      ownerUserId,
      normalizedDomain: discoveredLead.normalizedDomain,
    })
    expect(matchingLeads).toHaveLength(1)
    expect(matchingLeads[0].status).toBe('qualified')
    expect(await dataSource.getRepository(WorkflowLeadEntity).countBy({
      workflowRunId: repeated.body.id,
      leadId: discoveredLead.id,
    })).toBe(1)
    expect(await dataSource.getRepository(WorkflowLeadEntity).countBy({
      leadId: discoveredLead.id,
    })).toBe(2)

    const repeatedLeadList = await request(app.getHttpServer())
      .get(`/api/autoflow/leads?workflowRunId=${repeated.body.id}`)
      .set('Cookie', ownerCookie)
      .expect(200)
    expect(repeatedLeadList.body.items).toEqual([
      expect.objectContaining({
        id: discoveredLead.id,
        status: 'qualified',
        discoveryStatus: 'seen_before',
        discoveryCount: 2,
        workflowDiscoveries: [
          expect.objectContaining({
            workflowRunId: repeated.body.id,
            workflowDisplayId: repeated.body.displayId,
            workflowName: repeated.body.name,
            discoveredAt: expect.any(String),
            score: expect.any(Number),
          }),
        ],
      }),
    ])

    const groupedLeadList = await request(app.getHttpServer())
      .get('/api/autoflow/leads?pageSize=100')
      .set('Cookie', ownerCookie)
      .expect(200)
    const groupedLead = groupedLeadList.body.items.find((item: { id: string }) => item.id === discoveredLead.id)
    expect(groupedLead.workflowDiscoveries).toHaveLength(2)
    expect(groupedLead.workflowDiscoveries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workflowRunId: created.body.id,
        workflowDisplayId: created.body.displayId,
        workflowName: created.body.name,
        workflowCreatedAt: expect.any(String),
        discoveredAt: expect.any(String),
        score: expect.any(Number),
      }),
      expect.objectContaining({
        workflowRunId: repeated.body.id,
        workflowDisplayId: repeated.body.displayId,
        workflowName: repeated.body.name,
        workflowCreatedAt: expect.any(String),
        discoveredAt: expect.any(String),
        score: expect.any(Number),
      }),
    ]))

    await request(app.getHttpServer())
      .post(`/api/autoflow/workflows/${created.body.id}/start-discovery`)
      .set('Cookie', ownerCookie)
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
      .set('Cookie', otherCookie)
      .expect(404)

    await request(app.getHttpServer())
      .patch(`/api/autoflow/leads/${leadId}/status`)
      .set('Cookie', ownerCookie)
      .send({ status: 'won' })
      .expect(409)

    const qualified = await request(app.getHttpServer())
      .patch(`/api/autoflow/leads/${leadId}/status`)
      .set('Cookie', ownerCookie)
      .send({ status: 'qualified', note: 'Validated store and contact fit' })
      .expect(200)
    expect(qualified.body.status).toBe('qualified')
  })

  it('analyzes owner-scoped storefront pages into classified contact evidence', async () => {
    await request(app.getHttpServer())
      .post(`/api/autoflow/leads/${leadId}/analyze-contacts`)
      .set('Cookie', otherCookie)
      .expect(404)

    const analyzed = await request(app.getHttpServer())
      .post(`/api/autoflow/leads/${leadId}/analyze-contacts`)
      .set('Cookie', ownerCookie)
      .expect(201)

    expect(analyzed.body.contacts).toEqual([
      expect.objectContaining({
        type: 'email',
        value: 'sales@pawspark.co',
        label: 'Sales Email',
        sourceUrl: 'https://pawspark.co/pages/contact',
        verificationStatus: 'verified',
        confidence: 95,
        sourcePageTitle: 'Contact PawSpark',
        sourcePageKind: 'contact',
        extractedFrom: 'mailto_link',
        evidence: expect.objectContaining({ proves: 'email' }),
      }),
    ])
    expect(analyzed.body.contacts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'website' }),
    ]))
    expect(analyzed.body.contactScore).toBeLessThanOrEqual(50)
  })

  it('collaborates on an owner-scoped bilingual outreach draft before queueing it', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/ai/outreach-conversations')
      .set('Cookie', ownerCookie)
      .send({
        leadId,
        channel: 'email',
        quoteMode: 'none',
        includeProductVisual: false,
        emphasizeSupplier: true,
        emphasizeLogistics: false,
        responseLanguage: 'zh-CN',
      })
      .expect(201)

    expect(created.body).toMatchObject({
      leadId,
      status: 'active',
      options: {
        channel: 'email',
        quoteMode: 'none',
        emphasizeSupplier: true,
        responseLanguage: 'zh-CN',
      },
      messages: [
        expect.objectContaining({ role: 'assistant', sequence: 1 }),
      ],
    })

    await request(app.getHttpServer())
      .get(`/api/ai/outreach-conversations/${created.body.id}`)
      .set('Cookie', otherCookie)
      .expect(404)

    const conversationTurn = await request(app.getHttpServer())
      .post(`/api/ai/outreach-conversations/${created.body.id}/messages`)
      .set('Cookie', ownerCookie)
      .send({ content: '请强调低起订量，并用自然、简洁的语气邀请客户回复。' })
      .expect(201)
    expect(conversationTurn.body).toMatchObject({
      userMessage: { role: 'user', sequence: 2 },
      assistantMessage: { role: 'assistant', sequence: 3 },
    })

    const generated = await request(app.getHttpServer())
      .post(`/api/ai/outreach-conversations/${created.body.id}/drafts`)
      .set('Cookie', ownerCookie)
      .expect(201)
    expect(generated.body).toMatchObject({
      conversationId: created.body.id,
      version: 1,
      status: 'draft',
      englishSubject: 'Sourcing support',
      englishMessage: 'Hi, may I share a verified sourcing option?',
      chineseSubject: '采购支持',
      chineseMessage: '您好，可以向您介绍一个已核实的采购方案吗？',
      factsUsed: ['Verified prospect context'],
      warnings: ['Human review required'],
    })

    const edited = await request(app.getHttpServer())
      .patch(`/api/ai/outreach-drafts/${generated.body.id}`)
      .set('Cookie', ownerCookie)
      .send({
        englishSubject: 'A low-MOQ sourcing option for PawSpark',
        englishMessage: 'Hi, may I share a low-MOQ sourcing option for your review?',
        chineseSubject: 'PawSpark 低起订量采购方案',
        chineseMessage: '您好，可以向您介绍一份低起订量采购方案供评估吗？',
      })
      .expect(200)
    expect(edited.body.englishMessage).toContain('low-MOQ')

    const accepted = await request(app.getHttpServer())
      .post(`/api/ai/outreach-drafts/${generated.body.id}/accept`)
      .set('Cookie', ownerCookie)
      .expect(201)
    expect(accepted.body.draft).toMatchObject({
      status: 'accepted',
      chineseMessage: '您好，可以向您介绍一份低起订量采购方案供评估吗？',
    })

    const tasks = await request(app.getHttpServer())
      .get(`/api/autoflow/outreach-tasks?leadId=${leadId}`)
      .set('Cookie', ownerCookie)
      .expect(200)
    expect(tasks.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: accepted.body.outreachTaskId,
        status: 'ready',
        channel: 'email',
        subject: 'A low-MOQ sourcing option for PawSpark',
        message: 'Hi, may I share a low-MOQ sourcing option for your review?',
      }),
    ]))

    await request(app.getHttpServer())
      .post(`/api/ai/outreach-conversations/${created.body.id}/messages`)
      .set('Cookie', ownerCookie)
      .send({ content: 'This accepted conversation must stay immutable.' })
      .expect(409)
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
        productProfitMarginRate: 30,
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
      logisticsChannels: [{
        customChannelCode: 'ECONOMY',
        customChannelName: 'Economy',
        actualChannelCode: '4PX-US-STD',
        actualChannelName: '4PX US Standard',
        logisticsProfitMarginRate: 20,
      }],
    }
    const created = await request(app.getHttpServer())
      .post('/api/autoflow/quotes')
      .set('Cookie', ownerCookie)
      .send(quoteDraft)
      .expect(201)

    expect(created.body).toMatchObject({ currentVersion: 1, currency: 'USD', status: 'draft' })
    expect(created.body.versions[0]).toMatchObject({
      version: 1,
      productCostStatus: 'not_requested',
      logisticsRateStatus: 'not_requested',
      resultSnapshot: null,
    })

    const exported = await request(app.getHttpServer())
      .get(`/api/autoflow/quotes/${created.body.id}/versions/1/export.xlsx`)
      .set('Cookie', ownerCookie)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => callback(null, Buffer.concat(chunks)))
      })
      .expect(200)
    expect(exported.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(exported.headers['content-disposition']).toContain('AutoFlow-Quotation-')
    expect(Buffer.isBuffer(exported.body)).toBe(true)
    expect(exported.body.length).toBeGreaterThan(10_000)
    expect(exported.body.subarray(0, 2).toString('ascii')).toBe('PK')

    await request(app.getHttpServer())
      .get(`/api/autoflow/quotes/${created.body.id}`)
      .set('Cookie', otherCookie)
      .expect(404)

    await request(app.getHttpServer())
      .get(`/api/autoflow/quotes/${created.body.id}/versions/1/export.xlsx`)
      .set('Cookie', otherCookie)
      .expect(404)

    const unavailableFopResult = await request(app.getHttpServer())
      .post(`/api/autoflow/quotes/${created.body.id}/request-fop`)
      .set('Cookie', ownerCookie)
      .expect(201)
    expect(unavailableFopResult.body.versions[0]).toMatchObject({
      version: 1,
      productCostStatus: 'failed',
      logisticsRateStatus: 'failed',
    })
    expect(unavailableFopResult.body.versions[0].resultSnapshot).toMatchObject({
      providerErrors: {
        productCost: expect.any(String),
        logisticsRates: expect.any(String),
      },
      combinedMatrix: expect.any(Array),
    })

    const revised = await request(app.getHttpServer())
      .post(`/api/autoflow/quotes/${created.body.id}/versions`)
      .set('Cookie', ownerCookie)
      .send({ ...quoteDraft, leadId: undefined, title: undefined })
      .expect(201)
    expect(revised.body.currentVersion).toBe(2)
    expect(revised.body.versions.map((version: { version: number }) => version.version)).toEqual([2, 1])
  })

  it('persists one fail-closed, retryable FOP handoff per lead', async () => {
    await request(app.getHttpServer())
      .post(`/api/autoflow/leads/${leadId}/fop-handoff`)
      .set('Cookie', otherCookie)
      .send({ reason: 'Qualified for FOP follow-up' })
      .expect(404)

    const first = await request(app.getHttpServer())
      .post(`/api/autoflow/leads/${leadId}/fop-handoff`)
      .set('Cookie', ownerCookie)
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
      .set('Cookie', ownerCookie)
      .send({ reason: 'Retry after integration check' })
      .expect(201)
    expect(second.body.id).toBe(first.body.id)
    expect(second.body.idempotencyKey).toBe(first.body.idempotencyKey)
    expect(second.body.attempts).toBe(2)
    expect(await dataSource.getRepository(FopHandoffEntity).countBy({ leadId })).toBe(1)
  })

  it('reviews outreach before updating lead and local follow-up activity', async () => {
    await dataSource.getRepository(LeadContactEntity).save({
      leadId,
      type: 'whatsapp',
      value: 'https://wa.me/15551234567',
      label: 'Sales WhatsApp',
      verified: true,
      isPrimary: true,
      sourceUrl: 'https://example.test/contact',
      sourceType: 'e2e_fixture',
      verificationStatus: 'verified',
      confidence: 100,
      evidence: {},
    })
    const generated = await request(app.getHttpServer())
      .post(`/api/autoflow/leads/${leadId}/messages`)
      .set('Cookie', ownerCookie)
      .send({
        channel: 'whatsapp',
        offer: 'fast fulfillment',
        quoteMode: 'combined',
        includeProductVisual: true,
        emphasizeSupplier: true,
        emphasizeLogistics: true,
        productImageUrl: 'https://cdn.example.test/product.jpg',
        verifiedQuoteContext: 'Product USD 12.50; US freight USD 8.20',
      })
      .expect(201)
    expect(generated.body.status).toBe('draft')
    expect(generated.body).toMatchObject({
      targetContact: 'https://wa.me/15551234567',
      templateKey: 'whatsapp-first-touch-v2-combined-visual-supplier-logistics',
      templateOptions: {
        quoteMode: 'combined',
        includeProductVisual: true,
        emphasizeSupplier: true,
        emphasizeLogistics: true,
        productImageUrl: 'https://cdn.example.test/product.jpg',
        verifiedQuoteContext: 'Product USD 12.50; US freight USD 8.20',
      },
      recommendedNextAction: 'Review and approve the message',
    })
    expect(generated.body.sendUrl).toContain('https://wa.me/15551234567?text=')

    await request(app.getHttpServer())
      .patch(`/api/autoflow/outreach-tasks/${generated.body.id}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'ready', message: 'Human-reviewed test draft' })
      .expect(200)

    await request(app.getHttpServer())
      .patch(`/api/autoflow/outreach-tasks/${generated.body.id}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'sent' })
      .expect(200)

    const lead = await dataSource.getRepository(LeadEntity).findOneByOrFail({ id: leadId })
    const activities = await dataSource.getRepository(CrmActivityEntity).findBy({ leadId })
    expect(lead.status).toBe('contacted')
    expect(activities.some((activity) => activity.toStatus === 'contacted')).toBe(true)
  })

  it('allocates short workflow IDs independently and safely for each user', async () => {
    const usersService = app.get(UsersService)
    await usersService.create(
      'workflow-sequence@autoflow.test',
      'workflow-sequence',
      'StrongPassword123',
    )
    await usersService.create(
      'workflow-independent@autoflow.test',
      'workflow-independent',
      'StrongPassword123',
    )
    const sequenceLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'workflow-sequence@autoflow.test', password: 'StrongPassword123' })
      .expect(201)
    const independentLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'workflow-independent@autoflow.test', password: 'StrongPassword123' })
      .expect(201)
    const sequenceCookie = sequenceLogin.headers['set-cookie'][0].split(';')[0]
    const independentCookie = independentLogin.headers['set-cookie'][0].split(';')[0]
    const workflowPayload = (index: number) => ({
      name: `Sequence workflow ${index}`,
      seedType: 'keyword',
      seedValue: `sequence-product-${index}`,
      targetMarket: 'United States',
    })

    const sequenceWorkflows = await Promise.all(
      [1, 2, 3].map((index) =>
        request(app.getHttpServer())
          .post('/api/autoflow/workflows')
          .set('Cookie', sequenceCookie)
          .send(workflowPayload(index))
          .expect(201)),
    )
    const independentWorkflow = await request(app.getHttpServer())
      .post('/api/autoflow/workflows')
      .set('Cookie', independentCookie)
      .send(workflowPayload(1))
      .expect(201)

    expect(sequenceWorkflows.map((response) => response.body.displayId).sort()).toEqual([
      '01',
      '02',
      '03',
    ])
    expect(independentWorkflow.body.displayId).toBe('01')
    expect(sequenceWorkflows[0].body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
