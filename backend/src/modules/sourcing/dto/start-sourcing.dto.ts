import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator'

export class StartSourcingDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  priceMin?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  priceMax?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number

}
