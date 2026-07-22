import { ServiceUnavailableException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { AiService } from './ai.service'

describe('AiService sales outreach', () => {
  it('fails clearly when the AI provider is not configured', async () => {
    const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService
    const service = new AiService(config)
    service.onModuleInit()

    await expect(service.generateSalesOutreach({
      channel: 'whatsapp',
      language: 'English',
      brandName: 'Example Store',
      domain: 'example.test',
      category: 'Pet supplies',
      country: 'US',
      evidenceSummary: 'Shopify store detected',
      offer: 'product sourcing support',
    })).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
