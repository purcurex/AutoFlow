import type {
  Alibaba1688ImageSearchDto,
  Alibaba1688ImageUploadDto,
  Alibaba1688KeywordSearchDto,
  Alibaba1688ProductDetailDto,
} from './dto/alibaba1688.dto'
import type { ALIBABA_1688_PROVIDER, ALIBABA_1688_SOURCE_TAG } from './alibaba1688.constants'

export type Alibaba1688Operation = 'keyword_search' | 'image_search' | 'product_detail' | 'image_upload'

export interface Alibaba1688Readiness {
  ready: boolean
  enabled: boolean
  missing: string[]
  provider: typeof ALIBABA_1688_PROVIDER
}

export interface Alibaba1688Endpoint {
  namespace: string
  method: string
  version: string
  signaturePath: string
  url: string
}

export interface Alibaba1688ProviderPriceInfo {
  price?: string
  jxhyPrice?: string
  pfJxhyPrice?: string
  consignPrice?: string
  promotionPrice?: string
  [key: string]: unknown
}

export interface Alibaba1688ProviderSellerData {
  tradeMedalLevel?: string
  compositeServiceScore?: string
  logisticsExperienceScore?: string
  disputeComplaintScore?: string
  offerExperienceScore?: string
  afterSalesExperienceScore?: string
  consultingExperienceScore?: string
  repeatPurchasePercent?: string
  collect30DayWithin48HPercent?: string
  qualityRefundWithin30Day?: string
  [key: string]: unknown
}

export interface Alibaba1688ProviderOffer {
  offerId?: string | number
  imageUrl?: string
  whiteImage?: string
  aigcImageUrl?: string
  subject?: string
  subjectTrans?: string
  isJxhy?: boolean
  priceInfo?: Alibaba1688ProviderPriceInfo
  repurchaseRate?: string
  monthSold?: number
  isOnePsale?: boolean
  sellerIdentities?: string[]
  offerIdentities?: string[]
  tradeScore?: string
  minOrderQuantity?: number
  sellerDataInfo?: Alibaba1688ProviderSellerData
  promotionURL?: string
  promotionUrl?: string
  [key: string]: unknown
}

export interface Alibaba1688ProviderPage {
  totalRecords?: number
  totalPage?: number
  pageSize?: number
  currentPage?: number
  data?: Alibaba1688ProviderOffer[]
  [key: string]: unknown
}

export interface Alibaba1688ProviderOperationResult<T> {
  success?: boolean | string
  code?: string | number
  message?: string
  result?: T
  [key: string]: unknown
}

export interface Alibaba1688ProviderEnvelope<T> {
  result?: Alibaba1688ProviderOperationResult<T>
  errorCode?: string | number
  errorMessage?: string
  error_code?: string | number
  error_message?: string
  requestId?: string
  request_id?: string
  traceId?: string
  trace_id?: string
  _aop_response_id?: string
  [key: string]: unknown
}

export interface Alibaba1688ProviderProductImage {
  images?: string[]
  whiteImage?: string
  [key: string]: unknown
}

export interface Alibaba1688ProviderSku {
  skuId?: string | number
  specId?: string
  amountOnSale?: number
  price?: string
  jxhyPrice?: string
  pfJxhyPrice?: string
  consignPrice?: string
  promotionPrice?: string
  cargoNumber?: string
  skuAttributes?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export interface Alibaba1688ProviderProductDetail {
  offerId?: string | number
  categoryId?: string | number
  categoryName?: string
  subject?: string
  subjectTrans?: string
  description?: string
  descriptionTrans?: string
  productImage?: Alibaba1688ProviderProductImage
  productImageTrans?: Alibaba1688ProviderProductImage
  productSkuInfos?: Alibaba1688ProviderSku[]
  productSaleInfo?: Record<string, unknown>
  productShippingInfo?: Record<string, unknown>
  sellerDataInfo?: Alibaba1688ProviderSellerData
  sellerOpenId?: string
  companyName?: string
  minOrderQuantity?: number
  batchNumber?: number
  status?: string
  soldOut?: string
  channelPrice?: Record<string, unknown>
  tradeScore?: string
  sellingPoint?: string[]
  offerIdentities?: string[]
  promotionUrl?: string
  productCargoNumber?: string
  [key: string]: unknown
}

export type Alibaba1688KeywordProviderResponse = Alibaba1688ProviderEnvelope<Alibaba1688ProviderPage>
export type Alibaba1688ImageProviderResponse = Alibaba1688ProviderEnvelope<Alibaba1688ProviderPage>
export type Alibaba1688DetailProviderResponse = Alibaba1688ProviderEnvelope<Alibaba1688ProviderProductDetail>
export type Alibaba1688ImageUploadProviderResponse = Alibaba1688ProviderEnvelope<string>

export interface Alibaba1688StablePrice {
  currency: 'CNY'
  amount: string | null
  consignAmount: string | null
  selectedSupplyAmount: string | null
  promotionAmount: string | null
}

export interface Alibaba1688StableSeller {
  openId: string | null
  companyName: string | null
  shopUrl: string | null
  identities: string[]
  tradeMedalLevel: string | null
  compositeServiceScore: string | null
  logisticsExperienceScore: string | null
  repeatPurchasePercent: string | null
}

export interface Alibaba1688StableOffer {
  provider: typeof ALIBABA_1688_PROVIDER
  sourceTag: typeof ALIBABA_1688_SOURCE_TAG
  offerId: string | null
  offerUrl: string | null
  title: string | null
  translatedTitle: string | null
  imageUrl: string | null
  price: Alibaba1688StablePrice
  minOrderQuantity: number | null
  monthSold: number | null
  repurchaseRate: string | null
  onePieceDropshipping: boolean | null
  selectedSupply: boolean | null
  tradeScore: string | null
  offerIdentities: string[]
  seller: Alibaba1688StableSeller
}

export interface Alibaba1688StableSearchResult {
  provider: typeof ALIBABA_1688_PROVIDER
  sourceTag: typeof ALIBABA_1688_SOURCE_TAG
  searchMode: 'keyword' | 'image'
  page: number
  pageSize: number
  totalRecords: number | null
  totalPages: number | null
  offers: Alibaba1688StableOffer[]
  affectsContactConfidence: false
}

export interface Alibaba1688StableSku {
  skuId: string | null
  specId: string | null
  stock: number | null
  price: string | null
  consignPrice: string | null
  attributes: Array<Record<string, unknown>>
}

export interface Alibaba1688StableProductDetail {
  provider: typeof ALIBABA_1688_PROVIDER
  sourceTag: typeof ALIBABA_1688_SOURCE_TAG
  offerId: string | null
  offerUrl: string | null
  title: string | null
  translatedTitle: string | null
  description: string | null
  categoryId: string | null
  categoryName: string | null
  imageUrls: string[]
  minOrderQuantity: number | null
  status: string | null
  sold: number | null
  tradeScore: string | null
  sellingPoints: string[]
  skus: Alibaba1688StableSku[]
  seller: Alibaba1688StableSeller
  affectsContactConfidence: false
}

export interface Alibaba1688StableImageUploadResult {
  provider: typeof ALIBABA_1688_PROVIDER
  imageId: string
}

export interface Alibaba1688CallMetadata {
  operation: Alibaba1688Operation
  provider: typeof ALIBABA_1688_PROVIDER
  requestId: string | null
  traceId: string | null
  fetchedAt: string
}

export interface Alibaba1688CallResult<TProvider, TStable> {
  provider: TProvider
  normalized: TStable
  metadata: Alibaba1688CallMetadata
}

export interface Alibaba1688NormalizedError {
  provider: typeof ALIBABA_1688_PROVIDER
  code:
    | 'NOT_CONFIGURED'
    | 'AUTHENTICATION_FAILED'
    | 'PERMISSION_DENIED'
    | 'RATE_LIMITED'
    | 'INVALID_REQUEST'
    | 'PROVIDER_REJECTED'
    | 'NETWORK_ERROR'
    | 'TIMEOUT'
    | 'INVALID_RESPONSE'
  message: string
  retryable: boolean
  httpStatus: number | null
  providerCode: string | null
  requestId: string | null
}

export type Alibaba1688RequestDto =
  | Alibaba1688KeywordSearchDto
  | Alibaba1688ImageSearchDto
  | Alibaba1688ImageUploadDto
  | Alibaba1688ProductDetailDto
