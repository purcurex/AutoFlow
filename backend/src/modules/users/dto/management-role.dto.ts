import { IsEnum } from 'class-validator'
import { UserRole } from '../user.entity'

export class UpdateManagementRoleDto {
  @IsEnum(UserRole)
  role: UserRole
}
