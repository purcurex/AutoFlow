export interface Alibaba1688SaleFilterDto {
  saleType: string
  saleStart?: string
  saleEnd?: string
}
export interface Alibaba1688KeywordSearchDto {
  keyword: string
  beginPage?: number
  pageSize?: number
  filter?: string
  sort?: string
  outMemberId?: string
  priceStart?: string
  priceEnd?: string
  categoryId?: number
  country?: string
  regionOpp?: string
  productCollectionId?: string
  snId?: string
  keywordTranslate?: boolean
  categoryIdList?: string
  saleFilterList?: Alibaba1688SaleFilterDto[]
}

export interface Alibaba1688ImageSearchDto {
  imageId: string
  beginPage?: number
  pageSize?: number
  outMemberId?: string
  country?: string
}

export interface Alibaba1688ImageUploadDto {
  imageBase64: string
  outMemberId?: string
}

export interface Alibaba1688ProductDetailDto {
  offerId: string | number
  country?: string
  outMemberId?: string
}
