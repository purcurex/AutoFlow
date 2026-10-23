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
  registerDecorator,
  type ValidationArguments,
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

const WORKFLOW_ASSET_FIELDS = [
  'seedAssetPath',
  'seedAssetMimeType',
  'seedAssetSize',
  'seedAssetSha256',
] as const

type WorkflowAssetField = (typeof WORKFLOW_ASSET_FIELDS)[number]

/**
 * 工作流图片资产四项元数据必须成组出现，且只允许图片工作流提交。
 * 这里在HTTP入口完成结构校验，真实文件归属仍由服务层基于当前用户再次确认。
 */
function IsWorkflowAssetField(field: WorkflowAssetField): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isWorkflowAssetField',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      constraints: [field],
      validator: {
        validate(value: unknown, arguments_: ValidationArguments): boolean {
          const workflow = arguments_.object as CreateWorkflowDto
          const hasAnyAssetField = WORKFLOW_ASSET_FIELDS.some(
            (assetField) => workflow[assetField] !== undefined && workflow[assetField] !== null,
          )
          if (workflow.seedType !== 'image') return value === undefined || value === null
          if (!hasAnyAssetField) return true
          if (value === undefined || value === null) return false
          if (field === 'seedAssetPath') {
            return typeof value === 'string'
              && /^\/uploads\/workflow-seeds\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(value)
          }
          if (field === 'seedAssetMimeType') {
            return ['image/jpeg', 'image/png', 'image/webp'].includes(String(value))
          }
          if (field === 'seedAssetSize') {
            return typeof value === 'number'
              && Number.isInteger(value)
              && value > 0
              && value <= 8 * 1024 * 1024
          }
          return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
        },
        defaultMessage(arguments_: ValidationArguments): string {
          return `${arguments_.property} is invalid for the selected workflow seed type`
        },
      },
    })
  }
}

/**
 * 工作流种子由显式 seedType 决定含义；图片种子必须是可由后端处理的 HTTP/HTTPS URL。
 * 这里仅校验 URL 结构，图片可达性、类型、大小和 SSRF 防护仍由寻源图片解析服务执行。
 */
function IsWorkflowSeedValue(): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isWorkflowSeedValue',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      validator: {
        validate(value: unknown, arguments_: ValidationArguments): boolean {
          if (typeof value !== 'string') return false
          const workflow = arguments_.object as CreateWorkflowDto
          if (workflow.seedType !== 'image') return true
          try {
            const imageUrl = new URL(value.trim())
            return imageUrl.protocol === 'http:' || imageUrl.protocol === 'https:'
          } catch {
            return false
          }
        },
        defaultMessage(): string {
          return 'seedValue must be a public HTTP or HTTPS image URL for an image workflow'
        },
      },
    })
  }
}

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
  @IsWorkflowSeedValue()
  seedValue: string

  @IsWorkflowAssetField('seedAssetPath')
  seedAssetPath?: string

  @IsWorkflowAssetField('seedAssetMimeType')
  seedAssetMimeType?: 'image/jpeg' | 'image/png' | 'image/webp'

  @IsWorkflowAssetField('seedAssetSize')
  seedAssetSize?: number

  @IsWorkflowAssetField('seedAssetSha256')
  seedAssetSha256?: string

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
