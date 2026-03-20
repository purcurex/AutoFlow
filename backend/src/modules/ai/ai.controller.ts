import { Controller, Post, Body, UseGuards } from '@nestjs/common'
import { AiService } from './ai.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('generate')
  async generate(@Body() body: { action: string; content: string; context?: string }) {
    const { action, content, context } = body

    let result: string

    switch (action) {
      case 'continue':
        result = await this.aiService.continueWriting(content)
        break
      case 'polish':
        result = await this.aiService.polishText(content)
        break
      case 'summarize':
        result = await this.aiService.summarize(content)
        break
      case 'translate':
        result = await this.aiService.translate(content, context || '英文')
        break
      default:
        result = await this.aiService.generateText(content, context)
    }

    return { result }
  }

  @Post('suggest-tags')
  async suggestTags(@Body() body: { content: string }) {
    const tags = await this.aiService.suggestTags(body.content)
    return { tags }
  }
}
