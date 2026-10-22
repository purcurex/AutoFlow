import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { DataSource, FindOperator, In } from 'typeorm'
import { User } from './user.entity'
import { businessScope } from './business-scope'

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
  if (scope.role === 'salesperson') return { ids: [actorId], filter: actorId }
  const query = repository.createQueryBuilder('account').select('account.id', 'id')
  if (actor.fopTenantId) query.where('account.fop_tenant_id = :tenant', { tenant: actor.fopTenantId })
  else query.where('account.fop_tenant_id IS NULL')
  if (scope.role === 'department_manager') {
    if (!scope.departmentId) return { ids: [], filter: In([]) }
    // UUID node ancestry is maintained by the organization service. External
    // department IDs still support exact matching until the FOP directory sync.
    query.andWhere(`account.business_department_id IN (
      WITH RECURSIVE departments(id) AS (
        SELECT :department::text
        UNION
        SELECT node.id::text FROM organization_nodes node
        JOIN departments parent ON node.parent_id::text = parent.id
      ) SELECT id FROM departments
    )`, { department: scope.departmentId })
  }
  const rows = await query.getRawMany<{ id: string }>()
  const ids = rows.map(row => row.id)
  return { ids, filter: In(ids) }
}
