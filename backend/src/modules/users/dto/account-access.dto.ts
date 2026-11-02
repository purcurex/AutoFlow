import { Type } from 'class-transformer'
import { IsDefined, IsIn, ValidateNested } from 'class-validator'
import { ACCOUNT_ROLES, AccountRole } from '../account-role'
import { UpdateBusinessScopeDto } from './business-scope.dto'
import { UpdateWorkbenchRolesDto } from './workbench.dto'

export class UpdateAccountAccessDto extends UpdateWorkbenchRolesDto {
  @IsIn(ACCOUNT_ROLES)
  accountRole: AccountRole

  @IsDefined()
  @ValidateNested()
  @Type(() => UpdateBusinessScopeDto)
  businessScope: UpdateBusinessScopeDto
}
