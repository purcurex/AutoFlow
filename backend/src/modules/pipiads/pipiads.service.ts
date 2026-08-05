import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import type { PipiAdsDiscoveryInput, PipiAdsEvidence } from './pipiads.types'

interface PipiAdsEnvelope<T> {
  code?: number
  message?: string
  data?: T
  success?: boolean
  fail?: boolean
  remaining_credits?: number
  consumed_credits?: number
}

interface PipiAdsListPayload {
  data?: Array<Record<string, unknown>>
  page?: Record<string, unknown>
}

@Injectable()
export class PipiAdsService {
  private readonly logger = new Logger(PipiAdsService.name)
  private readonly inFlight = new Map<string, Promise<PipiAdsEvidence[]>>()

  constructor(private readonly configService: ConfigService) {}

  discover(input: PipiAdsDiscoveryInput): Promise<PipiAdsEvidence[]> {
    const key = `${input.type}|${input.value}|${input.targetMarket}`
    const existing = this.inFlight.get(key)
    if (existing) return existing

    const request = this.discoverUncached(input).finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, request)
    return request
  }

  private async discoverUncached(input: PipiAdsDiscoveryInput): Promise<PipiAdsEvidence[]> {
    if (!this.apiKey()) return this.fallback('PIPIADS_API_KEY is not configured', input)

    try {
      const rows = input.type === 'image'
        ? await this.searchByImage(input.value)
        : await this.searchByKeyword(input.value, input.targetMarket)
      const details = await this.mapWithConcurrency(rows, 5, (row) => this.getAdDetail(row))
      return rows.map((row, index) => this.normalize(row, details[index]))
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined
      const errorMessage = error instanceof Error ? error.message : ''
      const providerCode = errorMessage.match(/PipiAds API rejected [^:]+: ([^\s]+)/)?.[1]
      this.logger.warn(
        `PipiAds request failed${status ? ` with HTTP ${status}` : ''}${providerCode ? `, code ${providerCode}` : ''}`,
      )
      if (providerCode === '442' || /credits? not enough|insufficient credits|balance/i.test(errorMessage)) {
        throw new ServiceUnavailableException(
          'PipiAds credits are insufficient (provider code 442). Add credits and retry.',
        )
      }
      // PipiAds 4000083 表示第三方服务器无法下载提交的图片。该错误通常由 localhost、
      // 内网地址或失效链接导致，重复调用不会恢复，必须保留为明确的输入错误供前端提示。
      if (input.type === 'image' && (
        providerCode === '4000083'
        || /获取图片失败|image[^)]*(fetch|download).*(failed|failure)/i.test(errorMessage)
      )) {
        throw new BadRequestException(
          'PipiAds product image fetch failed. Use a publicly reachable HTTPS image URL or configure PUBLIC_ASSET_BASE_URL.',
        )
      }
      throw new ServiceUnavailableException('PipiAds provider is unavailable. Check provider status and retry.')
    }
  }

  private async searchByKeyword(keyword: string, targetMarket: string): Promise<Array<Record<string, unknown>>> {
    const regions = this.countryCodes(targetMarket)
    const payload = await this.request<PipiAdsListPayload>('/v3/api/open/adspy/list', {
      current_page: 1,
      page_size: this.pageSize(),
      extend_keywords: [{ type: 1, keyword }],
      data_type: [1, 3],
      shop_type: ['shopify'],
      is_url: 1,
      ad_state: 1,
      sort: 1,
      sort_type: 'desc',
      ...(regions.length ? { region: regions } : {}),
    })
    return Array.isArray(payload.data) ? payload.data : []
  }

  private async searchByImage(imageUrl: string): Promise<Array<Record<string, unknown>>> {
    const imageId = await this.request<string>('/v3/api/open/ai-search/image/submit/image-url', {
      image_url: imageUrl,
    })
    if (!imageId) throw new Error('PipiAds image submission returned no image ID')

    const timeoutMs = this.numberConfig('PIPIADS_IMAGE_POLL_TIMEOUT_MS', 45000, 5000, 120000)
    const intervalMs = this.numberConfig('PIPIADS_IMAGE_POLL_INTERVAL_MS', 3000, 100, 10000)
    const deadline = Date.now() + timeoutMs
    let completed = false
    while (Date.now() < deadline) {
      const status = await this.request<string>('/v3/api/open/ai-search/image/status', { image_id: imageId })
      if (status === 'SEARCH_COMPLETED') {
        completed = true
        break
      }
      if (status === 'ANALYSIS_FAILURE' || status === 'SEARCH_FAILURE') {
        throw new Error(`PipiAds image search failed with status ${status}`)
      }
      await this.sleep(intervalMs)
    }
    if (!completed) throw new Error('PipiAds image search timed out')

    const payload = await this.request<PipiAdsListPayload>('/v3/api/open/ai-search/image/search4/ad/search', {
      image_id: imageId,
      current_page: 1,
      page_size: this.pageSize(),
      shop_type: ['shopify'],
      is_url: 1,
      sort: 13,
      sort_type: 'desc',
    })
    return Array.isArray(payload.data) ? payload.data : []
  }

  private async getAdDetail(row: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const id = this.stringValue(row.id) || this.stringValue(row.video_id)
    if (!id) return null
    try {
      return await this.request<Record<string, unknown>>('/v3/api/open/adspy/detail', { id })
    } catch {
      this.logger.warn(`PipiAds detail lookup failed for ad ${id}`)
      return null
    }
  }

  private async request<T>(uri: string, params: Record<string, unknown>): Promise<T> {
    const response = await axios.post<PipiAdsEnvelope<T>>(
      `${this.baseUrl()}/data`,
      { key: this.apiKey(), uri, params },
      {
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        timeout: this.numberConfig('PIPIADS_REQUEST_TIMEOUT_MS', 30000, 1000, 120000),
      },
    )
    const envelope = response.data
    if (envelope.code !== 200 || envelope.fail === true || envelope.success === false || envelope.data === undefined) {
      const message = typeof envelope.message === 'string' ? envelope.message.trim().slice(0, 200) : ''
      throw new Error(
        `PipiAds API rejected ${uri}: ${envelope.code || 'unknown'}${message ? ` (${message})` : ''}`,
      )
    }
    return envelope.data
  }

  private normalize(row: Record<string, unknown>, detail: Record<string, unknown> | null): PipiAdsEvidence {
    const platform = this.platform(row.platform ?? detail?.platform)
    const landingPageUrl = this.firstUrl(
      detail?.landing_page,
      detail?.app_url,
      this.firstArrayValue(detail?.url_history),
    )
    const adId = this.stringValue(detail?.ad_id)
      || this.stringValue(row.ad_id)
      || this.stringValue(row.video_id)
      || this.stringValue(row.id)
      || 'unknown'
    const explicitAdUrl = this.firstUrl(
      detail?.ad_url,
      detail?.share_url,
      detail?.source_url,
      row.ad_url,
      row.share_url,
      row.source_url,
    )
    const providerRecordUrl = this.firstUrl(detail?.url, row.url, row.video_url)
    const platformAdUrl = this.isPlatformAdUrl(providerRecordUrl, platform) ? providerRecordUrl : null
    const adUrl = explicitAdUrl
      || platformAdUrl
      || (platform === 'facebook' && adId !== 'unknown'
        ? `https://www.facebook.com/ads/library/?id=${encodeURIComponent(adId)}`
        : null)
    const sourceUrl = adUrl || providerRecordUrl || landingPageUrl || ''
    const storeDomain = this.normalizeDomain(
      this.stringValue(detail?.root_path) || landingPageUrl || this.stringValue(detail?.app_url),
    )
    const advertiserName = this.stringValue(detail?.root_path)
      || this.stringValue(detail?.tiktok_author)
      || this.stringValue(row.app_name)
      || storeDomain
      || 'Unknown advertiser'
    const firstSeenAt = this.timestamp(this.numberValue(row.found_time) || this.numberValue(detail?.found_time))
    const lastSeenAt = this.timestamp(
      this.numberValue(detail?.last_put_time)
      || this.numberValue(row.last_put_time)
      || this.numberValue(detail?.update_time)
      || this.numberValue(row.modify_time),
    )

    return {
      adId,
      advertiserName,
      adUrl,
      sourceUrl,
      landingPageUrl,
      description: this.stringValue(row.desc) || this.stringValue(row.app_title) || '',
      imageUrl: this.firstUrl(row.cover, row.image, row.app_image),
      platform,
      storeDomain,
      shopType: this.stringValue(row.shop_type) || this.stringValue(detail?.shop_type) || null,
      firstSeenAt,
      lastSeenAt,
      synthetic: false,
      evidenceSource: 'pipiads_api',
      rawPayload: {
        provider: 'pipiads',
        evidenceSource: 'pipiads_api',
        evidenceAuthority: 'secondary',
        requiresOfficialVerification: true,
        adId,
        videoId: this.stringValue(row.video_id),
        advertiserId: this.stringValue(row.root_path_id),
        platform,
        adUrl,
        providerRecordUrl,
        isDirectAdLink: Boolean(adUrl),
        sourceUrl,
        landingPageUrl,
        storeDomain,
        shopType: this.stringValue(row.shop_type) || this.stringValue(detail?.shop_type),
        firstSeenAt,
        lastSeenAt,
        playCount: this.numberValue(row.play_count),
        deliveryDays: this.numberValue(row.put_days),
        fetchedRegions: Array.isArray(row.fetch_region) ? row.fetch_region : [],
      },
    }
  }

  private fallback(reason: string, input: PipiAdsDiscoveryInput): PipiAdsEvidence[] {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development')
    if (nodeEnv === 'production') {
      throw new ServiceUnavailableException(`${reason}; configure PIPIADS_API_KEY or retry later.`)
    }
    this.logger.warn(`${reason}; returning mock PipiAds evidence for local development.`)
    return [{
      adId: `mock-${input.type}`,
      advertiserName: 'AutoFlow Demo Store',
      adUrl: null,
      sourceUrl: 'https://www.tiktok.com/@autoflow-demo',
      landingPageUrl: 'https://autoflow-demo.example/products/sample',
      description: `Mock PipiAds evidence for ${input.value}`,
      imageUrl: null,
      platform: 'tiktok',
      storeDomain: 'autoflow-demo.example',
      shopType: 'shopify',
      firstSeenAt: null,
      lastSeenAt: null,
      synthetic: true,
      evidenceSource: 'pipiads_mock',
      rawPayload: {
        provider: 'pipiads',
        evidenceSource: 'pipiads_mock',
        evidenceAuthority: 'mock',
        requiresOfficialVerification: true,
        isDirectAdLink: false,
      },
    }]
  }

  private apiKey(): string | undefined {
    const value = this.configService.get<string>('PIPIADS_API_KEY')?.trim()
    return value && value !== 'your-pipiads-api-key' ? value : undefined
  }

  private baseUrl(): string {
    return this.configService.get<string>('PIPIADS_BASE_URL', 'https://www.pipispy.com/open-api/v1').replace(/\/$/, '')
  }

  private pageSize(): number {
    return this.numberConfig('PIPIADS_PAGE_SIZE', 20, 1, 20)
  }

  private numberConfig(name: string, fallback: number, min: number, max: number): number {
    const value = Number(this.configService.get<string | number>(name, fallback))
    return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback
  }

  private countryCodes(value: string): string[] {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'other' || normalized === 'ot') return []
    if (normalized === 'european union' || normalized === 'eu') {
      return ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']
    }
    if (/^[a-z]{2}$/.test(normalized)) return [normalized.toUpperCase()]
    const code = ({
      'united states': 'US', usa: 'US', 'united kingdom': 'GB', uk: 'GB',
      canada: 'CA', australia: 'AU', germany: 'DE', france: 'FR', spain: 'ES',
      italy: 'IT', netherlands: 'NL', brazil: 'BR', mexico: 'MX', japan: 'JP',
    } as Record<string, string>)[normalized]
    return code ? [code] : []
  }

  private platform(value: unknown): PipiAdsEvidence['platform'] {
    return ({ 1: 'facebook', 2: 'instagram', 3: 'tiktok' } as Record<number, PipiAdsEvidence['platform']>)[Number(value)] || 'unknown'
  }

  private isPlatformAdUrl(
    value: string | null,
    platform: PipiAdsEvidence['platform'],
  ): boolean {
    if (!value || platform === 'unknown') return false
    try {
      const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '')
      return ({
        facebook: /(^|\.)facebook\.com$/,
        instagram: /(^|\.)instagram\.com$/,
        tiktok: /(^|\.)tiktok\.com$/,
      } as const)[platform].test(host)
    } catch {
      return false
    }
  }

  private normalizeDomain(value: unknown): string | null {
    const raw = this.stringValue(value)
    if (!raw) return null
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
      return url.hostname.toLowerCase().replace(/^www\./, '') || null
    } catch {
      return null
    }
  }

  private firstUrl(...values: unknown[]): string | null {
    for (const value of values) {
      const candidate = this.stringValue(value)
      if (!candidate) continue
      try {
        const url = new URL(candidate)
        if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString()
      } catch {
        continue
      }
    }
    return null
  }

  private firstArrayValue(value: unknown): unknown {
    return Array.isArray(value) ? value[0] : undefined
  }

  private stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }

  private numberValue(value: unknown): number | null {
    const number = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(number) && number > 0 ? number : null
  }

  private timestamp(value: number | null): string | null {
    return value ? new Date(value * 1000).toISOString() : null
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length)
    let nextIndex = 0
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++
        results[index] = await mapper(items[index])
      }
    })
    await Promise.all(workers)
    return results
  }
}
