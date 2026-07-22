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
  @Matches(/^(https?:\/\/|\/uploads\/)/, {
    message: 'avatarUrl must be an HTTP URL or an uploaded asset path',
  })
  avatarUrl?: string
}
