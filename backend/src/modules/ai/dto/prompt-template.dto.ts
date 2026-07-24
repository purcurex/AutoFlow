import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'
import { AI_PROMPT_MODULES, type AiPromptModuleKey } from '../prompt-template.types'

export class CreatePromptTemplateDto {
  @IsIn(AI_PROMPT_MODULES)
  moduleKey: AiPromptModuleKey

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  content: string
}

export class UpdatePromptTemplateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  content: string
}

export class ActivatePromptTemplateDto {
  @IsUUID()
  templateId: string
}
