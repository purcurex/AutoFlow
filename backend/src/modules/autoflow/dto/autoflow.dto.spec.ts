import { validate } from 'class-validator'
import {
  CreateWorkflowDto,
  GenerateMessageDto,
  ListLeadsQueryDto,
  UpdateLeadStatusDto,
  UpdateOutreachTaskDto,
} from './autoflow.dto'

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

  it('accepts controlled image asset metadata and rejects it for keyword workflows', async () => {
    const asset = {
      seedAssetPath: '/uploads/workflow-seeds/11111111-1111-4111-8111-111111111111/image.png',
      seedAssetMimeType: 'image/png',
      seedAssetSize: 128,
      seedAssetSha256: 'a'.repeat(64),
    }
    const imageDto = Object.assign(new CreateWorkflowDto(), {
      seedType: 'image',
      seedValue: 'https://assets.example.test/image.png',
      ...asset,
    })
    const keywordDto = Object.assign(new CreateWorkflowDto(), {
      seedType: 'keyword',
      seedValue: 'pet grooming brush',
      ...asset,
    })

    await expect(validate(imageDto)).resolves.toHaveLength(0)
    expect((await validate(keywordDto)).map((error) => error.property)).toContain(
      'seedAssetPath',
    )
  })

  it('rejects uncontrolled or incomplete image asset metadata', async () => {
    const dto = Object.assign(new CreateWorkflowDto(), {
      seedType: 'image',
      seedValue: 'https://assets.example.test/image.png',
      seedAssetPath: '/tmp/image.png',
    })

    expect((await validate(dto)).map((error) => error.property)).toContain(
      'seedAssetPath',
    )
  })

  it('accepts the message fields used by the frontend and service', async () => {
    const dto = Object.assign(new GenerateMessageDto(), {
      channel: 'whatsapp',
      language: 'English',
      offer: 'low-MOQ sourcing and fast fulfillment',
      quoteMode: 'combined',
      includeProductVisual: true,
      emphasizeSupplier: true,
      emphasizeLogistics: true,
      productImageUrl: 'https://cdn.example.test/product.jpg',
      verifiedQuoteContext: 'Product USD 12; US freight USD 8',
    })

    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it('rejects unsupported quote modes and non-HTTPS product image URLs', async () => {
    const dto = Object.assign(new GenerateMessageDto(), {
      quoteMode: 'discount_bundle',
      productImageUrl: 'http://example.test/product.jpg',
    })

    const properties = (await validate(dto)).map((error) => error.property)
    expect(properties).toEqual(expect.arrayContaining(['quoteMode', 'productImageUrl']))
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

  it('validates lead list and status update contracts', async () => {
    const query = Object.assign(new ListLeadsQueryDto(), { status: 'unsupported', pageSize: 1000 })
    const status = Object.assign(new UpdateLeadStatusDto(), { status: 'quoted' })

    await expect(validate(query)).resolves.not.toHaveLength(0)
    await expect(validate(status)).resolves.not.toHaveLength(0)
  })
})
