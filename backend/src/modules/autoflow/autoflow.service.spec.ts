import { ConflictException, NotFoundException } from '@nestjs/common'
import type { DataSource, ObjectLiteral, Repository } from 'typeorm'
import { AutoflowService } from './autoflow.service'
import {
  CrmActivityEntity,
  LeadEntity,
  OutreachTaskEntity,
  WorkflowRunEntity,
  WorkflowStepEntity,
} from './entities'
import type { AiService } from '../ai/ai.service'

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
    const leads = repository<LeadEntity>()
    const outreach = repository<OutreachTaskEntity>()
    const activities = repository<CrmActivityEntity>()
    const dataSource = { transaction: jest.fn() } as unknown as jest.Mocked<DataSource>
    const aiService = {
      generateSalesOutreach: jest.fn().mockResolvedValue('Draft outreach message'),
    } as unknown as jest.Mocked<AiService>
    const service = new AutoflowService(workflows, steps, leads, outreach, activities, dataSource, aiService)
    return { service, workflows, steps, leads, outreach, activities, dataSource, aiService }
  }

  it('scopes workflow lists to the authenticated owner', async () => {
    const { service, workflows } = createService()
    const createdAt = new Date('2026-07-22T00:00:00.000Z')
    workflows.findAndCount.mockResolvedValue([
      [{
        id: 'workflow-1',
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

    const result = await service.getWorkflows('owner-1', { page: 1, pageSize: 20 })

    expect(workflows.findAndCount).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerUserId: 'owner-1' },
    }))
    expect(result.items[0].id).toBe('workflow-1')
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
    } as LeadEntity)
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
    const { service, leads, outreach, aiService } = createService()
    leads.findOne.mockResolvedValue({
      id: 'lead-1', ownerUserId: 'owner-1', brandName: 'Store', domain: 'store.test',
    } as LeadEntity)
    aiService.generateSalesOutreach.mockRejectedValue(new Error('provider unavailable'))

    await expect(service.generateMessage('owner-1', 'lead-1', {})).rejects.toThrow('provider unavailable')
    expect(outreach.save).not.toHaveBeenCalled()
  })
})
