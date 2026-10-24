import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
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
  review: 'sales',
  exceptions: 'sales',
  procurement: 'procurement',
  allocation: 'allocation',
  dispatch: 'dispatch',
  shipping: 'warehouse',
} as const

export class ListFulfillmentOrdersDto extends ListWorkbenchAccountsDto {
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
