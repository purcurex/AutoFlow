import { Injectable, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Anthropic from '@anthropic-ai/sdk'

@Injectable()
export class AiService implements OnModuleInit {
  private anthropic: Anthropic | null = null

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY')
    if (apiKey && apiKey !== 'your-anthropic-api-key') {
      this.anthropic = new Anthropic({ apiKey })
    }
  }

  async generateText(prompt: string, context?: string): Promise<string> {
    if (!this.anthropic) {
      throw new Error('AI服务未配置，请设置ANTHROPIC_API_KEY')
    }

    const systemPrompt = `你是一个专业的写作助手。你需要帮助用户完成写作任务，包括续写、润色、摘要、翻译等。
请用中文回复，保持专业和友好的语气。`

    const userPrompt = context
      ? `上下文：\n${context}\n\n任务：\n${prompt}`
      : prompt

    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const textBlock = message.content[0] as Anthropic.TextBlock
    return textBlock.text
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
