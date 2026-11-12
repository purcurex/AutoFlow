import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { DataSource, FindOperator, In, IsNull } from 'typeorm'
import { User } from './user.entity'
import { OrganizationEmployeeEntity } from '../organization/organization-employee.entity'
import { effectiveBusinessScope } from './business-scope'
import { validateChartPermissions } from './chart-permissions'

/** Server-owned account assignments govern every local business read.
 * System administrators use their local company workspace; other roles retain
 * their assigned employee/department and bound FOP tenant/company boundaries.
 */
export async function readBusinessOwners(dataSource: DataSource, actorId: string): Promise<{ ids: string[]; filter: string | FindOperator<string> }> {
  const repository = dataSource.getRepository(User)
  const actor = await repository.findOne({ where: { id: actorId } })
  if (!actor) throw new UnauthorizedException('Account no longer exists')
  const scope = effectiveBusinessScope(actor)
  if (scope.role === 'none') throw new ForbiddenException({ code: 'business_access_disabled', message: 'Business data access is disabled for this account' })
  if (actor.role === 'admin') {
    const employees = dataSource.getRepository(OrganizationEmployeeEntity)
    const linked = await employees.find({ where: { accountId: actor.id, archivedAt: IsNull() }, select: { ownerUserId: true }, take: 2 })
    if (linked.length > 1 || linked[0] && actor.organizationWorkspaceOwnerId && linked[0].ownerUserId !== actor.organizationWorkspaceOwnerId) {
      throw new ForbiddenException({ code: 'local_organization_scope_required', message: 'Current local organization assignment is unavailable' })
    }
    const ownerUserId = linked[0]?.ownerUserId ?? actor.organizationWorkspaceOwnerId ?? actor.id
    // 归档成员保留本公司的历史业务，FOP 是否绑定不改变本地公司归属。
    const members = await employees.find({ where: { ownerUserId }, select: { accountId: true } })
    const memberIds = [...new Set(members.flatMap(member => member.accountId ? [member.accountId] : []))]
    const owners = await repository.find({ where: [{ id: ownerUserId }, { organizationWorkspaceOwnerId: ownerUserId }, ...(memberIds.length ? [{ id: In(memberIds) }] : [])], select: { id: true } })
    const ids = [...new Set(owners.map(owner => owner.id))]
    return { ids, filter: In(ids) }
  }
  const customer = actor.chartPermissions?.find(chart => chart.chartId === 'customer_orders')
  if (!validateChartPermissions(actor.chartPermissions ?? []) || customer?.visibility === 'deny' || customer?.dataScope === 'none') {
    throw new ForbiddenException({ code: 'customer_access_denied', message: 'Customer record access is disabled for this account' })
  }
  if (scope.role === 'salesperson') return { ids: [actorId], filter: actorId }
  const query = repository.createQueryBuilder('account').select('account.id', 'id')
  if (actor.fopTenantId) query.where('account.fop_tenant_id = :tenant', { tenant: actor.fopTenantId })
  else query.where('account.fop_tenant_id IS NULL')
  // 全部门范围仍不得跨越当前已验证的金蝶公司组织。
  if (actor.fopBindingDetails?.organizationId) query.andWhere("account.fop_binding_details ->> 'organizationId' = :organization", { organization: actor.fopBindingDetails.organizationId })
  if (scope.role === 'department_manager') {
    if (!scope.departmentId) return { ids: [], filter: In([]) }
    // 客户、报价、沟通等本地业务读取使用同一直属部门边界，不递归下级部门。
    query.andWhere('account.business_department_id = :department', { department: scope.departmentId })
  }
  const rows = await query.getRawMany<{ id: string }>()
  const ids = rows.map(row => row.id)
  return { ids, filter: In(ids) }
}
