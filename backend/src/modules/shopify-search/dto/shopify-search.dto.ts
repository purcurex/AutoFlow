import { IsString, IsUrl, MaxLength, MinLength } from 'class-validator'

export class ShopifyImageUrlSearchDto {
  @IsUrl({ require_protocol: true })
  @MaxLength(2000)
  imageUrl: string
}

export class ShopifyKeywordSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  keyword: string
}
