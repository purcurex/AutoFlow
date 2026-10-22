import { Type, Transform } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator'
import { WORKBENCH_ROLES, WorkbenchRole } from '../users/workbench-role'

export class OrderVolumeQueryDto {
  @IsIn(['carrier', 'organization', 'salesperson', 'customer']) category: 'carrier' | 'organization' | 'salesperson' | 'customer'
  @IsOptional() @IsIn(['month', 'week', 'day']) grain?: 'month' | 'week' | 'day'
  @IsOptional() @Type(() => Number) @IsInt() @Min(2020) @Max(9999) year?: number
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) weekOf?: string
  @IsOptional() @IsIn(['sales1', 'sales2', 'sales3', 'sales4']) department?: string
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) objectId?: string
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) customerId?: string
  @IsIn(['ALL', 'HZ', 'SZ', 'UNASSIGNED']) warehouse: 'ALL' | 'HZ' | 'SZ' | 'UNASSIGNED' = 'ALL'
}
export class OrderVolumeDetailsDto extends OrderVolumeQueryDto {
  @IsOptional() @IsIn(['HZ', 'SZ', 'UNASSIGNED']) detailWarehouse?: 'HZ' | 'SZ' | 'UNASSIGNED'
  @IsIn(WORKBENCH_ROLES) workbenchRole: WorkbenchRole
  @IsOptional() @IsString() @MinLength(1) @MaxLength(220) seriesId?: string
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}(?:-\d{2})?$/) periodId?: string
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20
}
export class OrderCustomerSearchDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(100) keyword: string
  @IsOptional() @IsIn(['sales1', 'sales2', 'sales3', 'sales4']) department?: string
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1
  @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize = 10
}
