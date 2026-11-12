import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

export class ReceiptNoticesQueryDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string
  @IsOptional() @IsString() @MaxLength(128) departmentId?: string
  @IsOptional() @IsString() @MaxLength(128) ownerId?: string
  @IsOptional() @IsString() @MaxLength(128) warehouseCode?: string
  @IsOptional() @IsIn(['pending', 'partial']) status?: 'pending' | 'partial'
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1
  @IsOptional() @Type(() => Number) @IsIn([20, 50, 100]) pageSize = 20
}
