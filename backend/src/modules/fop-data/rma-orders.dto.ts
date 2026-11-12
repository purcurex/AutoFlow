import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { rmaTypes, type RmaType } from './rma-orders'
export class RmaFiltersDto {
  @IsOptional() @IsIn(rmaTypes) type?: RmaType
  @IsOptional() @IsIn(['active', 'closed', 'all']) flowStatus: 'active' | 'closed' | 'all' = 'active'
  @IsOptional() @IsString() @MaxLength(200) search?: string
  @IsOptional() @IsString() @MaxLength(128) departmentId?: string
  @IsOptional() @IsString() @MaxLength(128) ownerId?: string
  @IsOptional() @IsIn(['HZ', 'SZ']) warehouseCode?: 'HZ' | 'SZ'
}
export class RmaQueryDto extends RmaFiltersDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1
  @IsOptional() @Type(() => Number) @IsIn([20, 50, 100]) pageSize = 50
}
export class RmaExportDto extends RmaFiltersDto {
  @IsIn(['selected', 'filtered']) mode: 'selected' | 'filtered'
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @MaxLength(500, { each: true }) caseIds?: string[]
}
