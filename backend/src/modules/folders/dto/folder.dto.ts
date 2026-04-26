import { IsString, IsOptional, IsArray } from 'class-validator'

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

export class ReorderFoldersDto {
  @IsArray()
  folderIds: string[]
}
