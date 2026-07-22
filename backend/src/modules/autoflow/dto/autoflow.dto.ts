import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'
import {
  OUTREACH_CHANNELS,
  OUTREACH_STATUSES,
  SEED_TYPES,
  type OutreachChannel,
  type OutreachStatus,
  type SeedType,
} from '../autoflow.types'

export class CreateWorkflowDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string

  @IsIn(SEED_TYPES)
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
  @IsIn(OUTREACH_CHANNELS)
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
  @IsIn(OUTREACH_STATUSES)
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
