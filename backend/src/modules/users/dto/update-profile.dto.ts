import { IsIn, IsOptional, ValidateIf, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class UpdateProfileDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['department', 'self'])
  dataDisplayScope?: 'department' | 'self'

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  username?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^(?:https?:\/\/|\/uploads\/|\/avatars\/preset-(?:ocean|mint|iris|rose|amber|slate|navy|graphite|cedar|ink|summit|sail|violet|blush|peony|pearl|butterfly|swan)\.svg$)/, {
    message: 'avatarUrl must be an HTTP URL, uploaded asset path or supported preset',
  })
  avatarUrl?: string
}
