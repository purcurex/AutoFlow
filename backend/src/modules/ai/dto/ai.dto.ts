import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

const AI_ACTIONS = ['continue', 'polish', 'summarize', 'translate', 'expand', 'condense'] as const

export class GenerateAiTextDto {
  @IsIn(AI_ACTIONS)
  action: (typeof AI_ACTIONS)[number]

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  content: string

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  context?: string
}

export class SuggestTagsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  content: string
}
