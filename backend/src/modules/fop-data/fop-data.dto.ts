import { Transform, Type } from 'class-transformer'
import { IsBoolean, IsOptional, IsInt, IsString, Matches, Max, Min } from 'class-validator'

export class FopDataAccessQueryDto {}

export class FopDashboardQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'false' ? false : value === 'true' ? true : value)
  @IsBoolean()
  includeQueues?: boolean

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from: string

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to: string

  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(9999)
  year: number
}

export class SupplierChatQueryDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  contactVersion: string
}
