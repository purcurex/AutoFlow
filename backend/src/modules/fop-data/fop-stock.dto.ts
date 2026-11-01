import { Type, Transform } from 'class-transformer'
import { IsArray, ArrayMaxSize, ArrayMinSize, ArrayUnique, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator'
import { STOCK_TYPES, STOCK_PURCHASE_STATUSES, STOCK_ORDER_STATUSES, STOCK_SORT_FIELDS, STOCK_LIFECYCLES, StockLifecycle, StockSortField, StockType, StockPurchaseStatus, StockOrderStatus } from './fop-stock.types'

export class StockScopeDto {
  @IsOptional() @IsString() @MaxLength(200) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) search?: string
  @IsOptional() @IsIn(['HZ', 'SZ']) warehouseCode?: string
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) departmentId?: string
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) ownerId?: string
}
export class StockFiltersDto extends StockScopeDto {
  @IsOptional() @IsIn(['all', 'procurement']) queue?: 'all' | 'procurement'
  @IsOptional() @IsIn(STOCK_TYPES) stockType?: StockType
  @IsOptional() @IsIn(STOCK_PURCHASE_STATUSES) purchaseStatus?: StockPurchaseStatus
  @ValidateIf((_object, value) => value !== undefined) @IsIn(STOCK_ORDER_STATUSES) orderStatus?: StockOrderStatus
  @ValidateIf((_object, value) => value !== undefined) @IsIn(STOCK_SORT_FIELDS) sortBy?: StockSortField
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc'
  @ValidateIf((_object, value) => value !== undefined) @IsIn(STOCK_LIFECYCLES) lifecycle?: StockLifecycle
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['all', '1w', '1m', '3m']) timeRange?: 'all' | '1w' | '1m' | '3m'
}
export class StockOrdersQueryDto extends StockFiltersDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1
  @Type(() => Number) @IsIn([20, 50, 100]) pageSize = 50
}
export class StockInventoryQueryDto extends StockScopeDto {
  @ValidateIf((_object, value) => value !== undefined) @Transform(({ value }) => typeof value === 'string' ? [value] : value)
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(200, { each: true }) orderIds?: string[]
  @IsOptional() @IsIn(['all', 'procurement']) queue?: 'all' | 'procurement'
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) customerId?: string
  @IsOptional() @IsString() @MaxLength(200) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) customerSearch?: string
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1
  @Type(() => Number) @IsIn([20, 50, 100]) pageSize = 50
}
export class ExportStockOrdersDto extends StockFiltersDto {
  @IsIn(['selected', 'filtered']) mode: 'selected' | 'filtered'
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @MaxLength(200, { each: true }) orderIds?: string[]
}
