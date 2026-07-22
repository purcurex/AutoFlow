import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator'

export class SearchFiltersDto {
  @IsOptional()
  @IsBoolean()
  activeOnly?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  daysRange?: number
}

export class FacebookImageSearchDto {
  @IsUrl({ require_protocol: true })
  @MaxLength(2000)
  imageUrl: string

  @IsOptional()
  @ValidateNested()
  @Type(() => SearchFiltersDto)
  filters?: SearchFiltersDto
}

export class FacebookKeywordSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  keyword: string

  @IsOptional()
  @ValidateNested()
  @Type(() => SearchFiltersDto)
  filters?: SearchFiltersDto
}
