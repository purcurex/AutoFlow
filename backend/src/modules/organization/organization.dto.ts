import { Transform, Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested, ValidateBy } from 'class-validator'
import { WORKBENCH_ROLES, WorkbenchRole } from '../users/workbench-role'
import { UpdateFopBindingDto } from '../users/dto/fop-binding.dto'

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

export class CreateEmployeeAccountDto {
  @Transform(trimName) @IsString() @MinLength(2) @MaxLength(50) username: string
  @IsString() @MinLength(10) @MaxLength(72)
  @ValidateBy({ name: 'passwordBytes', validator: { validate: value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72 } }, { message: '密码 UTF-8 长度不能超过 72 字节' })
  password: string
  @IsOptional() @IsObject() @ValidateNested() @Type(() => UpdateFopBindingDto) fopBinding?: UpdateFopBindingDto | null
}

export class EmployeeProfileDto {
  @Transform(trimName) @IsString() @MinLength(1) @MaxLength(100) name: string
  @Transform(trimName) @IsString() @MinLength(1) @MaxLength(40) code: string
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value) @IsEmail() @MaxLength(160) email: string
  @ValidateIf((_o, value) => value !== undefined) @Transform(trimName) @IsString() @MaxLength(100) jobTitle?: string
  @ValidateIf((_o, value) => value !== undefined) @Transform(trimName) @IsString() @MaxLength(40) phone?: string
}

export class UpdateOrganizationEmployeeDto extends EmployeeProfileDto {
  @IsUUID() departmentId: string
  @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsIn(WORKBENCH_ROLES, { each: true }) workbenchRoles: WorkbenchRole[]
}

export class CreateOrganizationEmployeeDto extends UpdateOrganizationEmployeeDto {
  @IsOptional() @IsObject() @ValidateNested() @Type(() => CreateEmployeeAccountDto) account?: CreateEmployeeAccountDto | null
}

export class ImportOrganizationEmployeesDto {
  @IsUUID() departmentId: string
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => EmployeeProfileDto) employees: EmployeeProfileDto[]
}
export class RemoveOrganizationEmployeesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsUUID('all', { each: true }) ids: string[]
}
export class UpdateEmployeeAccountDto {
  @Transform(trimName) @IsString() @MinLength(2) @MaxLength(50) username: string
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value) @IsEmail() @MaxLength(160) email: string
  @ValidateIf((_o, value) => value !== undefined) @IsString() @MinLength(10) @MaxLength(72)
  @ValidateBy({ name: 'passwordBytes', validator: { validate: value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72 } }) password?: string
  @IsOptional() @IsObject() @ValidateNested() @Type(() => UpdateFopBindingDto) fopBinding?: UpdateFopBindingDto | null
}
