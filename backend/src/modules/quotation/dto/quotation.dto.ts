import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

const MONEY_PATTERN = /^(?!0(?:\.0{1,4})?$)(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/

export class QuoteTierDto {
  @IsInt()
  @Min(1)
  minQuantity: number

  @IsOptional()
  @IsInt()
  @Min(1)
  maxQuantity?: number

  @IsString()
  @Matches(MONEY_PATTERN, { message: 'customerUnitPrice must be a positive decimal with up to 4 places' })
  customerUnitPrice: string
}

export class QuoteProductDto {
  @IsUUID()
  lineId: string

  @IsString()
  @MaxLength(160)
  productReference: string

  @IsString()
  @MaxLength(40)
  unit: string

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => QuoteTierDto)
  quantityTiers: QuoteTierDto[]
}

export class QuotePackageDto {
  @IsInt()
  @Min(1)
  @Max(10000)
  quantity: number

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  weight: number

  @IsString()
  @Matches(/^(kg|lb)$/)
  weightUnit: string

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  length: number

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  width: number

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  height: number

  @IsString()
  @Matches(/^(cm|in)$/)
  dimensionUnit: string
}

export class QuoteDraftDto {
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency: string

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuoteProductDto)
  products: QuoteProductDto[]

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @Matches(/^[A-Z]{2}$/, { each: true })
  destinationCountries: string[]

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => QuotePackageDto)
  packages: QuotePackageDto[]
}

export class CreateQuotationDto extends QuoteDraftDto {
  @IsOptional()
  @IsUUID()
  leadId?: string

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string

  @IsOptional()
  @IsISO8601()
  validUntil?: string
}

export class ListQuotationsQueryDto {
  @IsOptional()
  @IsUUID()
  leadId?: string
}
