import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Anthropic from '@anthropic-ai/sdk'

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name)
  private anthropic: Anthropic | null = null

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY')
    if (apiKey && apiKey !== 'your-anthropic-api-key') {
      this.anthropic = new Anthropic({ apiKey })
    }
  }

  async generateText(prompt: string, context?: string): Promise<string> {
    const systemPrompt = `你是一个专业的写作助手。你需要帮助用户完成写作任务，包括续写、润色、摘要、翻译等。
请用中文回复，保持专业和友好的语气。`

    const userPrompt = context
      ? `上下文：\n${context}\n\n任务：\n${prompt}`
      : prompt

    return this.generateWithSystem(systemPrompt, userPrompt)
  }

  async generateSalesOutreach(input: {
    channel: string
    language: string
    brandName: string
    domain: string
    category: string
    country: string
    evidenceSummary: string
    offer: string
  }): Promise<string> {
    const systemPrompt = `You write concise first-touch outbound messages for a Dropshipping supply-chain sales team.
The prospect is an overseas small business. Use only the supplied facts, never invent performance claims, contacts, ad details, or pricing.
Make the message specific, respectful, low-pressure, and suitable for human review before sending.
Return only the message body in the requested language. Do not add analysis, headings, or placeholders.`
    const userPrompt = [
      `Channel: ${input.channel}`,
      `Language: ${input.language}`,
      `Brand: ${input.brandName}`,
      `Store: ${input.domain}`,
      `Category: ${input.category || 'Unknown'}`,
      `Market: ${input.country || 'Unknown'}`,
      `Available lead context: ${input.evidenceSummary || 'No additional evidence'}`,
      `Offer: ${input.offer}`,
      'Write one short opening message with one clear call to action.',
    ].join('\n')
    return this.generateWithSystem(systemPrompt, userPrompt)
  }

  private async generateWithSystem(system: string, prompt: string): Promise<string> {
    if (!this.anthropic) {
      throw new ServiceUnavailableException('AI service is not configured. Set ANTHROPIC_API_KEY.')
    }

    let message: Anthropic.Message
    try {
      message = await this.anthropic.messages.create({
        model: this.configService.get<string>('ANTHROPIC_MODEL', 'claude-sonnet-4-20250514'),
        max_tokens: 2048,
        system,
        messages: [{ role: 'user', content: prompt }],
      })
    } catch (error) {
      this.logger.warn(`AI provider request failed: ${error instanceof Error ? error.message : 'unknown error'}`)
      throw new ServiceUnavailableException('AI provider is temporarily unavailable. Retry later.')
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text.trim())
      .filter(Boolean)
      .join('\n')
    if (!text) throw new ServiceUnavailableException('AI provider returned an empty response.')
    return text
  }

  async continueWriting(content: string): Promise<string> {
    return this.generateText(`请续写以下内容，保持文风一致：\n\n${content}`)
  }

  async polishText(content: string): Promise<string> {
    return this.generateText(`请润色以下文字，使其更加通顺、优美：\n\n${content}`)
  }

  async summarize(content: string): Promise<string> {
    return this.generateText(`请为以下内容生成一个简洁的摘要：\n\n${content}`)
  }

  async translate(content: string, targetLanguage: string): Promise<string> {
    return this.generateText(`请将以下内容翻译成${targetLanguage}：\n\n${content}`)
  }

  async suggestTags(content: string): Promise<string[]> {
    const result = await this.generateText(
      `请为以下内容推荐3-5个标签，以JSON数组格式返回，例如：["标签1", "标签2"]：\n\n${content}`,
    )
    try {
      return JSON.parse(result)
    } catch {
      return []
    }
  }
}
