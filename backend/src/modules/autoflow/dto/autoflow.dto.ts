import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsInt,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'
import { Type } from 'class-transformer'
import {
  LEAD_STATUSES,
  OUTREACH_CHANNELS,
  OUTREACH_STATUSES,
  SEED_TYPES,
  type OutreachChannel,
  type OutreachStatus,
  type SeedType,
  type LeadStatus,
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

}

export class UpdateLeadStatusDto {
  @IsIn(LEAD_STATUSES)
  status: LeadStatus

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string
}

export class ListWorkflowsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20
}

export class ListLeadsQueryDto extends ListWorkflowsQueryDto {
  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: LeadStatus

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string

  @IsOptional()
  @IsUUID()
  workflowRunId?: string
}

export class ListOutreachTasksQueryDto extends ListWorkflowsQueryDto {
  @IsOptional()
  @IsIn(OUTREACH_STATUSES)
  status?: OutreachStatus

  @IsOptional()
  @IsUUID()
  leadId?: string
}
