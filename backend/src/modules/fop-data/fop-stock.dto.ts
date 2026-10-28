import { Type, Transform } from 'class-transformer'
import { IsArray, ArrayMaxSize, ArrayMinSize, ArrayUnique, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator'
import { STOCK_TYPES, STOCK_PURCHASE_STATUSES, STOCK_ORDER_STATUSES, STOCK_SORT_FIELDS, StockSortField, StockType, StockPurchaseStatus, StockOrderStatus } from './fop-stock.types'

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
}
export class StockOrdersQueryDto extends StockFiltersDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1
  @Type(() => Number) @IsIn([20, 50, 100]) pageSize = 50
}
export class StockInventoryQueryDto extends StockScopeDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) customerId?: string
  @IsOptional() @IsString() @MaxLength(200) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) customerSearch?: string
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1
  @Type(() => Number) @IsIn([20, 50, 100]) pageSize = 50
}
export class ExportStockOrdersDto extends StockFiltersDto {
  @IsIn(['selected', 'filtered']) mode: 'selected' | 'filtered'
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @MaxLength(200, { each: true }) orderIds?: string[]
}
