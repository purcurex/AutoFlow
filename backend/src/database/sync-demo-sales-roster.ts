/** Explicit, local-only roster refresh. Does not modify login accounts or FOP bindings. */
import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'
import dataSource from './data-source'
import { ORGANIZATION_EMPLOYEE_SEEDS, ORGANIZATION_NODE_SEEDS, SALES_ROSTER_SEEDS } from '../modules/organization/organization.seed'
import { OrganizationEmployeeEntity } from '../modules/organization/organization-employee.entity'
import { OrganizationNodeEntity } from '../modules/organization/organization-node.entity'
import { User } from '../modules/users/user.entity'

async function main() {
  if (process.env.FOP_DATA_MODE !== 'demo' || process.env.DB_DATABASE !== 'autoflow_local_demo'
    || !['127.0.0.1', 'localhost'].includes(process.env.DB_HOST ?? '')) throw new Error('Only the explicit local demo database is supported')
  await dataSource.initialize()
  try {
    await dataSource.transaction(async manager => {
      const user = await manager.getRepository(User).findOneByOrFail({ email: 'test@autoflow.local' })
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`autoflow:organization:${user.id}`])
      const repository = manager.getRepository(OrganizationEmployeeEntity)
      const employees = await repository.findBy({ ownerUserId: user.id })
      const nodes = await manager.getRepository(OrganizationNodeEntity).findBy({ ownerUserId: user.id })
      const directory = resolve(__dirname, '../../../.runtime/local-demo')
      await mkdir(directory, { recursive: true })
      await writeFile(resolve(directory, `sales-roster-backup-${Date.now()}.json`), JSON.stringify({ ownerUserId: user.id, employees }, null, 2), { mode: 0o600 })
      const oldNames: Record<string, string> = { EMP001: '林知远', EMP002: '周雨桐', EMP003: '陈思妤', EMP004: '赵嘉宁' }
      let renamed = 0, inserted = 0
      for (const member of SALES_ROSTER_SEEDS) {
        const seed = ORGANIZATION_EMPLOYEE_SEEDS.find(item => item.code === member.code)!
        const existing = employees.find(item => item.code === member.code)
        if (existing) {
          // Retain custom employee names, department moves and role assignments.
          if (existing.name === oldNames[member.code]) {
            await repository.update({ id: existing.id, ownerUserId: user.id }, { name: seed.name })
            renamed++
          }
          continue
        }
        const nodeSeed = ORGANIZATION_NODE_SEEDS.find(item => item.key === seed.department)!
        const parentSeed = ORGANIZATION_NODE_SEEDS.find(item => item.key === nodeSeed.parent)!
        const matches = nodes.filter(node => node.name === nodeSeed.name && nodes.some(parent => parent.id === node.parentId && parent.name === parentSeed.name))
        if (matches.length !== 1) throw new Error(`Cannot safely resolve demo department for ${member.code}; no changes applied`)
        await repository.insert({ ownerUserId: user.id, code: seed.code, name: seed.name, email: `${seed.code.toLowerCase()}@hyperzone.example`, departmentId: matches[0].id, workbenchRoles: seed.roles })
        inserted++
      }
      console.log(`Local demo roster updated: ${renamed} renamed, ${inserted} inserted; existing organization edits preserved.`)
    })
  } finally { await dataSource.destroy() }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Roster refresh failed'); process.exitCode = 1 })
