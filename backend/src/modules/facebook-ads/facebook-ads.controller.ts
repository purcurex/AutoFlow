import { Controller, Post, Body, HttpException, HttpStatus, UseGuards } from '@nestjs/common'
import { FacebookAdsService, FacebookAd, SearchCountInfo, SearchFilters } from './facebook-ads.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Throttle } from '@nestjs/throttler'
import { FacebookImageSearchDto, FacebookKeywordSearchDto } from './dto/facebook-ads.dto'

/**
 * 默认搜索过滤条件
 */
const DEFAULT_FILTERS: SearchFilters = {
  activeOnly: true,  // 正在投放的广告
  daysRange: 365,    // 近1年
}

/**
 * 搜索结果响应
 */
export interface FacebookAdsSearchResult {
  ads: FacebookAd[]
  noteContent: string
  noteTitle: string
  searchCountInfo?: SearchCountInfo
  error?: string
}

/**
 * Facebook Ads搜索控制器
 */
@Controller('facebook-ads')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
export class FacebookAdsController {
  constructor(private readonly facebookAdsService: FacebookAdsService) {}

  /**
   * 通过图片URL搜索Facebook广告
   */
  @Post('by-image-url')
  async searchByImageUrl(
    @Body() request: FacebookImageSearchDto
  ): Promise<FacebookAdsSearchResult> {
    if (!request.imageUrl || !request.imageUrl.trim()) {
      throw new HttpException('请输入图片URL', HttpStatus.BAD_REQUEST)
    }

    // 合并默认过滤条件
    const filters: SearchFilters = {
      ...DEFAULT_FILTERS,
      ...request.filters,
    }

    try {
      const ads = await this.facebookAdsService.searchAdsByImageUrl(request.imageUrl, filters)
      const searchCountInfo = this.facebookAdsService.getSearchCountInfo()
      const noteContent = this.facebookAdsService.formatResultsAsNoteContent(
        ads,
        '图片',
        request.imageUrl,
        undefined,
        searchCountInfo,
        filters
      )
      const noteTitle = this.facebookAdsService.generateNoteTitle('图片')

      return {
        ads,
        noteContent,
        noteTitle,
        searchCountInfo,
      }
    } catch (error: any) {
      if (error.message === 'Daily search limit reached') {
        throw new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS)
      }
      throw new HttpException(
        `搜索失败: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  /**
   * 通过关键词搜索Facebook广告
   */
  @Post('by-keyword')
  async searchByKeyword(
    @Body() request: FacebookKeywordSearchDto
  ): Promise<FacebookAdsSearchResult> {
    if (!request.keyword || !request.keyword.trim()) {
      throw new HttpException('请输入搜索关键词', HttpStatus.BAD_REQUEST)
    }

    // 合并默认过滤条件
    const filters: SearchFilters = {
      ...DEFAULT_FILTERS,
      ...request.filters,
    }

    try {
      const ads = await this.facebookAdsService.searchAdsByKeyword(request.keyword, filters)
      const searchCountInfo = this.facebookAdsService.getSearchCountInfo()
      const noteContent = this.facebookAdsService.formatResultsAsNoteContent(
        ads,
        '关键词',
        undefined,
        request.keyword,
        searchCountInfo,
        filters
      )
      const noteTitle = this.facebookAdsService.generateNoteTitle('关键词', request.keyword)

      return {
        ads,
        noteContent,
        noteTitle,
        searchCountInfo,
      }
    } catch (error: any) {
      if (error.message === 'Daily search limit reached') {
        throw new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS)
      }
      throw new HttpException(
        `搜索失败: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  /**
   * 获取搜索统计信息
   */
  @Post('stats')
  getSearchStats(): SearchCountInfo {
    return this.facebookAdsService.getSearchCountInfo()
  }
}
