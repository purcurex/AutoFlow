import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator'
import { ApprovalQueue } from './fop-approval.types'
export class ApprovalPreviewDto {
  @IsIn(['review', 'allocation_review']) queue!: ApprovalQueue
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(128, { each: true }) orderIds!: string[]
}
export class ApprovalSelectionDto {
  @IsString() @MinLength(1) @MaxLength(128) orderId!: string
  @Matches(/^[a-f0-9]{64}$/) version!: string
}
export class ApprovalSubmitDto {
  @IsIn(['review', 'allocation_review']) queue!: ApprovalQueue
  @IsUUID('4') requestId!: string
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique((item: ApprovalSelectionDto) => item.orderId) @ValidateNested({ each: true }) @Type(() => ApprovalSelectionDto) items!: ApprovalSelectionDto[]
}
