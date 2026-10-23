jest.mock('../users/business-data-access', () => ({ readBusinessOwners: jest.fn(async (_dataSource, id) => ({ ids: [id], filter: id })) }))
import { ConflictException, NotFoundException } from '@nestjs/common'
import type { DataSource, ObjectLiteral, Repository } from 'typeorm'
import { AutoflowService } from './autoflow.service'
import {
  CrmActivityEntity,
  LeadEntity,
  OutreachTaskEntity,
  WorkflowJobEntity,
  WorkflowRunEntity,
  WorkflowStepEntity,
} from './entities'
import type { AiService } from '../ai/ai.service'
import type { PromptTemplateService } from '../ai/prompt-template.service'
import type { StorefrontEnrichmentService } from '../discovery/storefront-enrichment.service'
import type { WorkflowSeedAssetService } from './workflow-seed-asset.service'

describe('AutoflowService persistence boundaries', () => {
  function repository<T extends ObjectLiteral>() {
    return {
      count: jest.fn(),
      create: jest.fn((value) => value),
      find: jest.fn(),
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<T>>
  }

  function createService() {
    const workflows = repository<WorkflowRunEntity>()
    const steps = repository<WorkflowStepEntity>()
    steps.find.mockResolvedValue([])
    const jobs = repository<WorkflowJobEntity>()
    jobs.find.mockResolvedValue([])
    const leads = repository<LeadEntity>()
    const outreach = repository<OutreachTaskEntity>()
    const activities = repository<CrmActivityEntity>()
    const dataSource = { transaction: jest.fn() } as unknown as jest.Mocked<DataSource>
    const aiService = {
      generateSalesOutreach: jest.fn().mockResolvedValue('Draft outreach message'),
    } as unknown as jest.Mocked<AiService>
    const promptTemplateService = {
      resolve: jest.fn().mockResolvedValue(['Resolved prompt module']),
    } as unknown as jest.Mocked<PromptTemplateService>
    const storefrontEnrichmentService = {
      enrichStore: jest.fn(),
    } as unknown as jest.Mocked<StorefrontEnrichmentService>
    const workflowSeedAssetService = {
      assertOwnedAsset: jest.fn(),
    } as unknown as jest.Mocked<WorkflowSeedAssetService>
    const service = new AutoflowService(
      workflows,
      steps,
      jobs,
      leads,
      outreach,
      activities,
      dataSource,
      aiService,
      promptTemplateService,
      storefrontEnrichmentService,
      workflowSeedAssetService,
    )
    return {
      service,
      workflows,
      steps,
      jobs,
      leads,
      outreach,
      activities,
      dataSource,
      aiService,
      promptTemplateService,
      storefrontEnrichmentService,
      workflowSeedAssetService,
    }
  }

  it('scopes workflow lists to the authenticated owner', async () => {
    const { service, workflows, steps, jobs } = createService()
    const createdAt = new Date('2026-07-22T00:00:00.000Z')
    workflows.findAndCount.mockResolvedValue([
      [{
        id: 'workflow-1',
        displayId: '01',
        name: 'Prospecting',
        seedType: 'keyword',
        seedValue: 'pet brush',
        targetMarket: 'United States',
        status: 'draft',
        currentStage: 'seed',
        progress: 0,
        leadCount: 0,
        createdAt,
        updatedAt: createdAt,
      } as WorkflowRunEntity],
      1,
    ])
    jobs.find.mockResolvedValue([{
      workflowRunId: 'workflow-1',
      ownerUserId: 'owner-1',
      lastError: 'PipiAds credits are insufficient',
    } as WorkflowJobEntity])
    steps.find.mockResolvedValue([{
      workflowRunId: 'workflow-1',
      stage: 'ad_discovery',
      status: 'skipped',
      output: { reasonCode: 'public_image_not_configured' },
    } as unknown as WorkflowStepEntity])

    const result = await service.getWorkflows('owner-1', { page: 1, pageSize: 20 })

    expect(workflows.findAndCount).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: 'owner-1' }),
    }))
    expect(result.items[0].id).toBe('workflow-1')
    expect(result.items[0].displayId).toBe('01')
    expect(result.items[0].failureReason).toBe('PipiAds credits are insufficient')
    expect(result.items[0].failureCode).toBe('insufficient_credits')
    expect(result.items[0].failureProvider).toBe('pipiads')
    expect(result.items[0].failureRetryable).toBe(false)
    expect(result.items[0].customerDiscoveryStatus).toBe('pending_public_image')
    expect(steps.find).toHaveBeenCalledTimes(1)
  })

  it('exposes a PipiAds image fetch rejection as a non-retryable unreachable image', async () => {
    const { service, workflows, jobs } = createService()
    const createdAt = new Date('2026-08-05T00:00:00.000Z')
    workflows.findAndCount.mockResolvedValue([[
      {
        id: 'workflow-image',
        displayId: '10',
        name: 'Pet product image sourcing',
        seedType: 'image',
        seedValue: 'http://localhost:3000/uploads/workflow-seeds/owner/product.jpg',
        targetMarket: 'United States',
        status: 'failed',
        currentStage: 'ad_discovery',
        progress: 10,
        leadCount: 0,
        createdAt,
        updatedAt: createdAt,
      } as WorkflowRunEntity,
    ], 1])
    jobs.find.mockResolvedValue([{
      workflowRunId: 'workflow-image',
      ownerUserId: 'owner-1',
      lastError: 'PipiAds product image fetch failed. Use a publicly reachable HTTPS image URL or configure PUBLIC_ASSET_BASE_URL.',
    } as WorkflowJobEntity])

    const result = await service.getWorkflows('owner-1', { page: 1, pageSize: 20 })

    expect(result.items[0]).toMatchObject({
      failureCode: 'image_unreachable',
      failureProvider: 'pipiads',
      failureRetryable: false,
    })
  })

  it('classifies a historical local-image configuration failure as customer discovery', async () => {
    const { service, workflows, jobs } = createService()
    const createdAt = new Date('2026-08-05T00:00:00.000Z')
    workflows.findAndCount.mockResolvedValue([[
      {
        id: 'workflow-local-image',
        displayId: '11',
        name: 'Local image sourcing',
        seedType: 'image',
        seedValue: 'http://localhost:3000/uploads/workflow-seeds/owner/product.jpg',
        targetMarket: 'United States',
        status: 'failed',
        currentStage: 'ad_discovery',
        progress: 10,
        leadCount: 0,
        createdAt,
        updatedAt: createdAt,
      } as WorkflowRunEntity,
    ], 1])
    jobs.find.mockResolvedValue([{
      workflowRunId: 'workflow-local-image',
      ownerUserId: 'owner-1',
      lastError: 'Workflow product image is only available locally. Configure a publicly reachable PUBLIC_ASSET_BASE_URL.',
    } as WorkflowJobEntity])

    const result = await service.getWorkflows('owner-1', { page: 1, pageSize: 20 })

    expect(result.items[0]).toMatchObject({
      failureCode: 'image_unreachable',
      failureProvider: 'customer_discovery',
      failureRetryable: false,
    })
  })

  it('does not return a lead outside the owner scope', async () => {
    const { service, leads } = createService()
    leads.findOne.mockResolvedValue(null)

    await expect(service.getLead('owner-1', 'lead-1')).rejects.toBeInstanceOf(NotFoundException)
    expect(leads.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lead-1', ownerUserId: 'owner-1' },
    }))
  })

  it('rejects an invalid lead status transition before saving', async () => {
    const { service, leads, activities, dataSource } = createService()
    leads.findOne.mockResolvedValue({ id: 'lead-1', ownerUserId: 'owner-1', status: 'new' } as LeadEntity)
    ;(dataSource.transaction as jest.Mock).mockImplementation(async (callback) => callback({
      getRepository: (entity: unknown) => entity === LeadEntity ? leads : activities,
    } as never))

    await expect(
      service.updateLeadStatus('owner-1', 'lead-1', { status: 'won' }),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(leads.save).not.toHaveBeenCalled()
  })

  it('creates an AI-generated outreach task as a human-review draft', async () => {
    const { service, leads, outreach, aiService } = createService()
    leads.findOne.mockResolvedValue({
      id: 'lead-1',
      ownerUserId: 'owner-1',
      teamId: null,
      brandName: 'Example Store',
      domain: 'example.test',
      language: 'English',
      category: 'Pet supplies',
      country: 'US',
      recommendedAngle: 'Verified Shopify store',
    } as unknown as LeadEntity)
    outreach.save.mockImplementation(async (task) => ({ id: 'task-1', ...task }) as OutreachTaskEntity)
    outreach.findOne.mockResolvedValue({
      id: 'task-1',
      leadId: 'lead-1',
      ownerUserId: 'owner-1',
      channel: 'whatsapp',
      status: 'draft',
      message: 'Draft outreach message',
      nextFollowUpAt: null,
      lead: { brandName: 'Example Store' },
      owner: { username: 'owner' },
      createdAt: new Date('2026-07-24T00:00:00.000Z'),
    } as OutreachTaskEntity)

    const task = await service.generateMessage('owner-1', 'lead-1', { channel: 'whatsapp' })

    expect(aiService.generateSalesOutreach).toHaveBeenCalledWith(expect.objectContaining({
      brandName: 'Example Store',
      channel: 'whatsapp',
    }))
    expect(outreach.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }))
    expect(task.status).toBe('draft')
  })

  it('does not create an outreach task when the AI provider fails', async () => {
    const { service, leads, outreach, aiService, promptTemplateService } = createService()
    leads.findOne.mockResolvedValue({
      id: 'lead-1', ownerUserId: 'owner-1', brandName: 'Store', domain: 'store.test',
    } as LeadEntity)
    aiService.generateSalesOutreach.mockRejectedValue(new Error('provider unavailable'))

    await expect(service.generateMessage('owner-1', 'lead-1', {})).rejects.toThrow('provider unavailable')
    expect(promptTemplateService.resolve).toHaveBeenCalledWith(
      'owner-1',
      expect.arrayContaining(['channel_facebook']),
      expect.objectContaining({ channel: 'facebook' }),
    )
    expect(outreach.save).not.toHaveBeenCalled()
  })

  it('blocks quote and product-image templates that lack verified inputs', async () => {
    const { service, leads, outreach, aiService } = createService()
    leads.findOne.mockResolvedValue({
      id: 'lead-1', ownerUserId: 'owner-1', brandName: 'Store', domain: 'store.test', contacts: [],
    } as unknown as LeadEntity)

    await expect(service.generateMessage('owner-1', 'lead-1', {
      quoteMode: 'product',
    })).rejects.toThrow('Verified quote context is required')
    await expect(service.generateMessage('owner-1', 'lead-1', {
      includeProductVisual: true,
    })).rejects.toThrow('A product image URL is required')
    expect(aiService.generateSalesOutreach).not.toHaveBeenCalled()
    expect(outreach.save).not.toHaveBeenCalled()
  })
})
