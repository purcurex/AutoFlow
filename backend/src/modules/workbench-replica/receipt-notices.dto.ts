import { Transform, Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

export class ReceiptNoticesQueryDto {
  @IsOptional() @IsIn(['fulfillment','parcel']) view?: 'fulfillment' | 'parcel'
  @IsOptional() @IsIn(['direct','stock']) parcelType?: 'direct' | 'stock'
  @IsOptional() @IsIn(['asc','desc']) shippedSort?: 'asc' | 'desc'
  /** Bypass only the local page cache; never triggers an upstream FOP query. */
  @IsOptional() @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value) @IsBoolean() refresh?: boolean
  @IsOptional() @IsString() @MaxLength(200) search?: string
  @IsOptional() @IsString() @MaxLength(128) departmentId?: string
  @IsOptional() @IsString() @MaxLength(128) ownerId?: string
  @IsOptional() @IsString() @MaxLength(128) warehouseCode?: string
  @IsOptional() @IsIn(['pending', 'partial']) status?: 'pending' | 'partial'
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1
  @IsOptional() @Type(() => Number) @IsIn([20, 50, 100, 200, 500, 1000]) pageSize = 100
}
