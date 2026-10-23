import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'
import { WORKBENCH_ROLES, WorkbenchRole } from '../users/workbench-role'
import { FreightCarrier, FreightGrain } from './fop-freight.types'
export class FreightQueryDto {
  @IsIn(['month', 'week', 'year']) grain: FreightGrain
  @Type(() => Number) @IsInt() @Min(2020) @Max(9999) year: number
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) weekOf?: string
  @IsIn(['ALL', 'HZ', 'SZ']) warehouse: 'ALL' | 'HZ' | 'SZ' = 'ALL'
  @IsOptional() @IsIn(['YT', '4PX', 'WB', 'YW', 'JS', 'OTHER']) carrierCode?: FreightCarrier
}
export class FreightDetailsDto extends FreightQueryDto {
  @IsOptional() @IsString() @Matches(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/) periodId?: string
  @IsOptional() @IsIn(['current', 'previous']) comparisonPeriod?: 'current' | 'previous'
  @IsIn(WORKBENCH_ROLES) workbenchRole: WorkbenchRole
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20
}
