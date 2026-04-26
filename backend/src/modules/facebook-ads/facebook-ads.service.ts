import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'

export interface FacebookAd {
  name: string
  url: string
  description?: string
  imageUrl?: string
}

export interface SearchFilters {
  activeOnly?: boolean
  daysRange?: number
}

export interface SearchCountInfo {
  current: number
  remaining: number
  limit: number
}

@Injectable()
export class FacebookAdsService {
  private readonly logger = new Logger(FacebookAdsService.name)
  private readonly dailyLimit: number
  private readonly searchCount = new Map<string, number>()

  constructor(private readonly configService: ConfigService) {
    this.dailyLimit = this.configService.get<number>('DAILY_SEARCH_LIMIT', 250)
  }

  getSearchCountInfo(): SearchCountInfo {
    const today = this.getTodayString()
    const current = this.searchCount.get(today) || 0
    return {
      current,
      remaining: Math.max(0, this.dailyLimit - current),
      limit: this.dailyLimit,
    }
  }

  async searchAdsByImageUrl(imageUrl: string, filters?: SearchFilters): Promise<FacebookAd[]> {
    this.assertSearchAllowed()
    this.incrementSearchCount()

    if (!this.getSerpApiKey()) {
      return this.fallbackToMockResults('SERPAPI_KEY is not configured', filters)
    }

    return this.searchAdsByQuery(`"${imageUrl}" "Facebook Ads Library"`, filters)
  }

  async searchAdsByKeyword(keyword: string, filters?: SearchFilters): Promise<FacebookAd[]> {
    this.assertSearchAllowed()
    this.incrementSearchCount()

    if (!this.getSerpApiKey()) {
      return this.fallbackToMockResults('SERPAPI_KEY is not configured', filters)
    }

    return this.searchAdsByQuery(`"${keyword}" online store shop`, filters)
  }

  formatResultsAsNoteContent(
    ads: FacebookAd[],
    _searchType: string = 'search',
    imageUrl?: string,
    keyword?: string,
    searchCountInfo?: SearchCountInfo,
    filters?: SearchFilters,
  ): string {
    const source = imageUrl || keyword || 'AutoFlow search'
    const activeStatus = filters?.activeOnly === false ? 'all ads' : 'active ads'
    const rows = ads
      .map((ad, index) => `<p><strong>${index + 1}. ${this.escapeHtml(ad.name)}</strong></p><p><a href="${this.escapeHtml(ad.url)}" target="_blank">${this.escapeHtml(ad.url)}</a></p><p>${this.escapeHtml(ad.description || '')}</p>`)
      .join('')
    const quota = searchCountInfo
      ? `<p><em>Search usage: ${searchCountInfo.current}/${searchCountInfo.limit}, remaining ${searchCountInfo.remaining}</em></p>`
      : ''
    return `<h2>Facebook Ads search results</h2><p>Source: ${this.escapeHtml(source)}</p><p>Filter: ${activeStatus}</p><p>Total ads: ${ads.length}</p>${rows}<hr>${quota}`
  }

  generateNoteTitle(searchType?: string, keyword?: string): string {
    const dateTime = new Date().toLocaleString('zh-CN')
    if (keyword) {
      return `Facebook Ads leads - ${keyword} - ${dateTime}`
    }
    return `Facebook Ads leads - ${searchType || 'search'} - ${dateTime}`
  }

  private async searchAdsByQuery(query: string, filters?: SearchFilters): Promise<FacebookAd[]> {
    try {
      const response = await axios.get('https://serpapi.com/search', {
        params: {
          engine: 'google',
          q: query,
          api_key: this.getSerpApiKey(),
          num: 20,
        },
        timeout: 30000,
      })

      const results = response.data?.organic_results || []
      const ads = this.buildAdsLibraryLinks(results, query, filters)
      if (ads.length === 0) {
        return this.fallbackToMockResults('No ad leads were found', filters)
      }
      return ads
    } catch (error: any) {
      this.logger.error(`Facebook Ads search failed: ${error.message}`)
      return this.fallbackToMockResults('Facebook Ads search provider failed', filters)
    }
  }

  private buildAdsLibraryLinks(items: any[], keyword: string, filters?: SearchFilters): FacebookAd[] {
    const ads: FacebookAd[] = []
    const seenNames = new Set<string>()
    const activeOnly = filters?.activeOnly !== false

    ads.push({
      name: `"${keyword}" related ads`,
      url: this.buildAdsLibraryUrl(keyword, activeOnly),
      description: `Search Facebook Ads Library for ${keyword}`,
    })

    for (const item of items) {
      const link = item.link || item.url
      const brandName = this.extractBrandName(item, link)
      if (!brandName || seenNames.has(brandName.toLowerCase())) continue

      seenNames.add(brandName.toLowerCase())
      ads.push({
        name: `${brandName} ads`,
        url: this.buildAdsLibraryUrl(brandName, activeOnly),
        description: item.snippet || `View ${brandName} ads in Facebook Ads Library`,
        imageUrl: item.thumbnail,
      })

      if (ads.length >= 20) break
    }

    return ads
  }

  private buildAdsLibraryUrl(searchTerm: string, activeOnly: boolean): string {
    const encodedTerm = encodeURIComponent(searchTerm)
    const activeStatus = activeOnly ? 'active' : 'all'
    return `https://www.facebook.com/ads/library/?active_status=${activeStatus}&ad_type=all&country=ALL&q=${encodedTerm}&search_type=keyword_unordered`
  }

  private extractBrandName(item: any, url?: string): string | null {
    if (item?.title) {
      const title = String(item.title)
        .replace(/\s*[-|]\s*(Official|Online|Store|Shop|Buy|Home|Facebook|Instagram).*$/i, '')
        .trim()
      if (title.length >= 2 && title.length <= 50) return title
    }

    if (!url) return null
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '')
      const excluded = ['google.', 'youtube.', 'facebook.', 'instagram.', 'amazon.', 'reddit.']
      if (excluded.some((domain) => hostname.includes(domain))) return null
      return hostname.split('.')[0].replace(/-/g, ' ')
    } catch {
      return null
    }
  }

  private assertSearchAllowed(): void {
    const info = this.getSearchCountInfo()
    if (info.current >= info.limit) {
      throw new Error('Daily search limit reached')
    }
  }

  private incrementSearchCount(): void {
    const today = this.getTodayString()
    const current = this.searchCount.get(today) || 0
    this.searchCount.set(today, current + 1)
  }

  private getTodayString(): string {
    return new Date().toISOString().split('T')[0]
  }

  private getSerpApiKey(): string | undefined {
    return this.configService.get<string>('SERPAPI_KEY')
  }

  private shouldUseMockResults(): boolean {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development')
    const enableMockSearch = this.configService.get<string>('ENABLE_MOCK_SEARCH', 'false')
    return nodeEnv !== 'production' || enableMockSearch === 'true'
  }

  private fallbackToMockResults(reason: string, filters?: SearchFilters): FacebookAd[] {
    if (this.shouldUseMockResults()) {
      this.logger.warn(`${reason}; returning mock Facebook Ads results for local development.`)
      return this.getMockResults(filters)
    }

    throw new ServiceUnavailableException(`${reason}; configure SERPAPI_KEY or retry later.`)
  }

  private getMockResults(filters?: SearchFilters): FacebookAd[] {
    const activeOnly = filters?.activeOnly !== false
    const baseParams = `active_status=${activeOnly ? 'active' : 'all'}`
    return [
      {
        name: 'Pet Grooming Brush Ads',
        url: `https://www.facebook.com/ads/library/?q=pet%20grooming%20brush&${baseParams}`,
        description: 'Mock lead for pet product campaigns',
      },
      {
        name: 'Portable Blender Ads',
        url: `https://www.facebook.com/ads/library/?q=portable%20blender&${baseParams}`,
        description: 'Mock lead for kitchen gadget campaigns',
      },
      {
        name: 'Home Decor Store Ads',
        url: `https://www.facebook.com/ads/library/?q=home%20decor&${baseParams}`,
        description: 'Mock lead for home decor campaigns',
      },
    ]
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }
}
