import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'

/**
 * Facebook广告信息
 */
export interface FacebookAd {
  name: string
  url: string
  description?: string
  imageUrl?: string
}

/**
 * 搜索过滤条件
 */
export interface SearchFilters {
  /** 是否只显示正在投放的广告 */
  activeOnly?: boolean
  /** 时间范围（天数） */
  daysRange?: number
}

/**
 * 搜索次数信息
 */
export interface SearchCountInfo {
  current: number
  remaining: number
  limit: number
}

/**
 * Facebook Ads搜索服务
 *
 * @example
 * // 在模块中注入
 * constructor(private facebookAdsService: FacebookAdsService) {}
 *
 * // 图片URL搜索
 * const ads = await this.facebookAdsService.searchAdsByImageUrl(imageUrl)
 *
 * // 关键词搜索
 * const ads = await this.facebookAdsService.searchAdsByKeyword(keyword)
 */
@Injectable()
export class FacebookAdsService {
  private readonly logger = new Logger(FacebookAdsService.name)
  private readonly serpApiKey: string | undefined
  private readonly dailyLimit: number

  // 每日搜索次数跟踪
  private searchCount: Map<string, number> = new Map()

  constructor(private configService: ConfigService) {
    this.serpApiKey = this.configService.get<string>('SERPAPI_KEY')
    this.dailyLimit = this.configService.get<number>('DAILY_SEARCH_LIMIT') || 250
    this.logger.log(`SerpAPI Key configured: ${this.serpApiKey ? 'Yes' : 'No'}`)
  }

  /**
   * 获取今天的日期字符串
   */
  private getTodayString(): string {
    return new Date().toISOString().split('T')[0]
  }

  /**
   * 检查是否超过每日限制
   */
  private checkDailyLimit(): boolean {
    const today = this.getTodayString()
    const count = this.searchCount.get(today) || 0
    return count < this.dailyLimit
  }

  /**
   * 增加搜索次数
   */
  private incrementSearchCount(): void {
    const today = this.getTodayString()
    const count = this.searchCount.get(today) || 0
    this.searchCount.set(today, count + 1)
    this.logger.log(`今日搜索次数: ${count + 1}/${this.dailyLimit}`)
  }

  /**
   * 获取搜索次数信息
   */
  getSearchCountInfo(): SearchCountInfo {
    const today = this.getTodayString()
    const current = this.searchCount.get(today) || 0
    return {
      current,
      remaining: Math.max(0, this.dailyLimit - current),
      limit: this.dailyLimit,
    }
  }

  /**
   * 通过图片URL搜索Facebook广告
   *
   * @param imageUrl 图片URL地址
   * @param filters 搜索过滤条件（可选）
   * @returns Facebook广告列表
   * @throws Error 当超过每日限制时
   */
  async searchAdsByImageUrl(imageUrl: string, filters?: SearchFilters): Promise<FacebookAd[]> {
    if (!this.checkDailyLimit()) {
      throw new Error('已达今天搜索上限')
    }

    // 默认过滤条件：正在投放 + 近1年
    const activeOnly = filters?.activeOnly !== false
    const daysRange = filters?.daysRange || 365

    this.logger.log(`开始图片URL搜索: ${imageUrl} (activeOnly: ${activeOnly}, daysRange: ${daysRange})`)
    this.incrementSearchCount()

    if (!this.serpApiKey) {
      this.logger.warn('SerpAPI未配置，返回模拟数据')
      return this.getMockResults({ activeOnly, daysRange })
    }

    try {
      // 1. 使用Google Lens搜索相似图片
      const lensResults = await this.searchWithSerpApiLensByUrl(imageUrl)

      // 2. 使用高级搜索指令搜索Shopify店铺 (collections/all页面)
      const shopifySearchQuery = `site:*/collections/all`
      const shopifyResults = await this.searchWithSerpApi(shopifySearchQuery)

      // 3. 合并结果
      const allResults = [...lensResults, ...shopifyResults]
      return this.extractFacebookAds(allResults, { activeOnly, daysRange })
    } catch (error: any) {
      this.logger.error(`图片URL搜索失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 通过关键词搜索Facebook广告
   *
   * @param keyword 搜索关键词
   * @param filters 搜索过滤条件（可选）
   * @returns Facebook广告列表
   * @throws Error 当超过每日限制时
   */
  async searchAdsByKeyword(keyword: string, filters?: SearchFilters): Promise<FacebookAd[]> {
    // 默认过滤条件：正在投放 + 近1年
    const activeOnly = filters?.activeOnly !== false // 默认true
    const daysRange = filters?.daysRange || 365 // 默认1年

    if (!this.checkDailyLimit()) {
      throw new Error('已达今天搜索上限')
    }

    this.logger.log(`开始关键词搜索: ${keyword} (activeOnly: ${activeOnly}, daysRange: ${daysRange})`)
    this.incrementSearchCount()

    if (!this.serpApiKey) {
      this.logger.warn('SerpAPI未配置，返回模拟数据')
      return this.getMockResults({ activeOnly, daysRange })
    }

    try {
      // 使用 Google 搜索相关品牌和店铺
      const searchQuery = `"${keyword}" online store shop`
      this.logger.log(`搜索查询: ${searchQuery}`)

      const results = await this.searchWithSerpApi(searchQuery)
      this.logger.log(`SerpAPI返回 ${results.length} 条结果`)

      // 构建直接指向 Facebook Ads Library 的搜索链接
      const ads = this.buildAdsLibraryLinks(results, keyword, { activeOnly, daysRange })
      this.logger.log(`构建了 ${ads.length} 个广告链接`)

      return ads
    } catch (error: any) {
      this.logger.error(`关键词搜索失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 构建指向 Facebook Ads Library 的搜索链接
   */
  private buildAdsLibraryLinks(items: any[], keyword: string, filters?: SearchFilters): FacebookAd[] {
    const ads: FacebookAd[] = []
    const seenNames = new Set<string>()

    const activeOnly = filters?.activeOnly !== false

    // 首先添加一个直接搜索关键词的链接
    const directSearchUrl = this.buildAdsLibraryUrl(keyword, activeOnly)
    ads.push({
      name: `"${keyword}" 相关广告`,
      url: directSearchUrl,
      description: `在 Facebook Ads Library 中搜索 "${keyword}" 的所有广告`,
    })
    seenNames.add(keyword.toLowerCase())

    // 从搜索结果中提取品牌/店铺名称，构建 Ads Library 搜索链接
    for (const item of items) {
      try {
        const link = item.link || item.url
        if (!link) continue

        // 提取品牌名称
        let brandName = this.extractBrandName(item, link)
        if (!brandName || seenNames.has(brandName.toLowerCase())) continue
        if (brandName.length < 2 || brandName.length > 50) continue

        seenNames.add(brandName.toLowerCase())

        const adsUrl = this.buildAdsLibraryUrl(brandName, activeOnly)
        ads.push({
          name: `${brandName} 广告`,
          url: adsUrl,
          description: item.snippet || `查看 ${brandName} 在 Facebook 上的广告`,
          imageUrl: item.thumbnail || item.pagemap?.cse_thumbnail?.[0]?.src,
        })

        if (ads.length >= 10) break
      } catch {
        // 忽略错误
      }
    }

    return ads
  }

  /**
   * 构建 Facebook Ads Library 搜索 URL
   */
  private buildAdsLibraryUrl(searchTerm: string, activeOnly: boolean): string {
    const encodedTerm = encodeURIComponent(searchTerm)
    const activeStatus = activeOnly ? 'active' : 'all'
    // Facebook Ads Library 搜索 URL 格式
    return `https://www.facebook.com/ads/library/?active_status=${activeStatus}&ad_type=all&country=ALL&q=${encodedTerm}&sort_data[direction]=desc&sort_data[mode]=relevancy_monthly_grouped&search_type=keyword_unordered`
  }

  /**
   * 从搜索结果中提取品牌名称
   */
  private extractBrandName(item: any, url: string): string | null {
    // 优先从标题提取
    if (item.title) {
      let name = item.title
        .replace(/\s*[-|]\s*(Official|Online|Store|Shop|Buy|Home).*$/i, '')
        .replace(/\s*[-|]\s*(Facebook|Instagram|Twitter).*$/i, '')
        .trim()

      // 清理常见的后缀
      name = name
        .replace(/\s*(Official Site|Official Store|Online Store)$/i, '')
        .trim()

      if (name.length >= 2 && name.length <= 50) {
        return name
      }
    }

    // 从域名提取
    try {
      const urlObj = new URL(url)
      let hostname = urlObj.hostname.replace(/^www\./, '')

      // 跳过大型平台
      const excludeDomains = ['google.com', 'youtube.com', 'facebook.com', 'instagram.com', 'amazon.com', 'ebay.com', 'aliexpress.com', 'wikipedia.org', 'reddit.com', 'twitter.com', 'pinterest.com']
      if (excludeDomains.some(d => hostname.includes(d))) {
        return null
      }

      // myshopify 域名提取店铺名
      const myshopifyMatch = hostname.match(/^([^.]+)\.myshopify\.com$/i)
      if (myshopifyMatch) {
        return myshopifyMatch[1]
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ')
      }

      // 移除 TLD
      const parts = hostname.split('.')
      if (parts.length > 0) {
        return parts[0]
          .replace(/-/g, ' ')
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ')
      }
    } catch {
      // 忽略错误
    }

    return null
  }

  /**
   * 使用SerpAPI进行Google Lens图片搜索（URL方式）
   */
  private async searchWithSerpApiLensByUrl(imageUrl: string): Promise<any[]> {
    const url = 'https://serpapi.com/search'
    const params: Record<string, string> = {
      engine: 'google_lens',
      url: imageUrl,
      api_key: this.serpApiKey!,
    }

    const response = await axios.get(url, {
      params,
      timeout: 30000,
    })

    return response.data.visual_matches || []
  }

  /**
   * 使用SerpAPI进行常规文本搜索
   */
  private async searchWithSerpApi(query: string): Promise<any[]> {
    const url = 'https://serpapi.com/search'
    const params: Record<string, string | number> = {
      engine: 'google',
      q: query,
      api_key: this.serpApiKey!,
      num: 20,
    }

    const response = await axios.get(url, {
      params,
      timeout: 30000,
    })

    return response.data.organic_results || []
  }

  /**
   * 从URL中提取主域名
   */
  private extractMainDomain(url: string): string {
    try {
      const urlObj = new URL(url)
      return urlObj.hostname.replace(/^www\./, '')
    } catch {
      return url
    }
  }

  /**
   * 从搜索结果中提取Facebook广告
   */
  private extractFacebookAds(items: any[], filters?: SearchFilters): FacebookAd[] {
    const ads: FacebookAd[] = []
    const seenUrls = new Set<string>()

    // 默认过滤条件
    const activeOnly = filters?.activeOnly !== false
    const daysRange = filters?.daysRange || 365

    this.logger.log(`开始处理 ${items.length} 条结果，过滤条件: activeOnly=${activeOnly}, daysRange=${daysRange}`)

    for (const item of items) {
      try {
        const link = item.link || item.url
        if (!link) {
          this.logger.debug(`跳过无链接的项目`)
          continue
        }

        const urlObj = new URL(link)
        const hostname = urlObj.hostname

        // 优先包含facebook.com的广告
        const isFacebookDomain = hostname.includes('facebook.com')
        this.logger.debug(`检查链接: ${hostname} - isFacebookDomain: ${isFacebookDomain}`)

        if (!isFacebookDomain && !this.isPotentialAd(link)) {
          this.logger.debug(`跳过非Facebook域名: ${hostname}`)
          continue
        }

        if (seenUrls.has(link)) {
          this.logger.debug(`跳过重复URL: ${link}`)
          continue
        }
        seenUrls.add(link)

        this.logger.log(`找到广告: ${item.title || 'Unknown'} - ${link}`)

        // 构建带筛选条件的URL
        let filteredUrl = link
        if (isFacebookDomain && link.includes('/ads/library')) {
          // 添加筛选参数
          const params = new URLSearchParams(urlObj.search)

          // 设置为正在投放的广告
          if (activeOnly) {
            params.set('active_status', 'active')
          }

          // 设置时间范围
          const endDate = new Date()
          const startDate = new Date()
          startDate.setDate(startDate.getDate() - daysRange)
          params.set('start_date', startDate.toISOString().split('T')[0])
          params.set('end_date', endDate.toISOString().split('T')[0])

          // 重建URL
          urlObj.search = params.toString()
          filteredUrl = urlObj.toString()
        }

        ads.push({
          name: this.extractAdName(item, link),
          url: filteredUrl,
          description: item.snippet || item.title || '',
          imageUrl: item.thumbnail || item.pagemap?.cse_thumbnail?.[0]?.src,
        })
      } catch {
        // 忽略无效URL
      }
    }

    return ads.slice(0, 20)
  }

  /**
   * 检查是否是潜在的广告链接
   */
  private isPotentialAd(url: string): boolean {
    const excludePatterns = [
      /google\./i, /youtube\./i, /amazon\./i, /ebay\./i,
      /aliexpress\./i, /wikipedia\./i, /reddit\./i,
    ]

    return !excludePatterns.some(pattern => pattern.test(url))
  }

  /**
   * 从搜索结果提取广告名称
   */
  private extractAdName(item: any, url: string): string {
    if (item.title) {
      let name = item.title
        .replace(/\s*[-|]\s*Facebook.*$/i, '')
        .replace(/\s*[-|]\s*Ads Library.*$/i, '')
        .replace(/\s*[-|]\s*Official.*$/i, '')
        .trim()
      if (name.length > 3 && name.length < 100) {
        return name
      }
    }

    // 从URL提取名称
    try {
      const urlObj = new URL(url)
      const pathParts = urlObj.pathname.split('/').filter(Boolean)
      if (pathParts.length > 0) {
        return decodeURIComponent(pathParts[pathParts.length - 1])
          .replace(/-/g, ' ')
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ')
      }
    } catch {
      // 忽略错误
    }

    return 'Facebook Ad'
  }

  /**
   * 将搜索结果格式化为笔记内容
   */
  formatResultsAsNoteContent(
    ads: FacebookAd[],
    searchType: string = '图片',
    imageUrl?: string,
    keyword?: string,
    searchCountInfo?: SearchCountInfo,
    filters?: SearchFilters
  ): string {
    let content = `<h2>Facebook Ads 搜索结果</h2>`

    if (imageUrl) {
      content += `<p>搜索图片：<a href="${imageUrl}" target="_blank" style="color: #0088CC; font-weight: 600;">${imageUrl}</a></p>`
    }

    if (keyword) {
      content += `<p>搜索产品：<span style="color: #0088CC; font-weight: 600;">${keyword}</span></p>`
    }

    // 显示筛选条件
    const activeOnly = filters?.activeOnly !== false
    const daysRange = filters?.daysRange || 365
    content += `<p>筛选条件：<span style="color: #0088CC; font-weight: 600;">${activeOnly ? '正在投放的广告' : '所有广告'} | 近${daysRange}天</span></p>`

    content += `<p>共找到 ${ads.length} 个相关广告：</p>`

    for (let i = 0; i < ads.length; i++) {
      const ad = ads[i]
      const mainDomain = this.extractMainDomain(ad.url)
      content += `<p><strong>${i + 1}. ${ad.name}</strong></p>`
      content += `<p>广告链接：<a href="${ad.url}" target="_blank" style="color: #0088CC; font-weight: 600;">${mainDomain}</a></p>`
    }

    content += `<hr><p><em>搜索时间: ${new Date().toLocaleString('zh-CN')}</em></p>`

    if (searchCountInfo) {
      content += `<p><em>今日搜索次数：第${searchCountInfo.current}次，剩余${searchCountInfo.remaining}次</em></p>`
    }

    return content
  }

  /**
   * 生成笔记标题
   */
  generateNoteTitle(searchType?: string, keyword?: string): string {
    const dateTime = `${new Date().toLocaleDateString('zh-CN')} ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`

    if (searchType === '关键词' && keyword) {
      return `Facebook Ads产品：${keyword}-${dateTime}`
    }

    return `Facebook Ads图片搜索-${dateTime}`
  }

  /**
   * 获取模拟结果（用于开发和测试）
   */
  private getMockResults(filters?: SearchFilters): FacebookAd[] {
    const activeOnly = filters?.activeOnly !== false
    const daysRange = filters?.daysRange || 365

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysRange)

    const baseParams = `active_status=${activeOnly ? 'active' : 'all'}&start_date=${startDate.toISOString().split('T')[0]}&end_date=${endDate.toISOString().split('T')[0]}`

    return [
      { name: 'Fashion Brand Ad', url: `https://www.facebook.com/ads/library/?q=fashion&${baseParams}`, description: '时尚品牌广告 - 正在投放' },
      { name: 'Electronics Store Ad', url: `https://www.facebook.com/ads/library/?q=electronics&${baseParams}`, description: '电子产品店铺广告 - 正在投放' },
      { name: 'Home Decor Ad', url: `https://www.facebook.com/ads/library/?q=decor&${baseParams}`, description: '家居装饰广告 - 正在投放' },
    ]
  }
}
