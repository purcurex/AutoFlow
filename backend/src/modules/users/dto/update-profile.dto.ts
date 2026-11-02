import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  username?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^(?:https?:\/\/|\/uploads\/|\/avatars\/preset-(?:ocean|mint|iris|rose|amber|slate)\.svg$)/, {
    message: 'avatarUrl must be an HTTP URL, uploaded asset path or supported preset',
  })
  avatarUrl?: string
}
