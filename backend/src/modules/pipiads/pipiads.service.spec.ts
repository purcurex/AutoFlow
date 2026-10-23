import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import axios from 'axios'
import { PipiAdsService } from './pipiads.service'

function service(config: Record<string, unknown>): PipiAdsService {
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => config[key] ?? fallback),
  } as unknown as ConfigService
  return new PipiAdsService(configService)
}

describe('PipiAdsService', () => {
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('expands the European Union market and leaves Other region-unrestricted', () => {
    const provider = service({}) as unknown as { countryCodes(value: string): string[] }

    expect(provider.countryCodes('European Union')).toEqual(expect.arrayContaining(['DE', 'FR', 'IT', 'ES', 'NL']))
    expect(provider.countryCodes('European Union')).toHaveLength(27)
    expect(provider.countryCodes('Other')).toEqual([])
  })

  it('queries active Shopify ad evidence and hydrates authoritative links from details', async () => {
    const post = jest.spyOn(axios, 'post')
      .mockResolvedValueOnce({
        data: {
          code: 200,
          success: true,
          data: {
            data: [{
              video_id: 'video-1',
              ad_id: 'ad-1',
              app_name: 'PawSpark',
              desc: 'Pet grooming brush campaign',
              cover: 'https://cdn.example/cover.jpg',
              platform: 3,
              found_time: 1750000000,
              last_put_time: 1750003600,
              shop_type: 'shopify',
            }],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          code: 200,
          success: true,
          data: {
            ad_id: 'ad-1',
            root_path: 'pawspark.example',
            url: 'https://www.tiktok.com/@pawspark/video/1',
            landing_page: 'https://pawspark.example/products/brush',
          },
        },
      })

    const result = await service({ PIPIADS_API_KEY: 'test-key', PIPIADS_PAGE_SIZE: 20 }).discover({
      type: 'keyword',
      value: 'pet brush',
      targetMarket: 'United States',
    })

    expect(post).toHaveBeenNthCalledWith(1,
      'https://www.pipispy.com/open-api/v1/data',
      expect.objectContaining({
        key: 'test-key',
        uri: '/v3/api/open/adspy/list',
        params: expect.objectContaining({
          extend_keywords: [{ type: 1, keyword: 'pet brush' }],
          region: ['US'],
          shop_type: ['shopify'],
          ad_state: 1,
        }),
      }),
      expect.any(Object),
    )
    expect(result[0]).toMatchObject({
      adId: 'ad-1',
      advertiserName: 'pawspark.example',
      platform: 'tiktok',
      storeDomain: 'pawspark.example',
      shopType: 'shopify',
      synthetic: false,
    })
    expect(result[0].rawPayload).toMatchObject({
      evidenceAuthority: 'secondary',
      requiresOfficialVerification: true,
    })
  })

  it('uses the documented image submit, status, search, and detail flow', async () => {
    const post = jest.spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { code: 200, success: true, data: 'img-1' } })
      .mockResolvedValueOnce({ data: { code: 200, success: true, data: 'SEARCH_COMPLETED' } })
      .mockResolvedValueOnce({
        data: { code: 200, success: true, data: { data: [{ video_id: 'video-1', app_name: 'Image Match' }] } },
      })
      .mockResolvedValueOnce({
        data: { code: 200, success: true, data: { root_path: 'image-match.example', url: 'https://example.com/ad/1' } },
      })

    const result = await service({ PIPIADS_API_KEY: 'test-key' }).discover({
      type: 'image',
      value: 'https://cdn.example/product.jpg',
      targetMarket: 'US',
    })

    expect(post.mock.calls.map((call) => (call[1] as { uri: string }).uri)).toEqual([
      '/v3/api/open/ai-search/image/submit/image-url',
      '/v3/api/open/ai-search/image/status',
      '/v3/api/open/ai-search/image/search4/ad/search',
      '/v3/api/open/adspy/detail',
    ])
    expect(result[0].storeDomain).toBe('image-match.example')
  })

  it('builds a Facebook Ads Library link and marks PipiAds API evidence explicitly', async () => {
    jest.spyOn(axios, 'post')
      .mockResolvedValueOnce({
        data: {
          code: 200,
          success: true,
          data: {
            data: [{
              ad_id: 'fb-ad-42',
              app_name: 'PawSpark',
              platform: 1,
              shop_type: 'shopify',
            }],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          code: 200,
          success: true,
          data: {
            ad_id: 'fb-ad-42',
            root_path: 'pawspark.example',
            landing_page: 'https://pawspark.example/products/brush',
          },
        },
      })

    const [result] = await service({ PIPIADS_API_KEY: 'test-key' }).discover({
      type: 'keyword',
      value: 'pet brush',
      targetMarket: 'US',
    })

    expect(result).toMatchObject({
      platform: 'facebook',
      adUrl: 'https://www.facebook.com/ads/library/?id=fb-ad-42',
      sourceUrl: 'https://www.facebook.com/ads/library/?id=fb-ad-42',
      evidenceSource: 'pipiads_api',
    })
    expect(result.rawPayload).toMatchObject({
      provider: 'pipiads',
      evidenceSource: 'pipiads_api',
      isDirectAdLink: true,
    })
  })

  it('shares one provider request for identical concurrent discovery calls', async () => {
    let resolveRequest: (value: unknown) => void
    const providerResponse = new Promise((resolve) => { resolveRequest = resolve })
    const post = jest.spyOn(axios, 'post').mockReturnValue(providerResponse as ReturnType<typeof axios.post>)
    const pipiAds = service({ PIPIADS_API_KEY: 'test-key' })
    const input = { type: 'keyword' as const, value: 'pet brush', targetMarket: 'US' }

    const first = pipiAds.discover(input)
    const second = pipiAds.discover(input)
    expect(first).toBe(second)
    expect(post).toHaveBeenCalledTimes(1)

    resolveRequest!({ data: { code: 200, success: true, data: { data: [] } } })
    await expect(first).resolves.toEqual([])
  })

  it('fails closed when image discovery exceeds its polling deadline', async () => {
    jest.useFakeTimers()
    const post = jest.spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { code: 200, success: true, data: 'img-timeout' } })
      .mockResolvedValue({ data: { code: 200, success: true, data: 'SEARCHING' } })
    const discovery = service({
      NODE_ENV: 'production',
      PIPIADS_API_KEY: 'test-key',
      PIPIADS_IMAGE_POLL_TIMEOUT_MS: 5000,
      PIPIADS_IMAGE_POLL_INTERVAL_MS: 5000,
    }).discover({
      type: 'image',
      value: 'https://cdn.example/product.jpg',
      targetMarket: 'US',
    })
    const rejection = expect(discovery).rejects.toBeInstanceOf(ServiceUnavailableException)

    await jest.advanceTimersByTimeAsync(5000)
    await rejection
    expect(post.mock.calls.map((call) => (call[1] as { uri: string }).uri)).not.toContain(
      '/v3/api/open/ai-search/image/search4/ad/search',
    )
  })

  it('fails closed in production when the API key is missing', async () => {
    await expect(service({ NODE_ENV: 'production', ENABLE_MOCK_SEARCH: 'false' }).discover({
      type: 'keyword',
      value: 'pet brush',
      targetMarket: 'US',
    })).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('does not replace configured provider failures with mock evidence', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: { code: 442, fail: true, message: 'credits not enough' },
    })

    await expect(service({ NODE_ENV: 'development', PIPIADS_API_KEY: 'test-key' }).discover({
      type: 'keyword',
      value: 'pet brush',
      targetMarket: 'US',
    })).rejects.toThrow('PipiAds credits are insufficient (provider code 442)')
  })

  it('classifies an image URL rejected by PipiAds as a non-retryable unreachable image', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        code: 4000083,
        success: false,
        fail: true,
        message: '获取图片失败',
        data: '',
      },
    })

    const discovery = service({
      NODE_ENV: 'development',
      PIPIADS_API_KEY: 'test-key',
    }).discover({
      type: 'image',
      value: 'http://localhost:3000/uploads/workflow-seeds/owner/product.jpg',
      targetMarket: 'US',
    })

    await expect(discovery).rejects.toBeInstanceOf(BadRequestException)
    await expect(discovery).rejects.toThrow(
      'PipiAds product image fetch failed. Use a publicly reachable HTTPS image URL or configure PUBLIC_ASSET_BASE_URL.',
    )
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('marks local fallback evidence as synthetic', async () => {
    const result = await service({ NODE_ENV: 'development' }).discover({
      type: 'keyword',
      value: 'pet brush',
      targetMarket: 'US',
    })
    expect(result[0]).toMatchObject({ synthetic: true, shopType: 'shopify' })
  })
})
