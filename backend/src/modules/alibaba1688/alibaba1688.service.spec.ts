import { Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import axios from 'axios'
import {
  detailProviderFixture,
  imageProviderFixture,
  imageUploadProviderFixture,
  keywordProviderFixture,
} from './__fixtures__/provider-responses'
import { Alibaba1688Exception } from './alibaba1688.error'
import { Alibaba1688Service } from './alibaba1688.service'
import { signParam2Request } from './param2-signer'

const readyConfig: Record<string, unknown> = {
  ALIBABA_1688_ENABLED: 'true',
  ALIBABA_1688_APP_KEY: '4270841',
  ALIBABA_1688_APP_SECRET: 'test-app-secret',
  ALIBABA_1688_ACCESS_TOKEN: 'test-access-token',
  ALIBABA_1688_GATEWAY_URL: 'https://gw.open.1688.com/openapi',
  ALIBABA_1688_PROTOCOL_VERSION: '1',
  ALIBABA_1688_KEYWORD_NAMESPACE: 'com.alibaba.fenxiao.crossborder',
  ALIBABA_1688_KEYWORD_METHOD: 'product.search.keywordQuery',
  ALIBABA_1688_IMAGE_NAMESPACE: 'com.alibaba.fenxiao.crossborder',
  ALIBABA_1688_IMAGE_METHOD: 'product.search.imageQuery',
  ALIBABA_1688_UPLOAD_NAMESPACE: 'com.alibaba.fenxiao.crossborder',
  ALIBABA_1688_UPLOAD_METHOD: 'product.image.upload',
  ALIBABA_1688_DETAIL_NAMESPACE: 'com.alibaba.fenxiao.crossborder',
  ALIBABA_1688_DETAIL_METHOD: 'product.search.queryProductDetail',
}

function service(config: Record<string, unknown> = readyConfig): Alibaba1688Service {
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => config[key] ?? fallback),
  } as unknown as ConfigService
  return new Alibaba1688Service(configService)
}

function requestParameters(callIndex = 0): URLSearchParams {
  const body = jest.mocked(axios.post).mock.calls[callIndex][1]
  if (typeof body !== 'string') throw new Error('Expected URL-encoded request body')
  return new URLSearchParams(body)
}

describe('Alibaba1688Service', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1720000000000)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reports readiness and fails closed without credentials', async () => {
    const post = jest.spyOn(axios, 'post')
    const provider = service({ ALIBABA_1688_ENABLED: 'false' })

    expect(provider.getReadiness()).toEqual({
      ready: false,
      enabled: false,
      missing: [
        'ALIBABA_1688_ENABLED',
        'ALIBABA_1688_APP_KEY',
        'ALIBABA_1688_APP_SECRET',
        'ALIBABA_1688_ACCESS_TOKEN',
      ],
      provider: 'alibaba_1688',
    })
    await expect(provider.searchByKeyword({ keyword: 'pet bottle' }))
      .rejects.toMatchObject({
        normalized: {
          code: 'NOT_CONFIGURED',
          retryable: false,
        },
      })
    expect(post).not.toHaveBeenCalled()
  })

  it('calls keywordQuery with a signed nested Param2 payload and returns raw plus stable data', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: keywordProviderFixture,
    })

    const result = await service().searchByKeyword({
      keyword: ' pet bottle ',
      beginPage: 1,
      pageSize: 20,
      filter: 'shipInToday,ksCiphertext',
      saleFilterList: [{ saleType: 'sales30', saleStart: '10', saleEnd: '100' }],
    })

    expect(axios.post).toHaveBeenCalledWith(
      'https://gw.open.1688.com/openapi/param2/1/com.alibaba.fenxiao.crossborder/product.search.keywordQuery/4270841',
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        }),
      }),
    )
    const params = requestParameters()
    expect(JSON.parse(params.get('offerQueryParam') ?? '')).toEqual({
      beginPage: 1,
      country: 'en',
      filter: 'shipInToday,ksCiphertext',
      keyword: 'pet bottle',
      pageSize: 20,
      saleFilterList: [{ saleEnd: '100', saleStart: '10', saleType: 'sales30' }],
    })
    expect(params.get('access_token')).toBe('test-access-token')
    expect(params.get('_aop_signature')).toBe(signParam2Request(
      'param2/1/com.alibaba.fenxiao.crossborder/product.search.keywordQuery/4270841',
      Object.fromEntries(
        [...params.entries()].filter(([name]) => name !== '_aop_signature'),
      ),
      'test-app-secret',
    ))
    expect(result.provider).toBe(keywordProviderFixture)
    expect(result.normalized).toMatchObject({
      provider: 'alibaba_1688',
      sourceTag: '1688货源',
      searchMode: 'keyword',
      affectsContactConfidence: false,
      offers: [{
        offerId: '1234567890123',
        offerUrl: 'https://detail.1688.com/offer/1234567890123.html',
        title: '便携式宠物饮水杯',
        minOrderQuantity: 1,
        selectedSupply: true,
        onePieceDropshipping: true,
        price: {
          currency: 'CNY',
          amount: '12.80',
          consignAmount: '13.50',
        },
        seller: {
          identities: ['super_factory', 'tp_member'],
          compositeServiceScore: '4.7',
        },
      }],
    })
    expect(result.metadata.requestId).toBe('keyword-request-1')
    expect(result.metadata.traceId).toBe('keyword-trace-1')
  })

  it('uploads a normalized image through product.image.upload-1', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: imageUploadProviderFixture,
    })

    const result = await service().uploadImage({
      imageBase64: Buffer.from('verified-image').toString('base64'),
    })

    expect(result.normalized.imageId).toBe('image-1688-1')
    expect(jest.mocked(axios.post).mock.calls[0][0]).toContain(
      '/param2/1/com.alibaba.fenxiao.crossborder/product.image.upload/',
    )
    expect(JSON.parse(requestParameters().get('uploadImageParam') ?? '')).toEqual({
      appKey: 4270841,
      imageBase64: Buffer.from('verified-image').toString('base64'),
    })
    expect(result.metadata.traceId).toBe('image-upload-trace-1')
  })

  it('rejects an empty upload result before it can be used as an imageId', async () => {
    const imageBase64 = Buffer.from('verified-image').toString('base64')
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        ...imageUploadProviderFixture,
        result: {
          ...imageUploadProviderFixture.result,
          result: '',
        },
      },
    })

    let caught: unknown
    try {
      await service().uploadImage({ imageBase64 })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Alibaba1688Exception)
    expect(caught).toMatchObject({
      normalized: {
        code: 'INVALID_REQUEST',
        message: 'imageId is required',
      },
    })
    expect(JSON.stringify(caught)).not.toContain(imageBase64)
  })

  it('uses the configured imageQuery method with imageId input', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: imageProviderFixture,
    })

    const result = await service().searchByImage({
      imageId: 'image-1688-1',
      beginPage: 2,
      pageSize: 10,
    })

    expect(jest.mocked(axios.post).mock.calls[0][0]).toContain(
      '/com.alibaba.fenxiao.crossborder/product.search.imageQuery/4270841',
    )
    expect(JSON.parse(requestParameters().get('offerQueryParam') ?? '')).toEqual({
      beginPage: 2,
      country: 'en',
      imageId: 'image-1688-1',
      pageSize: 10,
    })
    expect(result.normalized).toMatchObject({
      searchMode: 'image',
      page: 2,
      offers: [{
        offerId: '998877665544',
        price: { amount: '8.88' },
      }],
      affectsContactConfidence: false,
    })
  })

  it('requires imageId for product.search.imageQuery-1', async () => {
    await expect(service().searchByImage({ imageId: '' })).rejects.toMatchObject({
      normalized: { code: 'INVALID_REQUEST' },
    })
  })

  it('uses queryProductDetail and injects the server-side AppKey into the detail DTO', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: detailProviderFixture,
    })

    const result = await service().getProductDetail({
      offerId: '1234567890123',
      country: 'en',
    })

    expect(jest.mocked(axios.post).mock.calls[0][0]).toContain(
      '/com.alibaba.fenxiao.crossborder/product.search.queryProductDetail/4270841',
    )
    expect(JSON.parse(requestParameters().get('offerDetailParam') ?? '')).toEqual({
      appKey: '4270841',
      country: 'en',
      offerId: '1234567890123',
    })
    expect(result.provider).toBe(detailProviderFixture)
    expect(result.normalized).toMatchObject({
      sourceTag: '1688货源',
      offerId: '1234567890123',
      title: '便携式宠物饮水杯',
      minOrderQuantity: 1,
      affectsContactConfidence: false,
      seller: {
        openId: 'seller-open-id-1',
        companyName: '杭州示例宠物用品有限公司',
      },
      skus: [{
        skuId: '10001',
        stock: 500,
        price: '13.50',
      }],
    })
    expect(result.normalized.imageUrls).toHaveLength(3)
  })

  it('honors the six cross-border namespace and method configuration variables', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: keywordProviderFixture,
    })
    const custom = service({
      ...readyConfig,
      ALIBABA_1688_KEYWORD_NAMESPACE: 'com.example.crossborder',
      ALIBABA_1688_KEYWORD_METHOD: 'product.search.customKeyword',
    })

    await custom.searchByKeyword({ keyword: 'bottle' })

    expect(jest.mocked(axios.post).mock.calls[0][0]).toBe(
      'https://gw.open.1688.com/openapi/param2/1/com.example.crossborder/product.search.customKeyword/4270841',
    )
  })

  it('normalizes provider errors and never leaks credentials through logs or exceptions', async () => {
    const log = jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        _aop_response_id: 'auth-request-1',
        result: {
          success: false,
          code: 'INVALID_TOKEN',
          message: 'access_token=test-access-token appSecret=test-app-secret expired',
        },
      },
    })

    let caught: unknown
    try {
      await service().searchByKeyword({ keyword: 'bottle' })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Alibaba1688Exception)
    const exception = caught as Alibaba1688Exception
    expect(exception.normalized).toEqual({
      provider: 'alibaba_1688',
      code: 'AUTHENTICATION_FAILED',
      message: 'Alibaba 1688 authorization is invalid or expired.',
      retryable: false,
      httpStatus: 200,
      providerCode: 'INVALID_TOKEN',
      requestId: 'auth-request-1',
    })
    const logged = log.mock.calls.flat().join(' ')
    expect(logged).not.toContain('test-access-token')
    expect(logged).not.toContain('test-app-secret')
  })

  it('normalizes axios timeouts as retryable without exposing the request payload', async () => {
    const timeout = new Error('timeout of 30000ms exceeded') as Error & {
      code: string
      isAxiosError: boolean
      config: Record<string, unknown>
    }
    timeout.code = 'ECONNABORTED'
    timeout.isAxiosError = true
    timeout.config = {
      data: 'access_token=test-access-token&_aop_signature=secret-signature',
    }
    jest.spyOn(axios, 'post').mockRejectedValue(timeout)

    await expect(service().searchByKeyword({ keyword: 'bottle' }))
      .rejects.toMatchObject({
        normalized: {
          code: 'TIMEOUT',
          message: 'Alibaba 1688 request timed out.',
          retryable: true,
        },
      })
  })

  it('rejects a missing imageId before any network request', async () => {
    const post = jest.spyOn(axios, 'post')

    await expect(service().searchByImage({ imageId: '   ' }))
      .rejects.toMatchObject({
        normalized: { code: 'INVALID_REQUEST' },
      })
    expect(post).not.toHaveBeenCalled()
  })
})
