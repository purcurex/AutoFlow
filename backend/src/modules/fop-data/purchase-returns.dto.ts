import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { purchaseReturnStatuses, type PurchaseReturnStatus } from './purchase-returns'
export class PurchaseReturnFiltersDto {
  @IsIn(['procurement', 'warehouse']) workbenchRole: 'procurement' | 'warehouse'
  @IsOptional() @IsIn(['asc', 'desc']) paidAtOrder: 'asc' | 'desc' = 'asc'
  @IsOptional() @IsString() @MaxLength(200) search?: string
  @IsOptional() @IsIn(purchaseReturnStatuses) status?: PurchaseReturnStatus
  @IsOptional() @IsString() @MaxLength(128) departmentId?: string
  @IsOptional() @IsString() @MaxLength(128) ownerId?: string
  @IsOptional() @IsIn(['HZ', 'SZ']) warehouseCode?: 'HZ' | 'SZ'
}
export class PurchaseReturnQueryDto extends PurchaseReturnFiltersDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1
  @IsOptional() @Type(() => Number) @IsIn([20, 50, 100]) pageSize = 50
}
export class PurchaseReturnExportDto extends PurchaseReturnFiltersDto {
  @IsIn(['filtered', 'selected']) mode: 'filtered' | 'selected'
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @MaxLength(500, { each: true }) orderIds?: string[]
}
