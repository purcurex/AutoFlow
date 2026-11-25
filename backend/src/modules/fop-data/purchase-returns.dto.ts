import { Type, Transform } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsBoolean, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, Matches, IsNotEmpty } from 'class-validator'
import { purchaseReturnStatuses, type PurchaseReturnStatus } from './purchase-returns'
export class PurchaseReturnFiltersDto {
  @IsIn(['procurement', 'warehouse']) workbenchRole: 'procurement' | 'warehouse'
  @IsOptional() @IsIn(['asc', 'desc']) paidAtOrder: 'asc' | 'desc' = 'desc'
  @IsOptional() @IsString() @MaxLength(200) search?: string
  @IsOptional() @IsIn(purchaseReturnStatuses) status?: PurchaseReturnStatus
  @IsOptional() @IsString() @MaxLength(128) departmentId?: string
  @IsOptional() @IsString() @MaxLength(128) ownerId?: string
  @IsOptional() @IsIn(['HZ', 'SZ']) warehouseCode?: 'HZ' | 'SZ'
}
export class PurchaseReturnQueryDto extends PurchaseReturnFiltersDto {
  @IsOptional() @Transform(({value})=>value==='true'?true:value==='false'?false:value) @IsBoolean() refresh?: boolean
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1
  @IsOptional() @Type(() => Number) @IsIn([20, 50, 100, 200, 500, 1000]) pageSize = 100
}
export class PurchaseReturnExportDto extends PurchaseReturnFiltersDto {
  @IsIn(['filtered', 'selected']) mode: 'filtered' | 'selected'
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ArrayUnique() @IsString({ each: true }) @MaxLength(500, { each: true }) orderIds?: string[]
}

export class PurchaseReturnContactQueryDto {
  @IsIn(['procurement', 'warehouse']) workbenchRole: 'procurement' | 'warehouse'
  @IsString() @IsNotEmpty() @MaxLength(500) orderId: string
}
export class PurchaseReturnChatQueryDto extends PurchaseReturnContactQueryDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(128) purchaseOrderId?: string
  @IsString() @Matches(/^[a-f0-9]{64}$/) contactVersion: string
}
