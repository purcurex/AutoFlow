import type { EntityManager } from 'typeorm'
import { OrganizationNodeEntity } from '../modules/organization/organization-node.entity'
import { OrganizationEmployeeEntity } from '../modules/organization/organization-employee.entity'
import { User } from '../modules/users/user.entity'

/** Explicit demo upgrade only. Caller owns the transaction; never run on reads. */
export async function flattenDemoSalesDepartments(manager: EntityManager, ownerUserId: string) {
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`autoflow:organization:${ownerUserId}`])
  const nodes = manager.getRepository(OrganizationNodeEntity)
  const employees = manager.getRepository(OrganizationEmployeeEntity)
  const directory = await nodes.findBy({ ownerUserId })
  const result = { moved: 0, removed: 0, skipped: [] as string[] }
  const root = directory.find(node => node.kind === 'organization' && node.name === 'HyperZone')
  const marketing = directory.filter(node => node.parentId === root?.id && node.name === '营销中心')
  if (!root || marketing.length !== 1) return result
  for (const [departmentName, groupName] of [['业务一部', '欧洲销售组'], ['业务二部', '北美销售组'], ['业务三部', '亚太销售组'], ['业务四部', '大客户组']]) {
    const departments = directory.filter(node => node.parentId === marketing[0].id && node.name === departmentName)
    if (departments.length !== 1) { result.skipped.push(`${departmentName}：路径不唯一或已调整`); continue }
    const department = departments[0]
    const groups = directory.filter(node => node.parentId === department.id && node.name === groupName)
    if (!groups.length) continue
    if (groups.length !== 1) { result.skipped.push(`${groupName}：存在同名节点`); continue }
    const group = groups[0]
    // Preserve customized subtrees and never silently widen a manager's scope.
    if (directory.some(node => node.parentId === group.id)) { result.skipped.push(`${groupName}：含自定义下级部门`); continue }
    if (await manager.getRepository(User).existsBy({ businessDepartmentId: group.id })) { result.skipped.push(`${groupName}：被账号数据权限引用`); continue }
    const changed = await employees.update({ ownerUserId, departmentId: group.id }, { departmentId: department.id })
    await nodes.delete({ ownerUserId, id: group.id })
    result.moved += changed.affected ?? 0
    result.removed++
  }
  return result
}
