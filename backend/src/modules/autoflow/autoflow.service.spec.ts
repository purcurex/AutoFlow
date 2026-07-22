import { NotFoundException } from '@nestjs/common'
import { AutoflowService } from './autoflow.service'

describe('AutoflowService', () => {
  let service: AutoflowService

  beforeEach(() => {
    service = new AutoflowService()
  })

  it('creates a keyword workflow with seed stage', () => {
    const workflow = service.createWorkflow({
      seedType: 'keyword',
      seedValue: 'pet grooming brush',
      targetMarket: 'United States',
    })

    expect(workflow.name).toBe('pet grooming brush prospect workflow')
    expect(workflow.status).toBe('draft')
    expect(workflow.currentStage).toBe('seed')
    expect(service.getWorkflows()[0].id).toBe(workflow.id)
  })

  it('returns a lead by id', () => {
    const lead = service.getLead('lead-001')

    expect(lead.brandName).toBe('PawSpark')
    expect(lead.totalScore).toBeGreaterThan(0)
  })

  it('throws when lead is missing', () => {
    expect(() => service.getLead('missing-lead')).toThrow(NotFoundException)
  })

  it('generates a ready outreach task for a lead', () => {
    const task = service.generateMessage('lead-001', { channel: 'whatsapp' })

    expect(task.leadId).toBe('lead-001')
    expect(task.channel).toBe('whatsapp')
    expect(task.status).toBe('ready')
    expect(task.message).toContain('PawSpark')
  })
})
