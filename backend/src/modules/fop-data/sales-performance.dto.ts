import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import { PerformanceGrain } from './sales-performance.types'
export class SalesPerformanceQueryDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string
  @IsIn(['month', 'week', 'day']) grain: PerformanceGrain
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(128) ownerId?: string
  @IsOptional() @IsIn(['all']) ownerScope?: 'all'
}
export class SalesPerformanceDetailsDto extends SalesPerformanceQueryDto {
  @IsIn(['receipts', 'profit']) kind: 'receipts' | 'profit'
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}(?:-\d{2})?$/) periodId?: string
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20
}
