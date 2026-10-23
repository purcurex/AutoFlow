import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import {
  ALIBABA_1688_DEFAULTS,
  ALIBABA_1688_PROVIDER,
  ALIBABA_1688_SOURCE_TAG,
} from './alibaba1688.constants'
import type {
  Alibaba1688ImageSearchDto,
  Alibaba1688ImageUploadDto,
  Alibaba1688KeywordSearchDto,
  Alibaba1688ProductDetailDto,
} from './dto/alibaba1688.dto'
import { Alibaba1688Exception } from './alibaba1688.error'
import { sanitizeAlibaba1688Message } from './alibaba1688.security'
import {
  buildParam2SignaturePath,
  serializeParam2Parameters,
  signParam2Request,
} from './param2-signer'
import type {
  Alibaba1688CallResult,
  Alibaba1688DetailProviderResponse,
  Alibaba1688Endpoint,
  Alibaba1688ImageProviderResponse,
  Alibaba1688ImageUploadProviderResponse,
  Alibaba1688KeywordProviderResponse,
  Alibaba1688NormalizedError,
  Alibaba1688Operation,
  Alibaba1688ProviderEnvelope,
  Alibaba1688ProviderOffer,
  Alibaba1688ProviderOperationResult,
  Alibaba1688ProviderPage,
  Alibaba1688ProviderProductDetail,
  Alibaba1688ProviderSellerData,
  Alibaba1688Readiness,
  Alibaba1688StableOffer,
  Alibaba1688StableImageUploadResult,
  Alibaba1688StableProductDetail,
  Alibaba1688StableSearchResult,
  Alibaba1688StableSeller,
} from './alibaba1688.types'

interface Alibaba1688RuntimeConfig {
  enabled: boolean
  appKey: string | null
  appSecret: string | null
  accessToken: string | null
  gatewayUrl: string
  protocol: string
  version: string
  requestTimeoutMs: number
}
@Injectable()
export class Alibaba1688Service {
  private readonly logger = new Logger(Alibaba1688Service.name)

  constructor(private readonly configService: ConfigService) {}

  getReadiness(): Alibaba1688Readiness {
    const config = this.runtimeConfig()
    const missing: string[] = []
    if (!config.enabled) missing.push('ALIBABA_1688_ENABLED')
    if (!config.appKey) missing.push('ALIBABA_1688_APP_KEY')
    if (!config.appSecret) missing.push('ALIBABA_1688_APP_SECRET')
    if (!config.accessToken) missing.push('ALIBABA_1688_ACCESS_TOKEN')
    return {
      ready: missing.length === 0,
      enabled: config.enabled,
      missing,
      provider: ALIBABA_1688_PROVIDER,
    }
  }

  async searchByKeyword(
    input: Alibaba1688KeywordSearchDto,
  ): Promise<Alibaba1688CallResult<Alibaba1688KeywordProviderResponse, Alibaba1688StableSearchResult>> {
    const keyword = this.requiredText(input.keyword, 'keyword')
    const pageSize = this.clampInteger(
      input.pageSize,
      this.numberConfig('ALIBABA_1688_PAGE_SIZE', ALIBABA_1688_DEFAULTS.pageSize, 1, 100),
      1,
      100,
    )
    const beginPage = this.clampInteger(input.beginPage, 1, 1, 10000)
    const offerQueryParam = this.compactObject({
      ...input,
      keyword,
      beginPage,
      pageSize,
      country: this.optionalText(input.country) ?? 'en',
    })
    const provider = await this.invoke<Alibaba1688ProviderPage, Alibaba1688KeywordProviderResponse>(
      'keyword_search',
      this.endpoint('keyword'),
      { offerQueryParam },
    )
    return this.callResult(
      'keyword_search',
      provider,
      this.normalizeSearch('keyword', provider.result?.result, beginPage, pageSize),
    )
  }

  async searchByImage(
    input: Alibaba1688ImageSearchDto,
  ): Promise<Alibaba1688CallResult<Alibaba1688ImageProviderResponse, Alibaba1688StableSearchResult>> {
    const imageId = this.requiredText(input.imageId, 'imageId')

    const pageSize = this.clampInteger(
      input.pageSize,
      this.numberConfig('ALIBABA_1688_PAGE_SIZE', ALIBABA_1688_DEFAULTS.pageSize, 1, 100),
      1,
      100,
    )
    const beginPage = this.clampInteger(input.beginPage, 1, 1, 10000)
    const offerQueryParam = this.compactObject({
      ...input,
      imageId,
      beginPage,
      pageSize,
      country: this.optionalText(input.country) ?? 'en',
    })
    const provider = await this.invoke<Alibaba1688ProviderPage, Alibaba1688ImageProviderResponse>(
      'image_search',
      this.endpoint('image'),
      { offerQueryParam },
    )
    return this.callResult(
      'image_search',
      provider,
      this.normalizeSearch('image', provider.result?.result, beginPage, pageSize),
    )
  }

  async uploadImage(
    input: Alibaba1688ImageUploadDto,
  ): Promise<Alibaba1688CallResult<Alibaba1688ImageUploadProviderResponse, Alibaba1688StableImageUploadResult>> {
    const config = this.requireReady()
    const imageBase64 = this.requiredText(input.imageBase64, 'imageBase64')
    const provider = await this.invoke<string, Alibaba1688ImageUploadProviderResponse>(
      'image_upload',
      this.endpoint('upload'),
      {
        uploadImageParam: {
          imageBase64,
          appKey: Number(config.appKey),
          outMemberId: input.outMemberId,
        },
      },
      config,
    )
    return this.callResult('image_upload', provider, {
      provider: ALIBABA_1688_PROVIDER,
      imageId: this.requiredText(provider.result?.result, 'imageId'),
    })
  }

  async getProductDetail(
    input: Alibaba1688ProductDetailDto,
  ): Promise<Alibaba1688CallResult<Alibaba1688DetailProviderResponse, Alibaba1688StableProductDetail>> {
    const offerId = this.requiredId(input.offerId, 'offerId')
    const config = this.requireReady()
    const offerDetailParam = this.compactObject({
      offerId,
      country: this.optionalText(input.country) ?? 'en',
      outMemberId: this.optionalText(input.outMemberId),
      appKey: config.appKey,
    })
    const provider = await this.invoke<Alibaba1688ProviderProductDetail, Alibaba1688DetailProviderResponse>(
      'product_detail',
      this.endpoint('detail'),
      { offerDetailParam },
      config,
    )
    return this.callResult(
      'product_detail',
      provider,
      this.normalizeProductDetail(provider.result?.result),
    )
  }

  private async invoke<TResult, TEnvelope extends Alibaba1688ProviderEnvelope<TResult>>(
    operation: Alibaba1688Operation,
    endpoint: Alibaba1688Endpoint,
    applicationParameters: Record<string, unknown>,
    readyConfig?: Alibaba1688RuntimeConfig & { appKey: string; appSecret: string; accessToken: string },
  ): Promise<TEnvelope> {
    const config = readyConfig ?? this.requireReady()
    const parameters = serializeParam2Parameters({
      ...applicationParameters,
      _aop_datePattern: ALIBABA_1688_DEFAULTS.datePattern,
      _aop_responseFormat: 'json2',
      _aop_timestamp: Date.now(),
      access_token: config.accessToken,
    })
    parameters._aop_signature = signParam2Request(
      endpoint.signaturePath,
      parameters,
      config.appSecret,
    )

    try {
      const response = await axios.post<TEnvelope>(
        endpoint.url,
        new URLSearchParams(parameters).toString(),
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          },
          timeout: config.requestTimeoutMs,
        },
      )
      const provider = response.data
      const rejection = this.providerRejection(provider, response.status)
      if (rejection) throw new Alibaba1688Exception(rejection)
      return provider
    } catch (error) {
      const normalized = error instanceof Alibaba1688Exception
        ? error.normalized
        : this.normalizeTransportError(error)
      this.logger.warn(
        `Alibaba 1688 ${operation} failed: code=${normalized.code}`
        + `${normalized.httpStatus ? ` httpStatus=${normalized.httpStatus}` : ''}`
        + `${normalized.providerCode ? ` providerCode=${normalized.providerCode}` : ''}`
        + `${normalized.requestId ? ` requestId=${normalized.requestId}` : ''}`,
      )
      throw error instanceof Alibaba1688Exception
        ? error
        : new Alibaba1688Exception(normalized)
    }
  }

  private endpoint(kind: 'keyword' | 'image' | 'detail' | 'upload'): Alibaba1688Endpoint {
    const config = this.runtimeConfig()
    if (!config.appKey) throw this.notConfigured(['ALIBABA_1688_APP_KEY'])
    const prefix = `ALIBABA_1688_${kind.toUpperCase()}`
    const namespace = this.safeApiPart(
      this.configService.get<string>(`${prefix}_NAMESPACE`),
      ALIBABA_1688_DEFAULTS.namespace,
    )
    const methodDefaults = {
      keyword: ALIBABA_1688_DEFAULTS.keywordMethod,
      image: ALIBABA_1688_DEFAULTS.imageMethod,
      detail: ALIBABA_1688_DEFAULTS.detailMethod,
      upload: ALIBABA_1688_DEFAULTS.uploadMethod,
    }
    const method = this.safeApiPart(
      this.configService.get<string>(`${prefix}_METHOD`),
      methodDefaults[kind],
    )
    const signaturePath = buildParam2SignaturePath(
      config.version,
      namespace,
      method,
      config.appKey,
    )
    return {
      namespace,
      method,
      version: config.version,
      signaturePath,
      url: `${config.gatewayUrl}/${signaturePath}`,
    }
  }

  private requireReady(): Alibaba1688RuntimeConfig & {
    appKey: string
    appSecret: string
    accessToken: string
  } {
    const readiness = this.getReadiness()
    if (!readiness.ready) throw this.notConfigured(readiness.missing)
    return this.runtimeConfig() as Alibaba1688RuntimeConfig & {
      appKey: string
      appSecret: string
      accessToken: string
    }
  }

  private runtimeConfig(): Alibaba1688RuntimeConfig {
    const gatewayUrl = this.gatewayUrl()
    return {
      enabled: this.configService.get<string | boolean>('ALIBABA_1688_ENABLED') === true
        || this.configService.get<string>('ALIBABA_1688_ENABLED')?.trim().toLowerCase() === 'true',
      appKey: this.secretConfig('ALIBABA_1688_APP_KEY'),
      appSecret: this.secretConfig('ALIBABA_1688_APP_SECRET'),
      accessToken: this.secretConfig('ALIBABA_1688_ACCESS_TOKEN'),
      gatewayUrl,
      protocol: ALIBABA_1688_DEFAULTS.protocol,
      version: this.safeVersion(
        this.configService.get<string>('ALIBABA_1688_PROTOCOL_VERSION'),
      ),
      requestTimeoutMs: this.numberConfig(
        'ALIBABA_1688_REQUEST_TIMEOUT_MS',
        ALIBABA_1688_DEFAULTS.requestTimeoutMs,
        1000,
        120000,
      ),
    }
  }

  private gatewayUrl(): string {
    const configured = this.configService
      .get<string>('ALIBABA_1688_GATEWAY_URL', ALIBABA_1688_DEFAULTS.gatewayUrl)
      .trim()
      .replace(/\/+$/, '')
    try {
      const url = new URL(configured)
      if (url.protocol !== 'https:') throw new Error('HTTPS is required')
      return url.toString().replace(/\/+$/, '')
    } catch {
      throw this.invalidRequest('ALIBABA_1688_GATEWAY_URL must be a valid HTTPS URL')
    }
  }

  private providerRejection<T>(
    provider: Alibaba1688ProviderEnvelope<T>,
    httpStatus: number,
  ): Alibaba1688NormalizedError | null {
    if (!provider || typeof provider !== 'object') {
      return this.error('INVALID_RESPONSE', 'Alibaba 1688 returned an invalid response.', false, httpStatus)
    }

    const topCode = provider.errorCode ?? provider.error_code
    const topMessage = provider.errorMessage ?? provider.error_message
    if (topCode !== undefined || topMessage) {
      return this.classifyProviderError(topCode, topMessage, httpStatus, this.requestId(provider))
    }

    const operation = provider.result
    if (!operation || typeof operation !== 'object') {
      return this.error(
        'INVALID_RESPONSE',
        'Alibaba 1688 returned a response without an operation result.',
        false,
        httpStatus,
        null,
        this.requestId(provider),
      )
    }
    if (!this.isProviderSuccess(operation)) {
      return this.classifyProviderError(
        operation.code,
        operation.message,
        httpStatus,
        this.requestId(provider),
      )
    }
    if (operation.result === undefined || operation.result === null) {
      return this.error(
        'INVALID_RESPONSE',
        'Alibaba 1688 returned an empty operation result.',
        false,
        httpStatus,
        this.safeProviderCode(operation.code),
        this.requestId(provider),
      )
    }
    return null
  }

  private isProviderSuccess<T>(operation: Alibaba1688ProviderOperationResult<T>): boolean {
    if (operation.success === true) return true
    if (typeof operation.success === 'string') {
      return ['true', 'success', '1'].includes(operation.success.trim().toLowerCase())
    }
    if (operation.success === false) return false
    const code = this.safeProviderCode(operation.code)
    return operation.result !== undefined && (!code || ['0', '200', 'SUCCESS'].includes(code.toUpperCase()))
  }

  private classifyProviderError(
    rawCode: unknown,
    rawMessage: unknown,
    httpStatus: number | null,
    requestId: string | null,
  ): Alibaba1688NormalizedError {
    const providerCode = this.safeProviderCode(rawCode)
    const diagnostic = sanitizeAlibaba1688Message(rawMessage, this.knownSecrets()).toLowerCase()
    const codeText = providerCode?.toLowerCase() ?? ''
    if (
      httpStatus === 401
      || /invalid.?token|expired.?token|access.?token|unauthori[sz]ed|oauth|授权|令牌/.test(diagnostic)
      || /invalid.?token|401/.test(codeText)
    ) {
      return this.error(
        'AUTHENTICATION_FAILED',
        'Alibaba 1688 authorization is invalid or expired.',
        false,
        httpStatus,
        providerCode,
        requestId,
      )
    }
    if (
      httpStatus === 403
      || /permission|forbidden|access.?denied|scope|no.?privilege|权限/.test(diagnostic)
      || /403|forbidden/.test(codeText)
    ) {
      return this.error(
        'PERMISSION_DENIED',
        'Alibaba 1688 API permission is not available for this application.',
        false,
        httpStatus,
        providerCode,
        requestId,
      )
    }
    if (
      httpStatus === 429
      || /rate.?limit|too many|flow.?limit|quota|throttl|限流|频率/.test(diagnostic)
      || /429|flow.?limit/.test(codeText)
    ) {
      return this.error(
        'RATE_LIMITED',
        'Alibaba 1688 request limit was reached.',
        true,
        httpStatus,
        providerCode,
        requestId,
      )
    }
    if (
      httpStatus === 400
      || /invalid.?param|missing.?param|illegal.?argument|参数/.test(diagnostic)
    ) {
      return this.error(
        'INVALID_REQUEST',
        'Alibaba 1688 rejected the request parameters.',
        false,
        httpStatus,
        providerCode,
        requestId,
      )
    }
    return this.error(
      'PROVIDER_REJECTED',
      'Alibaba 1688 rejected the provider request.',
      Boolean(httpStatus && httpStatus >= 500),
      httpStatus,
      providerCode,
      requestId,
    )
  }

  private normalizeTransportError(error: unknown): Alibaba1688NormalizedError {
    if (axios.isAxiosError(error)) {
      const httpStatus = error.response?.status ?? null
      const requestId = this.requestId(
        error.response?.data && typeof error.response.data === 'object'
          ? error.response.data as Record<string, unknown>
          : {},
      )
      if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message)) {
        return this.error(
          'TIMEOUT',
          'Alibaba 1688 request timed out.',
          true,
          httpStatus,
          null,
          requestId,
        )
      }
      if (error.response?.data && typeof error.response.data === 'object') {
        const provider = error.response.data as Alibaba1688ProviderEnvelope<unknown>
        const rawCode = provider.errorCode ?? provider.error_code ?? provider.result?.code
        const rawMessage = provider.errorMessage ?? provider.error_message ?? provider.result?.message
        if (rawCode !== undefined || rawMessage) {
          return this.classifyProviderError(rawCode, rawMessage, httpStatus, requestId)
        }
      }
      return this.error(
        'NETWORK_ERROR',
        'Alibaba 1688 provider is unavailable.',
        true,
        httpStatus,
        null,
        requestId,
      )
    }
    return this.error(
      'NETWORK_ERROR',
      'Alibaba 1688 provider is unavailable.',
      true,
      null,
    )
  }

  private normalizeSearch(
    searchMode: 'keyword' | 'image',
    page: Alibaba1688ProviderPage | undefined,
    requestedPage: number,
    requestedPageSize: number,
  ): Alibaba1688StableSearchResult {
    return {
      provider: ALIBABA_1688_PROVIDER,
      sourceTag: ALIBABA_1688_SOURCE_TAG,
      searchMode,
      page: this.finiteNumber(page?.currentPage) ?? requestedPage,
      pageSize: this.finiteNumber(page?.pageSize) ?? requestedPageSize,
      totalRecords: this.finiteNumber(page?.totalRecords),
      totalPages: this.finiteNumber(page?.totalPage),
      offers: Array.isArray(page?.data) ? page.data.map((offer) => this.normalizeOffer(offer)) : [],
      affectsContactConfidence: false,
    }
  }

  private normalizeOffer(offer: Alibaba1688ProviderOffer): Alibaba1688StableOffer {
    const offerId = this.idValue(offer.offerId)
    const priceInfo = offer.priceInfo ?? {}
    return {
      provider: ALIBABA_1688_PROVIDER,
      sourceTag: ALIBABA_1688_SOURCE_TAG,
      offerId,
      offerUrl: this.offerUrl(offerId, offer.promotionURL ?? offer.promotionUrl),
      title: this.textValue(offer.subject),
      translatedTitle: this.textValue(offer.subjectTrans),
      imageUrl: this.firstHttpUrl(offer.imageUrl, offer.whiteImage, offer.aigcImageUrl),
      price: {
        currency: 'CNY',
        amount: this.firstText(priceInfo.price, priceInfo.consignPrice, priceInfo.jxhyPrice),
        consignAmount: this.textValue(priceInfo.consignPrice),
        selectedSupplyAmount: this.firstText(priceInfo.jxhyPrice, priceInfo.pfJxhyPrice),
        promotionAmount: this.textValue(priceInfo.promotionPrice),
      },
      minOrderQuantity: this.finiteNumber(offer.minOrderQuantity),
      monthSold: this.finiteNumber(offer.monthSold),
      repurchaseRate: this.textValue(offer.repurchaseRate),
      onePieceDropshipping: typeof offer.isOnePsale === 'boolean' ? offer.isOnePsale : null,
      selectedSupply: typeof offer.isJxhy === 'boolean' ? offer.isJxhy : null,
      tradeScore: this.textValue(offer.tradeScore),
      offerIdentities: this.stringArray(offer.offerIdentities),
      seller: this.normalizeSeller(
        offer.sellerDataInfo,
        null,
        null,
        offer.sellerIdentities,
      ),
    }
  }

  private normalizeProductDetail(
    detail: Alibaba1688ProviderProductDetail | undefined,
  ): Alibaba1688StableProductDetail {
    const data = detail ?? {}
    const offerId = this.idValue(data.offerId)
    const images = [
      ...(Array.isArray(data.productImage?.images) ? data.productImage.images : []),
      data.productImage?.whiteImage,
      ...(Array.isArray(data.productImageTrans?.images) ? data.productImageTrans.images : []),
      data.productImageTrans?.whiteImage,
    ].filter((value): value is string => Boolean(this.firstHttpUrl(value)))
    return {
      provider: ALIBABA_1688_PROVIDER,
      sourceTag: ALIBABA_1688_SOURCE_TAG,
      offerId,
      offerUrl: this.offerUrl(offerId, data.promotionUrl),
      title: this.textValue(data.subject),
      translatedTitle: this.textValue(data.subjectTrans),
      description: this.firstText(data.descriptionTrans, data.description),
      categoryId: this.idValue(data.categoryId),
      categoryName: this.textValue(data.categoryName),
      imageUrls: [...new Set(images)],
      minOrderQuantity: this.finiteNumber(data.minOrderQuantity),
      status: this.textValue(data.status),
      sold: this.finiteNumber(data.soldOut),
      tradeScore: this.textValue(data.tradeScore),
      sellingPoints: this.stringArray(data.sellingPoint),
      skus: Array.isArray(data.productSkuInfos)
        ? data.productSkuInfos.map((sku) => ({
          skuId: this.idValue(sku.skuId),
          specId: this.textValue(sku.specId),
          stock: this.finiteNumber(sku.amountOnSale),
          price: this.firstText(sku.promotionPrice, sku.consignPrice, sku.jxhyPrice, sku.price),
          consignPrice: this.textValue(sku.consignPrice),
          attributes: Array.isArray(sku.skuAttributes) ? sku.skuAttributes : [],
        }))
        : [],
      seller: this.normalizeSeller(
        data.sellerDataInfo,
        data.sellerOpenId,
        data.companyName,
        data.offerIdentities,
      ),
      affectsContactConfidence: false,
    }
  }

  private normalizeSeller(
    data: Alibaba1688ProviderSellerData | undefined,
    openId: unknown,
    companyName: unknown,
    identities: unknown,
  ): Alibaba1688StableSeller {
    return {
      openId: this.textValue(openId),
      companyName: this.textValue(companyName),
      shopUrl: null,
      identities: this.stringArray(identities),
      tradeMedalLevel: this.textValue(data?.tradeMedalLevel),
      compositeServiceScore: this.textValue(data?.compositeServiceScore),
      logisticsExperienceScore: this.textValue(data?.logisticsExperienceScore),
      repeatPurchasePercent: this.textValue(data?.repeatPurchasePercent),
    }
  }

  private callResult<TProvider, TStable>(
    operation: Alibaba1688Operation,
    provider: TProvider,
    normalized: TStable,
  ): Alibaba1688CallResult<TProvider, TStable> {
    return {
      provider,
      normalized,
      metadata: {
        operation,
        provider: ALIBABA_1688_PROVIDER,
        requestId: this.requestId(
          provider && typeof provider === 'object'
            ? provider as Record<string, unknown>
            : {},
        ),
        traceId: this.traceId(
          provider && typeof provider === 'object'
            ? provider as Record<string, unknown>
            : {},
        ),
        fetchedAt: new Date().toISOString(),
      },
    }
  }

  private notConfigured(missing: string[]): Alibaba1688Exception {
    return new Alibaba1688Exception(this.error(
      'NOT_CONFIGURED',
      `Alibaba 1688 provider is not ready. Missing configuration: ${missing.join(', ')}.`,
      false,
      null,
    ))
  }

  private invalidRequest(message: string): Alibaba1688Exception {
    return new Alibaba1688Exception(this.error(
      'INVALID_REQUEST',
      message,
      false,
      null,
    ))
  }

  private error(
    code: Alibaba1688NormalizedError['code'],
    message: string,
    retryable: boolean,
    httpStatus: number | null,
    providerCode: string | null = null,
    requestId: string | null = null,
  ): Alibaba1688NormalizedError {
    return {
      provider: ALIBABA_1688_PROVIDER,
      code,
      message,
      retryable,
      httpStatus,
      providerCode,
      requestId,
    }
  }

  private requestId(value: Record<string, unknown>): string | null {
    const candidate = value._aop_response_id ?? value.requestId ?? value.request_id
    return this.identifier(candidate)
  }

  private traceId(value: Record<string, unknown>): string | null {
    const candidate = value.traceId ?? value.trace_id
    return this.identifier(candidate)
  }

  private identifier(candidate: unknown): string | null {
    if (typeof candidate !== 'string') return null
    const sanitized = candidate.trim().replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 100)
    return sanitized || null
  }

  private safeProviderCode(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null
    const sanitized = String(value).trim().replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 80)
    return sanitized || null
  }

  private knownSecrets(): Array<string | undefined> {
    return [
      this.configService.get<string>('ALIBABA_1688_APP_SECRET'),
      this.configService.get<string>('ALIBABA_1688_ACCESS_TOKEN'),
      this.configService.get<string>('ALIBABA_1688_REFRESH_TOKEN'),
    ]
  }

  private secretConfig(name: string): string | null {
    const value = this.configService.get<string>(name)?.trim()
    if (!value || /^(?:your-|replace-|changeme|todo)/i.test(value)) return null
    return value
  }

  private safeApiPart(value: string | undefined, fallback: string): string {
    const candidate = value?.trim() || fallback
    if (!/^[A-Za-z0-9._-]+$/.test(candidate)) {
      throw this.invalidRequest('Alibaba 1688 API namespace and method contain invalid characters')
    }
    return candidate
  }

  private safeVersion(value: string | undefined): string {
    const candidate = value?.trim() || ALIBABA_1688_DEFAULTS.version
    if (!/^\d+$/.test(candidate)) {
      throw this.invalidRequest('ALIBABA_1688_PROTOCOL_VERSION must be numeric')
    }
    return candidate
  }

  private numberConfig(name: string, fallback: number, min: number, max: number): number {
    const parsed = Number(this.configService.get<string | number>(name, fallback))
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback
  }

  private clampInteger(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value)
    return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
  }

  private requiredText(value: unknown, name: string): string {
    const text = this.optionalText(value)
    if (!text) throw this.invalidRequest(`${name} is required`)
    return text
  }

  private requiredId(value: unknown, name: string): string {
    const id = this.idValue(value)
    if (!id || !/^\d+$/.test(id)) throw this.invalidRequest(`${name} must be a numeric identifier`)
    return id
  }

  private optionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }

  private textValue(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    return null
  }

  private firstText(...values: unknown[]): string | null {
    for (const value of values) {
      const text = this.textValue(value)
      if (text) return text
    }
    return null
  }

  private idValue(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    return null
  }

  private finiteNumber(value: unknown): number | null {
    const number = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(number) ? number : null
  }

  private stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value
      .map((item) => this.textValue(item))
      .filter((item): item is string => Boolean(item))
  }

  private firstHttpUrl(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === 'string' && this.isHttpUrl(value)) return value
    }
    return null
  }

  private isHttpUrl(value: string): boolean {
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }

  private offerUrl(offerId: string | null, preferred: unknown): string | null {
    const providerUrl = this.firstHttpUrl(preferred)
    if (providerUrl) return providerUrl
    return offerId ? `https://detail.1688.com/offer/${encodeURIComponent(offerId)}.html` : null
  }

  private compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(value).filter(([, child]) => child !== null && child !== undefined && child !== ''),
    ) as Partial<T>
  }
}
