import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

class FopCostTierDto {
  @IsInt()
  @Min(1)
  minQuantity: number

  @IsOptional()
  @IsInt()
  @Min(1)
  maxQuantity?: number
}

export class FopProductCostLookupDto {
  @IsUUID()
  lineId: string

  @IsString()
  @MaxLength(160)
  productReference: string

  @IsString()
  @MaxLength(40)
  unit: string

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency: string

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99.99)
  productProfitMarginRate: number

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => FopCostTierDto)
  quantityTiers: FopCostTierDto[]
}
