import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator'

export class ListSourcingDto {
  @IsOptional()
  @IsUUID()
  searchId?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @IsOptional()
  @Type(() => Number)
  @IsIn([10, 20, 50])
  pageSize?: 10 | 20 | 50
}
