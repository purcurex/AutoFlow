import { Transform } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator'

const trimName = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value

export class OrganizationQueryDto {}

export class CreateOrganizationNodeDto {
  @IsUUID() parentId: string
  @Transform(trimName) @IsString() @MinLength(1) @MaxLength(100) name: string
  @IsOptional() @IsIn(['department']) kind = 'department' as const
  @IsOptional() @IsInt() @Min(0) @Max(99999) sortOrder = 0
}

export class UpdateOrganizationNodeDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trimName) @IsString() @MinLength(1) @MaxLength(100) name?: string
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID() parentId?: string
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt() @Min(0) @Max(99999) sortOrder?: number
}

export class AssignOrganizationEmployeeDto {
  @IsUUID() departmentId: string
}
