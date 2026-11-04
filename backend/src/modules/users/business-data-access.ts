import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { DataSource, FindOperator, In } from 'typeorm'
import { User } from './user.entity'
import { businessScope } from './business-scope'
import { validateChartPermissions } from './chart-permissions'

/** Server-owned account assignments govern every local business read.
 * Unbound accounts belong to the installation's local company; FOP-bound
 * accounts additionally stay inside their configured tenant.
 */
export async function readBusinessOwners(dataSource: DataSource, actorId: string): Promise<{ ids: string[]; filter: string | FindOperator<string> }> {
  const repository = dataSource.getRepository(User)
  const actor = await repository.findOne({ where: { id: actorId } })
  if (!actor) throw new UnauthorizedException('Account no longer exists')
  const scope = businessScope(actor)
  if (scope.role === 'none') throw new ForbiddenException({ code: 'business_access_disabled', message: 'Business data access is disabled for this account' })
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
