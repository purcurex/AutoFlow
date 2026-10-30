import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Matches, Min, MinLength, ValidateIf } from 'class-validator'
import { purchaseStages, type PurchaseStage, type PurchaseQueue } from './procurement-groups.types'
export class PurchaseGroupFiltersDto {
  @IsOptional() @IsIn(purchaseStages) purchaseStage?: PurchaseStage
  @IsIn(['procurement', 'procurement_shipping']) queue!: PurchaseQueue
  @IsOptional() @IsString() @MaxLength(200) search?: string
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) departmentId?: string
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) ownerId?: string
  @IsOptional() @IsIn(['HZ', 'SZ']) warehouseCode?: string
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc'
}
export class PurchaseGroupQueryDto extends PurchaseGroupFiltersDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1
  @Type(() => Number) @IsIn([20, 50, 100]) pageSize = 50
}
export class PurchaseGroupExportDto extends PurchaseGroupFiltersDto {
  @IsIn(['selected', 'filtered']) mode!: 'selected' | 'filtered'
  @ValidateIf((_o, v) => v !== undefined) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(520, { each: true }) groupIds?: string[]
}

export class PurchaseGroupChatQueryDto extends PurchaseGroupFiltersDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/) contactVersion!: string
}
