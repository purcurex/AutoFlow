import { IsString, IsOptional } from 'class-validator'

export class CreateFolderDto {
  @IsString()
  name: string

  @IsOptional()
  @IsString()
  parentId?: string
}

export class UpdateFolderDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsString()
  parentId?: string

  @IsOptional()
  sortOrder?: number
}
