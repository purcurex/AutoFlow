import { IsString, IsOptional, IsBoolean, IsEnum, IsArray, IsNumber, IsNotEmpty } from 'class-validator'
import { EditorType } from '../note.entity'

export class CreateNoteDto {
  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  content?: string

  @IsOptional()
  @IsString()
  folderId?: string

  @IsOptional()
  @IsEnum(EditorType)
  editorType?: EditorType

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[]
}

export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  content?: string

  @IsOptional()
  @IsString()
  folderId?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[]

  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean

  @IsOptional()
  @IsNumber()
  sortOrder?: number
}

export class ReorderNotesDto {
  @IsArray()
  @IsString({ each: true })
  noteIds: string[]
}

export class ExportNotesDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  noteIds: string[]
}
