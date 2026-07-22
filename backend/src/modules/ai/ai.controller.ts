import { Controller, Post, Body, UseGuards } from '@nestjs/common'
import { AiService } from './ai.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Throttle } from '@nestjs/throttler'
import { GenerateAiTextDto, SuggestTagsDto } from './dto/ai.dto'

@Controller('ai')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('generate')
  async generate(@Body() body: GenerateAiTextDto) {
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
  async suggestTags(@Body() body: SuggestTagsDto) {
    const tags = await this.aiService.suggestTags(body.content)
    return { tags }
  }
}
