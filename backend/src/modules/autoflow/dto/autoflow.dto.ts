import {
  IsIn,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsInt,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  IsUrl,
} from 'class-validator'
import { Type } from 'class-transformer'
import {
  LEAD_STATUSES,
  DEFAULT_GOOGLE_SEARCH_OPTIONS,
  OUTREACH_CHANNELS,
  OUTREACH_STATUSES,
  OUTREACH_QUOTE_MODES,
  SEED_TYPES,
  type OutreachChannel,
  type OutreachStatus,
  type OutreachQuoteMode,
  type SeedType,
  type LeadStatus,
} from '../autoflow.types'

export class GoogleSearchOptionsDto {
  @IsOptional()
  @IsBoolean()
  exactPhrase?: boolean = DEFAULT_GOOGLE_SEARCH_OPTIONS.exactPhrase

  @IsOptional()
  @IsBoolean()
  titleMatch?: boolean = DEFAULT_GOOGLE_SEARCH_OPTIONS.titleMatch

  @IsOptional()
  @IsBoolean()
  excludeMarketplaces?: boolean = DEFAULT_GOOGLE_SEARCH_OPTIONS.excludeMarketplaces

  @IsOptional()
  @IsBoolean()
  findOwnerFacebook?: boolean = DEFAULT_GOOGLE_SEARCH_OPTIONS.findOwnerFacebook
}

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

  @IsOptional()
  @ValidateNested()
  @Type(() => GoogleSearchOptionsDto)
  searchOptions?: GoogleSearchOptionsDto
}

export class CreateWorkflowRevisionDto extends CreateWorkflowDto {}

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

  @IsOptional()
  @IsString()
  @MaxLength(500)
  targetContact?: string

  @IsOptional()
  @IsIn(OUTREACH_QUOTE_MODES)
  quoteMode?: OutreachQuoteMode

  @IsOptional()
  @IsBoolean()
  includeProductVisual?: boolean

  @IsOptional()
  @IsBoolean()
  emphasizeSupplier?: boolean

  @IsOptional()
  @IsBoolean()
  emphasizeLogistics?: boolean

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  productImageUrl?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  verifiedQuoteContext?: string
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
