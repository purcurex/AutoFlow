import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { DataSource, EntityManager } from 'typeorm'
import { User, UserRole } from '../users/user.entity'
import { OrganizationNodeEntity } from './organization-node.entity'
import { OrganizationEmployeeEntity } from './organization-employee.entity'
import { ORGANIZATION_EMPLOYEE_SEEDS, ORGANIZATION_NODE_SEEDS } from './organization.seed'
import type { OrganizationWorkspace } from './organization.types'
import type { CreateOrganizationNodeDto, UpdateOrganizationNodeDto } from './organization.dto'

@Injectable()
export class OrganizationService {
  constructor(private readonly dataSource: DataSource) {}

  /** Internal demo-provider entrypoint; never exposed directly to HTTP callers. */
  getWorkspace(ownerUserId: string): Promise<OrganizationWorkspace> {
    return this.withWorkspace(ownerUserId, async () => undefined, false)
  }

  getManagementWorkspace(ownerUserId: string): Promise<OrganizationWorkspace> {
    return this.withWorkspace(ownerUserId, async () => undefined)
  }

  createNode(ownerUserId: string, dto: CreateOrganizationNodeDto) {
    return this.withWorkspace(ownerUserId, async (manager) => {
      await this.requireNode(manager, ownerUserId, dto.parentId)
      await manager.getRepository(OrganizationNodeEntity).insert({
        ownerUserId, parentId: dto.parentId, name: dto.name, kind: 'department', sortOrder: dto.sortOrder ?? 0,
      })
    })
  }

  updateNode(ownerUserId: string, id: string, dto: UpdateOrganizationNodeDto) {
    return this.withWorkspace(ownerUserId, async (manager) => {
      const node = await this.requireNode(manager, ownerUserId, id)
      const changes: Partial<Pick<OrganizationNodeEntity, 'name' | 'parentId' | 'sortOrder'>> = {}
      if (dto.name !== undefined) changes.name = dto.name
      if (dto.sortOrder !== undefined) changes.sortOrder = dto.sortOrder
      if (dto.parentId !== undefined && dto.parentId !== node.parentId) {
        if (node.kind === 'organization') throw new ConflictException('The root organization cannot be reparented')
        let ancestor: OrganizationNodeEntity | null = await this.requireNode(manager, ownerUserId, dto.parentId)
        const seen = new Set<string>()
        while (ancestor) {
          if (ancestor.id === node.id || seen.has(ancestor.id)) throw new ConflictException('A department cannot be moved beneath itself or its descendants')
          seen.add(ancestor.id)
          ancestor = ancestor.parentId ? await this.requireNode(manager, ownerUserId, ancestor.parentId) : null
        }
        changes.parentId = dto.parentId
      }
      if (Object.keys(changes).length) await manager.getRepository(OrganizationNodeEntity).update({ id, ownerUserId }, changes)
    })
  }

  deleteNode(ownerUserId: string, id: string) {
    return this.withWorkspace(ownerUserId, async (manager) => {
      const node = await this.requireNode(manager, ownerUserId, id)
      if (node.kind === 'organization') throw new ConflictException('The root organization cannot be deleted')
      if (await manager.getRepository(OrganizationNodeEntity).existsBy({ ownerUserId, parentId: id })
        || await manager.getRepository(OrganizationEmployeeEntity).existsBy({ ownerUserId, departmentId: id })) {
        throw new ConflictException('Move all child departments and employees before deleting this department')
      }
      await manager.getRepository(OrganizationNodeEntity).delete({ id, ownerUserId })
    })
  }

  assignEmployee(ownerUserId: string, id: string, departmentId: string) {
    return this.withWorkspace(ownerUserId, async (manager) => {
      if (!await manager.getRepository(OrganizationEmployeeEntity).existsBy({ id, ownerUserId })) throw new NotFoundException('Employee not found')
      const department = await this.requireNode(manager, ownerUserId, departmentId)
      if (department.kind !== 'department') throw new ConflictException('Employees must be assigned to a department')
      await manager.getRepository(OrganizationEmployeeEntity).update({ id, ownerUserId }, { departmentId })
    })
  }

  private async requireNode(manager: EntityManager, ownerUserId: string, id: string) {
    const node = await manager.getRepository(OrganizationNodeEntity).findOneBy({ id, ownerUserId })
    if (!node) throw new NotFoundException('Organization node not found')
    return node
  }

  private withWorkspace(ownerUserId: string, change: (manager: EntityManager) => Promise<void>, requiresAdmin = true): Promise<OrganizationWorkspace> {
    return this.dataSource.transaction(async (manager) => {
      // Seed and all mutations use the same lock. This serializes reciprocal moves,
      // move/delete races and first-GET creation without locking other accounts.
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`autoflow:organization:${ownerUserId}`])
      const account = await manager.getRepository(User).findOneBy({ id: ownerUserId })
      if (!account) throw new UnauthorizedException('Account no longer exists')
      const canEdit = account.role === UserRole.ADMIN
      if (requiresAdmin && !canEdit) throw new ForbiddenException('System administrator access is required for organization management')
      if (!await manager.getRepository(OrganizationNodeEntity).existsBy({ ownerUserId })) await this.seed(manager, ownerUserId)
      await change(manager)
      const nodes = await manager.getRepository(OrganizationNodeEntity).find({ where: { ownerUserId }, order: { sortOrder: 'ASC', id: 'ASC' } })
      const employees = await manager.getRepository(OrganizationEmployeeEntity).find({ where: { ownerUserId }, order: { code: 'ASC', id: 'ASC' } })
      return {
        source: 'mock', canEdit,
        nodes: nodes.map(({ id, parentId, name, kind, sortOrder }) => ({ id, parentId, name, kind, sortOrder })),
        employees: employees.map(({ id, name, code, email, departmentId, workbenchRoles }) => ({ id, name, code, email, departmentId, workbenchRoles })),
      }
    })
  }

  private async seed(manager: EntityManager, ownerUserId: string) {
    const ids = new Map(ORGANIZATION_NODE_SEEDS.map((node) => [node.key as string, randomUUID()]))
    // Parent definitions precede children, so FK validation also succeeds per row.
    for (const [sortOrder, node] of ORGANIZATION_NODE_SEEDS.entries()) {
      await manager.getRepository(OrganizationNodeEntity).insert({
        id: ids.get(node.key), ownerUserId, parentId: node.parent ? ids.get(node.parent)! : null,
        name: node.name, kind: node.parent ? 'department' : 'organization', sortOrder,
      })
    }
    await manager.getRepository(OrganizationEmployeeEntity).insert(ORGANIZATION_EMPLOYEE_SEEDS.map((employee) => {
      const code = employee.code
      return { ownerUserId, name: employee.name, code, email: `${code.toLowerCase()}@hyperzone.example`, departmentId: ids.get(employee.department)!, workbenchRoles: employee.roles }
    }))
  }
}
