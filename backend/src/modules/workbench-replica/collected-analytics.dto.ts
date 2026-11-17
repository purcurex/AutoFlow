import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class CollectedAnalyticsQueryDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) departmentId?: string
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) ownerId?: string
}

export class DashboardAnalyticsQueryDto extends CollectedAnalyticsQueryDto {
 @IsOptional() @IsIn(['week','month']) comparison?:'week'|'month'
 @IsIn(['department_receipts','salesperson_receipts','order_volume','customer_orders','registrations']) chartId: 'department_receipts'|'salesperson_receipts'|'order_volume'|'customer_orders'|'registrations'
 @IsOptional() @IsString() @MaxLength(128) warehouseCode?:string
 @IsOptional() @Matches(/^[A-Z]{3}$/) currency?:string
 @IsOptional() @IsIn(['fulfillment','stock']) entityType?:string
}
