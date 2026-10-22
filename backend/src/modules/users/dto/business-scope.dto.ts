import { Transform } from 'class-transformer'
import { Allow, IsIn, ValidateBy } from 'class-validator'
import { BUSINESS_ROLES, BusinessRole } from '../business-scope'
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value
export class UpdateBusinessScopeDto {
  @IsIn(BUSINESS_ROLES)
  @ValidateBy({ name: 'businessScope', validator: { validate: (_value, args) => {
    const value = args!.object as UpdateBusinessScopeDto
    const valid = (id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 128 && id === id.trim()
    return [value.departmentId, value.employeeId].every(id => id === null || valid(id))
      && (value.role !== 'department_manager' || valid(value.departmentId))
      && (value.role !== 'salesperson' || valid(value.employeeId))
  }, defaultMessage: () => 'Managers require a department ID; salespeople require an employee ID. Use null for unassigned fields.' } })
  role: BusinessRole
  @Allow() @Transform(trim) departmentId: string | null
  @Allow() @Transform(trim) employeeId: string | null
}
