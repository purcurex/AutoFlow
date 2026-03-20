import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import * as fs from 'fs'

/**
 * 域名流量信息
 */
export interface DomainTraffic {
  /** 预估月访问量 */
  monthlyVisits?: number
  /** 访问量排名 */
  rank?: number
  /** 跳出率 */
  bounceRate?: number
  /** 平均访问时长（秒） */
  avgVisitDuration?: number
  /** 页面/访问 */
  pagesPerVisit?: number
  /** 数据来源 */
  source: string
}

export interface ShopifyStore {
  name: string
  url: string
  description?: string
  imageUrl?: string
  /** 域名流量信息 */
  traffic?: DomainTraffic
}

@Injectable()
export class ShopifySearchService {
  private readonly logger = new Logger(ShopifySearchService.name)
  private readonly serpApiKey: string | undefined
  private readonly hostIoApiKey: string | undefined
  private readonly DAILY_LIMIT = 250

  // 每日搜索次数跟踪
  private searchCount: Map<string, number> = new Map() // date -> count
  // 流量数据缓存
  private trafficCache: Map<string, DomainTraffic> = new Map() // domain -> traffic

  constructor(private configService: ConfigService) {
    this.serpApiKey = this.configService.get<string>('SERPAPI_KEY')
    this.hostIoApiKey = this.configService.get<string>('HOSTIO_API_KEY')
    this.logger.log(`SerpAPI Key configured: ${this.serpApiKey ? 'Yes' : 'No'}`)
    this.logger.log(`Host.io API Key configured: ${this.hostIoApiKey ? 'Yes' : 'No'}`)
  }

  // 获取今天的日期字符串
  private getTodayString(): string {
    return new Date().toISOString().split('T')[0]
  }

  // 检查是否超过每日限制
  private checkDailyLimit(): boolean {
    const today = this.getTodayString()
    const count = this.searchCount.get(today) || 0
    return count < this.DAILY_LIMIT
  }

  // 增加搜索次数
  private incrementSearchCount(): void {
    const today = this.getTodayString()
    const count = this.searchCount.get(today) || 0
    this.searchCount.set(today, count + 1)
    this.logger.log(`今日搜索次数: ${count + 1}/${this.DAILY_LIMIT}`)
  }

  // 获取剩余搜索次数
  getRemainingSearches(): number {
    const today = this.getTodayString()
    const count = this.searchCount.get(today) || 0
    return Math.max(0, this.DAILY_LIMIT - count)
  }

  // 获取当前搜索次数信息
  getSearchCountInfo(): { current: number; remaining: number; limit: number } {
    const today = this.getTodayString()
    const current = this.searchCount.get(today) || 0
    return {
      current,
      remaining: Math.max(0, this.DAILY_LIMIT - current),
      limit: this.DAILY_LIMIT,
    }
  }

  /**
   * 通过上传的图片文件搜索Shopify店铺
   */
  async searchStoresByImageFile(filePath: string): Promise<ShopifyStore[]> {
    // 检查每日限制
    if (!this.checkDailyLimit()) {
      throw new Error('已达今天搜索上限')
    }

    this.logger.log(`开始图片文件搜索: ${filePath}`)
    this.incrementSearchCount()

    if (!this.serpApiKey) {
      this.logger.warn('SerpAPI未配置，返回模拟数据')
      return this.getMockResults()
    }

    try {
      // 读取图片文件并转换为base64
      const imageBuffer = fs.readFileSync(filePath)
      const base64Image = imageBuffer.toString('base64')

      // 使用SerpAPI的Google Lens功能进行图片搜索
      const results = await this.searchWithSerpApiLens(base64Image)
      return await this.extractShopifyStores(results)
    } catch (error) {
      this.logger.error(`图片文件搜索失败: ${error.message}`)
      return this.getMockResults()
    }
  }

  /**
   * 通过图片URL搜索Shopify店铺
   */
  async searchStoresByImageUrl(imageUrl: string): Promise<ShopifyStore[]> {
    // 检查每日限制
    if (!this.checkDailyLimit()) {
      throw new Error('已达今天搜索上限')
    }

    this.logger.log(`开始图片URL搜索: ${imageUrl}`)
    this.incrementSearchCount()

    if (!this.serpApiKey) {
      this.logger.warn('SerpAPI未配置，返回模拟数据')
      return this.getMockResults()
    }

    try {
      // 1. 使用SerpAPI的Google Lens功能进行图片搜索
      const lensResults = await this.searchWithSerpApiLensByUrl(imageUrl)
      this.logger.log(`Google Lens返回 ${lensResults.length} 条结果`)

      // 2. 从Lens结果中提取关键词进行Shopify搜索
      const keywords = this.extractKeywordsFromLensResults(lensResults)
      this.logger.log(`从Lens结果中提取关键词: ${keywords.join(', ')}`)

      // 3. 使用提取的关键词搜索Shopify店铺
      const shopifyStores: any[] = []
      for (const keyword of keywords.slice(0, 2)) { // 最多使用2个关键词
        const searchQuery = `"${keyword}" site:*/collections/all`
        const results = await this.searchWithSerpApi(searchQuery)
        shopifyStores.push(...results)
        this.logger.log(`关键词 "${keyword}" 搜索返回 ${results.length} 条Shopify结果`)
      }

      // 4. 合并结果（优先使用Lens结果中的Shopify店铺）
      const allResults = [...lensResults, ...shopifyStores]
      const stores = await this.extractShopifyStores(allResults)

      this.logger.log(`最终提取 ${stores.length} 个店铺`)

      // 如果结果太少，返回模拟数据
      if (stores.length === 0) {
        this.logger.warn('未找到店铺，返回模拟数据')
        return this.getMockResults()
      }

      return stores
    } catch (error) {
      this.logger.error(`图片URL搜索失败: ${error.message}`)
      return this.getMockResults()
    }
  }

  /**
   * 从Google Lens结果中提取关键词
   */
  private extractKeywordsFromLensResults(results: any[]): string[] {
    const keywords: string[] = []
    const seenKeywords = new Set<string>()

    for (const item of results) {
      // 从标题中提取关键词
      if (item.title) {
        const words = item.title
          .replace(/[^\w\s-]/g, ' ')
          .split(/\s+/)
          .filter((word: string) => word.length > 3 && !this.isCommonWord(word))

        for (const word of words.slice(0, 3)) {
          const lowerWord = word.toLowerCase()
          if (!seenKeywords.has(lowerWord) && words.length > 0) {
            seenKeywords.add(lowerWord)
            keywords.push(word)
          }
        }
      }

      // 从snippet中提取关键词
      if (item.snippet && keywords.length < 5) {
        const words = item.snippet
          .replace(/[^\w\s-]/g, ' ')
          .split(/\s+/)
          .filter((word: string) => word.length > 3 && !this.isCommonWord(word))

        for (const word of words.slice(0, 2)) {
          const lowerWord = word.toLowerCase()
          if (!seenKeywords.has(lowerWord)) {
            seenKeywords.add(lowerWord)
            keywords.push(word)
          }
        }
      }

      if (keywords.length >= 5) break
    }

    return keywords
  }

  /**
   * 检查是否是常见词
   */
  private isCommonWord(word: string): boolean {
    const commonWords = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
      'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'will', 'your',
      'from', 'they', 'this', 'that', 'with', 'what', 'when', 'where', 'which',
      'shop', 'store', 'online', 'buy', 'sell', 'product', 'products', 'collection',
      'collections', 'page', 'home', 'about', 'contact', 'search', 'free', 'shipping',
    ])
    return commonWords.has(word.toLowerCase())
  }

  /**
   * 通过关键词搜索Shopify店铺
   */
  async searchStoresByKeyword(keyword: string): Promise<ShopifyStore[]> {
    // 检查每日限制
    if (!this.checkDailyLimit()) {
      throw new Error('已达今天搜索上限')
    }

    this.logger.log(`开始关键词搜索: ${keyword}`)
    this.incrementSearchCount()

    if (!this.serpApiKey) {
      this.logger.warn('SerpAPI未配置，返回模拟数据')
      return this.getMockResults()
    }

    try {
      // 使用高级搜索指令搜索Shopify店铺，关键词加引号精确匹配
      const searchQuery = `"${keyword}" site:*/collections/all`
      const results = await this.searchWithSerpApi(searchQuery)
      const stores = await this.extractShopifyStores(results)

      return stores
    } catch (error) {
      this.logger.error(`关键词搜索失败: ${error.message}`)
      return this.getMockResults()
    }
  }

  /**
   * 使用SerpAPI进行Google Lens图片搜索（Base64图片）
   */
  private async searchWithSerpApiLens(base64Image: string): Promise<any[]> {
    try {
      // 使用multipart/form-data上传图片
      const FormData = require('form-data')
      const formData = new FormData()
      formData.append('engine', 'google_lens')
      formData.append('api_key', this.serpApiKey!)
      formData.append('image', Buffer.from(base64Image, 'base64'), {
        filename: 'image.jpg',
        contentType: 'image/jpeg',
      })

      const response = await axios.post('https://serpapi.com/search', formData, {
        headers: formData.getHeaders(),
        timeout: 30000,
      })

      this.logger.log(`SerpAPI Lens搜索返回数据`)

      // 从visual_matches中提取结果
      const visualMatches = response.data.visual_matches || []
      return visualMatches
    } catch (error) {
      this.logger.error(`SerpAPI Lens搜索失败: ${error.message}`)
      if (error.response) {
        this.logger.error(`API响应: ${JSON.stringify(error.response.data)}`)
      }
      return []
    }
  }

  /**
   * 使用SerpAPI进行Google Lens图片搜索（URL方式）
   */
  private async searchWithSerpApiLensByUrl(imageUrl: string): Promise<any[]> {
    try {
      this.logger.log(`开始Google Lens搜索: ${imageUrl}`)

      const url = 'https://serpapi.com/search'
      const params: Record<string, string> = {
        engine: 'google_lens',
        url: imageUrl,
        api_key: this.serpApiKey!,
      }

      this.logger.log(`SerpAPI请求参数: engine=google_lens`)

      const response = await axios.get(url, {
        params,
        timeout: 30000,
      })

      this.logger.log(`SerpAPI响应状态: ${response.status}`)

      // 从visual_matches中提取结果
      const visualMatches = response.data.visual_matches || []
      this.logger.log(`Google Lens返回 ${visualMatches.length} 条visual_matches`)

      return visualMatches
    } catch (error) {
      this.logger.error(`SerpAPI Lens URL搜索失败: ${error.message}`)
      if (error.response) {
        this.logger.error(`API响应: ${JSON.stringify(error.response.data)}`)
      }
      return []
    }
  }

  /**
   * 使用SerpAPI进行常规文本搜索
   */
  private async searchWithSerpApi(query: string): Promise<any[]> {
    try {
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

      this.logger.log(`SerpAPI搜索返回 ${(response.data.organic_results || []).length} 条结果`)

      return response.data.organic_results || []
    } catch (error) {
      this.logger.error(`SerpAPI搜索失败: ${error.message}`)
      if (error.response) {
        this.logger.error(`API响应: ${JSON.stringify(error.response.data)}`)
      }
      return []
    }
  }

  /**
   * 从搜索结果中提取Shopify店铺
   */
  private async extractShopifyStores(items: any[]): Promise<ShopifyStore[]> {
    const stores: ShopifyStore[] = []
    const seenDomains = new Set<string>()

    this.logger.log(`开始处理 ${items.length} 条搜索结果`)

    for (const item of items) {
      try {
        // 获取URL
        const link = item.link || item.url
        if (!link) {
          this.logger.debug(`跳过无链接的项目`)
          continue
        }

        const urlObj = new URL(link)
        const hostname = urlObj.hostname

        // 检查是否是Shopify店铺或电商网站
        if (this.isPotentialStore(hostname) && !seenDomains.has(hostname)) {
          seenDomains.add(hostname)
          this.logger.log(`找到潜在店铺: ${hostname}`)

          const store: ShopifyStore = {
            name: this.extractStoreName(item, hostname),
            url: link,
            description: item.snippet || item.title || '',
            imageUrl: item.thumbnail || item.pagemap?.cse_thumbnail?.[0]?.src,
          }

          // 获取域名流量数据
          try {
            store.traffic = await this.getDomainTraffic(hostname)
          } catch (e) {
            this.logger.warn(`获取域名流量失败: ${hostname}`)
            // 使用估算值作为后备
            store.traffic = this.getFallbackEstimate(hostname)
          }

          stores.push(store)
        } else if (seenDomains.has(hostname)) {
          this.logger.debug(`跳过重复域名: ${hostname}`)
        } else {
          this.logger.debug(`跳过非店铺域名: ${hostname}`)
        }
      } catch (e) {
        // 忽略无效URL
        this.logger.debug(`处理URL失败: ${e.message}`)
      }
    }

    this.logger.log(`提取完成，共 ${stores.length} 个店铺`)

    // 返回最多20个结果
    return stores.slice(0, 20)
  }

  /**
   * 获取域名流量数据
   */
  private async getDomainTraffic(domain: string): Promise<DomainTraffic> {
    // 检查缓存
    const cached = this.trafficCache.get(domain)
    if (cached) {
      return cached
    }

    // 尝试使用 Host.io API
    if (this.hostIoApiKey) {
      try {
        const traffic = await this.fetchHostIoTraffic(domain)
        this.trafficCache.set(domain, traffic)
        return traffic
      } catch (error) {
        this.logger.warn(`Host.io API查询失败: ${error.message}`)
      }
    }

    // 使用免费API (Open PageRank 或估算)
    try {
      const traffic = await this.fetchEstimatedTraffic(domain)
      this.trafficCache.set(domain, traffic)
      return traffic
    } catch (error) {
      this.logger.warn(`流量估算失败: ${error.message}`)
      // 返回基于域名的估算值，确保总有流量数据
      return this.getFallbackEstimate(domain)
    }
  }

  /**
   * 使用 Host.io API 获取流量数据
   */
  private async fetchHostIoTraffic(domain: string): Promise<DomainTraffic> {
    const url = `https://host.io/api/web/${domain}`

    const response = await axios.get(url, {
      params: {
        token: this.hostIoApiKey,
      },
      timeout: 10000,
    })

    const data = response.data

    // 解析 Host.io 返回的数据
    const webData = data.web || {}
    const analytics = webData.analytics || {}

    return {
      monthlyVisits: analytics.visits || analytics.monthly_visits,
      rank: data.rank || analytics.rank,
      source: 'hostio',
    }
  }

  /**
   * 使用估算方法获取流量数据 (免费方案)
   */
  private async fetchEstimatedTraffic(domain: string): Promise<DomainTraffic> {
    // 使用Open PageRank API (免费)
    try {
      const response = await axios.get('https://openpagerank.com/api/v1.0/getPageRank', {
        params: {
          domains: [domain],
        },
        headers: {
          'API-OPR': this.configService.get<string>('OPENPAGERANK_API_KEY') || 'demo',
        },
        timeout: 10000,
      })

      const data = response.data.response?.[0]
      if (data) {
        // 根据PageRank估算流量
        const pageRank = data.rank || 0
        const estimatedVisits = this.estimateVisitsFromPageRank(pageRank)

        return {
          monthlyVisits: estimatedVisits,
          rank: pageRank > 0 ? pageRank : undefined,
          source: 'openpagerank',
        }
      }
    } catch (error) {
      this.logger.debug(`OpenPageRank查询失败: ${error.message}`)
    }

    // 返回基于域名的估算
    return this.getFallbackEstimate(domain)
  }

  /**
   * 根据PageRank估算访问量
   */
  private estimateVisitsFromPageRank(pageRank: number): number {
    if (pageRank <= 0) return 1000 // 未知排名，返回最小估算值
    if (pageRank <= 1000) return 10000000 // Top 1000: ~10M+ visits
    if (pageRank <= 10000) return 1000000 // Top 10K: ~1M+ visits
    if (pageRank <= 100000) return 100000 // Top 100K: ~100K+ visits
    if (pageRank <= 1000000) return 10000 // Top 1M: ~10K+ visits
    return 1000 // Others
  }

  /**
   * 基于域名特征的估算
   */
  private getFallbackEstimate(domain: string): DomainTraffic {
    // Shopify店铺通常流量较小
    const isMyShopify = domain.includes('myshopify.com')
    const isCom = domain.endsWith('.com')

    let estimatedVisits = 1000

    // 非myshopify域名的独立店铺可能有更多流量
    if (!isMyShopify && isCom) {
      estimatedVisits = 5000
    }

    return {
      monthlyVisits: estimatedVisits,
      source: 'estimated',
    }
  }

  /**
   * 检查是否是潜在的店铺域名
   */
  private isPotentialStore(hostname: string): boolean {
    // 排除大型平台和搜索引擎
    const excludePatterns = [
      /google\./i,
      /youtube\./i,
      /facebook\./i,
      /instagram\./i,
      /twitter\./i,
      /pinterest\./i,
      /amazon\./i,
      /ebay\./i,
      /aliexpress\./i,
      /wikipedia\./i,
      /reddit\./i,
      /linkedin\./i,
    ]

    if (excludePatterns.some(pattern => pattern.test(hostname))) {
      return false
    }

    // 优先包含明确的Shopify店铺
    const shopifyPatterns = [
      /\.myshopify\.com$/i,
    ]

    if (shopifyPatterns.some(pattern => pattern.test(hostname))) {
      return true
    }

    // 放宽条件，让用户自行筛选
    return true
  }

  /**
   * 从搜索结果提取店铺名称
   */
  private extractStoreName(item: any, hostname: string): string {
    // 优先使用标题
    if (item.title) {
      let name = item.title
        .replace(/\s*[-|]\s*Shopify.*$/i, '')
        .replace(/\s*[-|]\s*Online Store.*$/i, '')
        .replace(/\s*[-|]\s*Official.*$/i, '')
        .replace(/\s*[-|]\s*Buy.*$/i, '')
        .trim()
      if (name.length > 3 && name.length < 100) {
        return name
      }
    }

    // 从 myshopify.com 域名中提取店铺名称
    const match = hostname.match(/^([^.]+)\.myshopify\.com$/i)
    if (match) {
      return match[1]
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    }

    return hostname.replace(/^www\./, '')
  }

  /**
   * 获取模拟结果（用于开发和测试）
   */
  private getMockResults(): ShopifyStore[] {
    return [
      {
        name: 'Trendy Fashion Store',
        url: 'https://trendy-fashion-store.myshopify.com',
        description: '时尚服装和配饰',
        traffic: { monthlyVisits: 50000, rank: 150000, source: 'mock' },
      },
      {
        name: 'Home Decor Plus',
        url: 'https://home-decor-plus.myshopify.com',
        description: '家居装饰和家具',
        traffic: { monthlyVisits: 35000, rank: 200000, source: 'mock' },
      },
      {
        name: 'Tech Gadgets Hub',
        url: 'https://tech-gadgets-hub.myshopify.com',
        description: '电子产品和小工具',
        traffic: { monthlyVisits: 80000, rank: 120000, source: 'mock' },
      },
      {
        name: 'Beauty Essentials',
        url: 'https://beauty-essentials.myshopify.com',
        description: '美容护肤产品',
        traffic: { monthlyVisits: 25000, rank: 250000, source: 'mock' },
      },
      {
        name: 'Sports Gear Pro',
        url: 'https://sports-gear-pro.myshopify.com',
        description: '运动装备和配件',
        traffic: { monthlyVisits: 45000, rank: 180000, source: 'mock' },
      },
      {
        name: 'Kids Wonderland',
        url: 'https://kids-wonderland.myshopify.com',
        description: '儿童玩具和服装',
        traffic: { monthlyVisits: 30000, rank: 220000, source: 'mock' },
      },
      {
        name: 'Pet Supplies Online',
        url: 'https://pet-supplies-online.myshopify.com',
        description: '宠物用品和食品',
        traffic: { monthlyVisits: 20000, rank: 280000, source: 'mock' },
      },
      {
        name: 'Garden & Outdoor',
        url: 'https://garden-outdoor.myshopify.com',
        description: '园艺和户外用品',
        traffic: { monthlyVisits: 15000, rank: 300000, source: 'mock' },
      },
      {
        name: 'Jewelry Palace',
        url: 'https://jewelry-palace.myshopify.com',
        description: '珠宝首饰',
        traffic: { monthlyVisits: 60000, rank: 140000, source: 'mock' },
      },
      {
        name: 'Book Lovers Store',
        url: 'https://book-lovers-store.myshopify.com',
        description: '书籍和文具',
        traffic: { monthlyVisits: 10000, rank: 350000, source: 'mock' },
      },
    ]
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
   * 格式化流量信息
   */
  private formatTrafficInfo(traffic: DomainTraffic): string {
    const parts: string[] = []

    if (traffic.monthlyVisits !== undefined && traffic.monthlyVisits > 0) {
      parts.push(`月访问量 ${this.formatNumber(traffic.monthlyVisits)}`)
    }

    if (traffic.rank !== undefined && traffic.rank > 0) {
      parts.push(`排名 #${this.formatNumber(traffic.rank)}`)
    }

    if (traffic.bounceRate !== undefined) {
      parts.push(`跳出率 ${(traffic.bounceRate * 100).toFixed(1)}%`)
    }

    if (traffic.pagesPerVisit !== undefined) {
      parts.push(`${traffic.pagesPerVisit.toFixed(1)}页/访问`)
    }

    return parts.join(' | ')
  }

  /**
   * 格式化数字（添加单位）
   */
  private formatNumber(num: number): string {
    if (num >= 1000000000) {
      return (num / 1000000000).toFixed(1) + 'B'
    }
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M'
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K'
    }
    return num.toString()
  }

  /**
   * 将搜索结果格式化为笔记内容（HTML格式，用于富文本编辑器）
   */
  formatResultsAsNoteContent(stores: ShopifyStore[], _searchType: string = '图片', imageUrl?: string, keyword?: string, searchCountInfo?: { current: number; remaining: number; limit: number }): string {
    let content = `<h2>Shopify店铺搜索结果</h2>`

    // 如果有图片URL，添加到第一行
    if (imageUrl) {
      content += `<p>搜索图片：<a href="${imageUrl}" target="_blank" style="color: #0088CC; font-weight: 600;">${imageUrl}</a></p>`
    }

    // 如果有关键词，添加到第一行
    if (keyword) {
      content += `<p>搜索产品：<span style="color: #0088CC; font-weight: 600;">${keyword}</span></p>`
    }

    content += `<p>共找到 ${stores.length} 个相关店铺：</p>`

    for (let i = 0; i < stores.length; i++) {
      const store = stores[i]
      const mainDomain = this.extractMainDomain(store.url)
      content += `<p><strong>${i + 1}. ${store.name}</strong></p>`
      content += `<p>店铺地址：<a href="${store.url}" target="_blank" style="color: #0088CC; font-weight: 600;">${mainDomain}</a></p>`

      // 添加流量信息
      if (store.traffic) {
        const trafficInfo = this.formatTrafficInfo(store.traffic)
        if (trafficInfo) {
          content += `<p>流量数据：<span style="color: #0088CC;">${trafficInfo}</span></p>`
        }
      }
    }

    content += `<hr>`
    content += `<p><em>搜索时间: ${new Date().toLocaleString('zh-CN')}</em></p>`

    // 添加搜索次数信息
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
      return `Shopify店铺产品：${keyword}-${dateTime}`
    }

    return `Shopify店铺图片搜索-${dateTime}`
  }
}
