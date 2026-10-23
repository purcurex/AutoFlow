import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator'
import { WORKBENCH_ROLES, WorkbenchRole } from '../users/workbench-role'

export class ReceiptQueryDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string
  @IsOptional() @IsIn(['sales1', 'sales2', 'sales3', 'sales4']) department?: string
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) ownerId?: string
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) customerId?: string
  @IsIn(['ALL', 'HZ', 'SZ']) warehouse: 'ALL' | 'HZ' | 'SZ' = 'ALL'
  @IsOptional() @IsIn(['fulfillment', 'full_payment_stock']) sourceType?: 'fulfillment' | 'full_payment_stock'
  @IsIn(WORKBENCH_ROLES) workbenchRole: WorkbenchRole
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20
}
