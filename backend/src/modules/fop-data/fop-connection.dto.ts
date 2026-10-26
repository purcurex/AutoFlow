import { IsString, Matches, MaxLength } from 'class-validator'

/** 确认值只用于发现预览与提交之间的身份/公司变化，实际绑定值仍由金蝶重新认证返回。 */
export class ConfirmFopConnectionDto {
  @IsString()
  @MaxLength(128)
  @Matches(/^\S(?:.*\S)?$/)
  tenantId: string

  @IsString()
  @Matches(/^[1-9]\d{0,18}$/)
  userId: string

  @IsString()
  @Matches(/^[1-9]\d{0,18}$/)
  organizationId: string
}
