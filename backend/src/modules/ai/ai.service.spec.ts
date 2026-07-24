import { ServiceUnavailableException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import axios from 'axios'
import { AiService } from './ai.service'

describe('AiService sales outreach', () => {
  afterEach(() => jest.restoreAllMocks())

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
      quoteMode: 'none', includeProductVisual: false, emphasizeSupplier: false, emphasizeLogistics: false,
      productImageUrl: null, verifiedQuoteContext: null,
      promptModules: ['Write a short WhatsApp message.'],
    })).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('generates outreach through the configured Zhipu GLM endpoint', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => ({
        ZHIPU_API_KEY: 'test-key',
      } as Record<string, unknown>)[key] ?? fallback),
    } as unknown as ConfigService
    const post = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { choices: [{ message: { content: 'Hi PawSpark, could we compare sourcing options?' } }] },
    })
    const service = new AiService(config)
    service.onModuleInit()

    const result = await service.generateSalesOutreach({
      channel: 'whatsapp', language: 'English', brandName: 'PawSpark', domain: 'pawspark.example',
      category: 'Pet supplies', country: 'US', evidenceSummary: 'Verified Shopify storefront',
      offer: 'product sourcing and fulfillment support',
      quoteMode: 'combined', includeProductVisual: true, emphasizeSupplier: true, emphasizeLogistics: true,
      productImageUrl: 'https://cdn.example.test/product.jpg',
      verifiedQuoteContext: 'Product USD 12; US freight USD 8',
      promptModules: ['Use the verified combined quotation.'],
    })

    expect(result).toBe('Hi PawSpark, could we compare sourcing options?')
    const requestBody = post.mock.calls[0][1] as { messages: Array<{ role: string; content: string }> }
    expect(requestBody.messages.find((message) => message.role === 'user')?.content).toContain('Quote mode: combined')
    expect(requestBody.messages.find((message) => message.role === 'user')?.content).toContain('Product USD 12; US freight USD 8')
    expect(post).toHaveBeenCalledWith(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      expect.objectContaining({
        model: 'glm-5.2',
        thinking: { type: 'disabled' },
        temperature: 1,
        messages: expect.arrayContaining([expect.objectContaining({ role: 'system' })]),
      }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-key' }) }),
    )
  })

  it('enables bounded GLM reasoning only when explicitly configured', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => ({
        ZHIPU_API_KEY: 'test-key',
        ZHIPU_MODEL: 'glm-5.2',
        ZHIPU_THINKING_TYPE: 'enabled',
        ZHIPU_REASONING_EFFORT: 'high',
      } as Record<string, unknown>)[key] ?? fallback),
    } as unknown as ConfigService
    const post = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { choices: [{ message: { content: 'Analysis result' } }] },
    })
    const service = new AiService(config)
    service.onModuleInit()

    await service.generateText('Analyze this prospect')

    expect(post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        model: 'glm-5.2',
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
      }),
      expect.any(Object),
    )
  })

  it('does not expose provider failures to callers', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => key === 'ZHIPU_API_KEY' ? 'test-key' : fallback),
    } as unknown as ConfigService
    jest.spyOn(axios, 'post').mockRejectedValue(new Error('provider details'))
    const service = new AiService(config)
    service.onModuleInit()

    await expect(service.generateText('test')).rejects.toThrow('AI provider is temporarily unavailable')
  })

  it('maintains multi-turn outreach context and asks in the selected interface language', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => key === 'ZHIPU_API_KEY' ? 'test-key' : fallback),
    } as unknown as ConfigService
    const post = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { choices: [{ message: { content: '请补充希望推广的产品和行动引导。' } }] },
    })
    const service = new AiService(config)
    service.onModuleInit()

    const result = await service.continueOutreachConversation({
      responseLanguage: 'zh-CN',
      contextSnapshot: { brandName: 'PawSpark' },
      options: { channel: 'whatsapp' },
      promptModules: ['Use a low-pressure tone.'],
      messages: [
        { role: 'user', content: '突出低起订量' },
        { role: 'assistant', content: '请问主要产品是什么？' },
        { role: 'user', content: '宠物梳子' },
      ],
    })

    expect(result).toContain('请补充')
    const body = post.mock.calls[0][1] as { messages: Array<{ role: string; content: string }> }
    expect(body.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: '突出低起订量' }),
      expect.objectContaining({ role: 'assistant', content: '请问主要产品是什么？' }),
    ]))
    expect(body.messages[0].content).toContain('Simplified Chinese')
  })

  it('parses a structured English and Chinese outreach draft', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => key === 'ZHIPU_API_KEY' ? 'test-key' : fallback),
    } as unknown as ConfigService
    const post = jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              english: { subject: 'Pet sourcing', message: 'Hi, may I share a low-MOQ option?' },
              chinese: { subject: '宠物用品采购', message: '您好，可以向您介绍低起订量方案吗？' },
              factsUsed: ['Low MOQ'],
              missingFacts: [],
              warnings: ['Human review required'],
            }),
          },
        }],
      },
    })
    const service = new AiService(config)
    service.onModuleInit()

    const result = await service.generateBilingualOutreach({
      contextSnapshot: { brandName: 'PawSpark' },
      options: { channel: 'email' },
      promptModules: ['Use a concise email.'],
      messages: [{ role: 'user', content: 'Use a low-pressure CTA.' }],
    })

    expect(result.english.message).toContain('low-MOQ')
    expect(result.chinese.message).toContain('低起订量')
    expect(result.factsUsed).toEqual(['Low MOQ'])
    expect(post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ response_format: { type: 'json_object' } }),
      expect.any(Object),
    )
  })

  it('rejects incomplete bilingual output', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => key === 'ZHIPU_API_KEY' ? 'test-key' : fallback),
    } as unknown as ConfigService
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              english: { subject: '', message: 'English only' },
              chinese: { subject: '', message: '' },
            }),
          },
        }],
      },
    })
    const service = new AiService(config)
    service.onModuleInit()

    await expect(service.generateBilingualOutreach({
      contextSnapshot: {},
      options: {},
      promptModules: [],
      messages: [],
    })).rejects.toThrow('incomplete bilingual draft')
  })
})
