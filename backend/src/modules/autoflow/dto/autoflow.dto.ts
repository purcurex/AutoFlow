import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'
import { OutreachChannel, OutreachStatus, SeedType } from '../autoflow.types'

export class CreateWorkflowDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string

  @IsEnum(['keyword', 'image'])
  seedType: SeedType

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  seedValue: string

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  targetMarket: string
}

export class CreateLeadMessageDto {
  @IsOptional()
  @IsEnum(['whatsapp', 'email', 'instagram', 'facebook'])
  channel?: OutreachChannel

  @IsOptional()
  @IsString()
  @MaxLength(500)
  angle?: string
}

export class UpdateOutreachTaskDto {
  @IsOptional()
  @IsEnum(['draft', 'ready', 'sent', 'replied', 'skipped'])
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
