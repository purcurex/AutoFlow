import { businessScope, BusinessRole } from './business-scope'
import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { UsersService } from './users.service'
import { UserRole } from './user.entity'
import { isWorkbenchRole, WORKBENCH_ROLES, WorkbenchRole } from './workbench-role'
import { ListWorkbenchAccountsDto } from './dto/workbench.dto'

export interface WorkbenchAccess {
  roles: WorkbenchRole[]
  isAdmin: boolean
  businessRole: BusinessRole
}

@Injectable()
export class WorkbenchAccessService {
  constructor(private readonly usersService: UsersService) {}

  // Only the authenticated user ID is accepted. JWT grants are deliberately ignored:
  // revocations and administrator demotions take effect on the next request.
  async getAccess(userId: string): Promise<WorkbenchAccess> {
    const user = await this.usersService.findById(userId)
    if (!user) throw new UnauthorizedException('Account no longer exists')
    const isAdmin = user.role === UserRole.ADMIN
    const businessRole = businessScope(user).role
    return {
      roles: businessRole === 'none' ? [] : businessRole === 'admin' ? [...WORKBENCH_ROLES] : (user.workbenchRoles ?? []).filter(isWorkbenchRole),
      isAdmin,
      businessRole,
    }
  }

  async requireRole(userId: string, role: string): Promise<WorkbenchAccess> {
    if (!isWorkbenchRole(role)) throw new BadRequestException('Unknown workbench role')
    const access = await this.getAccess(userId)
    if (!access.roles.includes(role)) throw new ForbiddenException('Workbench access denied')
    return access
  }

  async requireAdmin(userId: string): Promise<void> {
    if (!(await this.getAccess(userId)).isAdmin) throw new ForbiddenException('Administrator access required')
  }

  async listAccounts(actorId: string, query: ListWorkbenchAccountsDto) {
    await this.requireAdmin(actorId)
    return this.usersService.listWorkbenchAccounts(query)
  }

  async updateRoles(actorId: string, targetId: string, roles: WorkbenchRole[]) {
    await this.requireAdmin(actorId)
    return this.usersService.updateWorkbenchRoles(targetId, roles)
  }
}
