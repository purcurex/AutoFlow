import { validate } from 'class-validator'
import { CreateWorkflowDto, GenerateMessageDto, UpdateOutreachTaskDto } from './autoflow.dto'

describe('AutoFlow DTO contracts', () => {
  it('accepts the minimum workflow creation payload', async () => {
    const dto = Object.assign(new CreateWorkflowDto(), {
      seedType: 'keyword',
      seedValue: 'pet grooming brush',
    })

    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it('rejects an unsupported workflow seed type', async () => {
    const dto = Object.assign(new CreateWorkflowDto(), {
      seedType: 'document',
      seedValue: 'pet grooming brush',
    })

    const errors = await validate(dto)

    expect(errors.some((error) => error.property === 'seedType')).toBe(true)
  })

  it('accepts the message fields used by the frontend and service', async () => {
    const dto = Object.assign(new GenerateMessageDto(), {
      channel: 'whatsapp',
      language: 'English',
      offer: 'low-MOQ sourcing and fast fulfillment',
    })

    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it('rejects invalid outreach status and follow-up date values', async () => {
    const dto = Object.assign(new UpdateOutreachTaskDto(), {
      status: 'queued',
      nextFollowUpAt: 'tomorrow morning',
    })

    const errors = await validate(dto)
    const properties = errors.map((error) => error.property)

    expect(properties).toEqual(expect.arrayContaining(['status', 'nextFollowUpAt']))
  })
})
