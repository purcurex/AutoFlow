import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'
import type { OutreachChannel, OutreachStatus, SeedType } from '../autoflow.types'

export class CreateWorkflowDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string

  @IsIn(['keyword', 'image'])
  seedType: SeedType

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  seedValue: string

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  targetMarket?: string
}

export class GenerateMessageDto {
  @IsOptional()
  @IsIn(['whatsapp', 'email', 'instagram', 'facebook'])
  channel?: OutreachChannel

  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  offer?: string
}

export class UpdateOutreachTaskDto {
  @IsOptional()
  @IsIn(['draft', 'ready', 'sent', 'replied', 'skipped'])
  status?: OutreachStatus

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string

  @IsOptional()
  @IsISO8601()
  nextFollowUpAt?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  owner?: string
}
