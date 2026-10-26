import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'
import { WORKBENCH_ROLES, WorkbenchRole } from '../workbench-role'

export class ListWorkbenchAccountsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string
}

export class UpdateWorkbenchRolesDto {
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsIn(WORKBENCH_ROLES, { each: true })
  workbenchRoles: WorkbenchRole[]
}

export const FULFILLMENT_QUEUE_ROLES = {
  unpaid: 'sales',
  review: 'sales',
  exceptions: 'sales',
  procurement: 'procurement',
  procurement_shipping: 'procurement',
  allocation: 'allocation',
  allocation_review: 'allocation',
  dispatch: 'dispatch',
  shipping: 'warehouse',
} as const

export const FULFILLMENT_SORT_FIELDS = ['paidAt', 'dispatchDocumentStatus', 'allocationDocumentStatus', 'outboundStatus'] as const
export type FulfillmentSortBy = typeof FULFILLMENT_SORT_FIELDS[number]

export class FulfillmentOrderFiltersDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string

  @IsOptional()
  @IsIn(FULFILLMENT_SORT_FIELDS)
  sortBy?: FulfillmentSortBy

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc'

  @IsOptional()
  @IsIn(['asc', 'desc'])
  paidAtOrder?: 'asc' | 'desc' = 'asc'

  @IsOptional()
  @IsIn(['all', 'pending_review', 'pending_outbound'])
  warehouseStage?: 'all' | 'pending_review' | 'pending_outbound'

  @IsIn(Object.keys(FULFILLMENT_QUEUE_ROLES))
  queue: keyof typeof FULFILLMENT_QUEUE_ROLES

  @IsOptional()
  @IsIn(WORKBENCH_ROLES)
  workbenchRole?: WorkbenchRole

  @IsOptional()
  @IsString()
  @MaxLength(100)
  orderNumber?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  departmentId?: string
}

export class ListFulfillmentOrdersDto extends FulfillmentOrderFiltersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20
}

export class ExportFulfillmentOrdersDto extends FulfillmentOrderFiltersDto {
  @IsIn(['selected', 'filtered'])
  mode: 'selected' | 'filtered'

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(128, { each: true })
  orderIds?: string[]
}
