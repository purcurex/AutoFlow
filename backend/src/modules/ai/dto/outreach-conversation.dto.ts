import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator'
import {
  OUTREACH_CHANNELS,
  OUTREACH_QUOTE_MODES,
  type OutreachChannel,
  type OutreachQuoteMode,
} from '../../autoflow/autoflow.types'

export class CreateOutreachConversationDto {
  @IsUUID()
  leadId: string

  @IsOptional()
  @IsIn(OUTREACH_CHANNELS)
  channel?: OutreachChannel

  @IsOptional()
  @IsString()
  @MaxLength(500)
  manualTarget?: string

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

  @IsOptional()
  @IsString()
  @MaxLength(500)
  offer?: string

  @IsOptional()
  @IsIn(['zh-CN', 'en'])
  responseLanguage?: 'zh-CN' | 'en'
}

export class SendOutreachConversationMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  content: string
}

export class ListOutreachConversationsQueryDto {
  @IsUUID()
  leadId: string
}

export class UpdateOutreachDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  englishSubject?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(6000)
  englishMessage?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  chineseSubject?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(6000)
  chineseMessage?: string
}
