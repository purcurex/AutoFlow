import { IsOptional, IsString, Matches, MaxLength } from 'class-validator'
export const FOP_EMPLOYEE_BINDER = Symbol('FOP_EMPLOYEE_BINDER')

/** 金蝶目录中的真实任职行；用户认证ID、人员记录ID和业务masterId分别保留，禁止互相猜测。 */
export interface FopBindingEmployee {
  /** FOP 人员工号；不得用用户名、记录 ID 或 masterId 代替。 */
  employeeNumber?: string | null
  id: string
  masterId: string
  membershipId: string
  departmentId: string
  name: string
  username: string
  state: 'active' | 'disabled' | 'unknown'
}
export interface FopBindingEmployeePage {
  items: FopBindingEmployee[]
  nextCursor: string | null
  scopeVersion: string
}

/** 只保存经平台认证和目录复核的映射，不保存员工密码或任何访问令牌。 */
export interface FopEmployeeBindingDetails {
  /** 旧绑定可能未记录工号，重新绑定时必须经目录核验。 */
  employeeNumber?: string | null
  username: string
  name: string
  employeeRecordId: string
  employeeMasterId: string
  departmentId: string
  organizationId: string
  localEmployeeId: string | null
  localDepartmentId: string | null
  verifiedAt: string
}
export interface VerifiedFopEmployeeBinding {
  tenantId: string
  userId: string
  details: FopEmployeeBindingDetails
  /** 后端管理员验证流程的瞬时会话快照，不入库、不接受客户端输入。 */
  actorSessionVersion?: number
}

export class FopEmployeesQueryDto {
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,18}:[1-9]\d{0,18}$/)
  cursor?: string
  @IsOptional() @IsString() @MaxLength(128) @Matches(/^[a-f0-9]{64}$/)
  scopeVersion?: string
}
export class BindFopEmployeeDto {
  @IsString() @Matches(/^\S{1,128}$/u) employeeNumber: string
  @IsString() @Matches(/^[1-9]\d{0,18}$/) employeeId: string
  @IsString() @Matches(/^[1-9]\d{0,18}$/) membershipId: string
}
