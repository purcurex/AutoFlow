import { Type } from 'class-transformer'
import { IsInt, IsString, Matches, Max, Min } from 'class-validator'

export class FopDataAccessQueryDto {}

export class FopDashboardQueryDto {
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
