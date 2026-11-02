/** Explicit local-only upgrade. Does not alter accounts, permissions or FOP. */
import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'
import dataSource from './data-source'
import { flattenDemoSalesDepartments } from './flatten-demo-sales-departments'
import { OrganizationNodeEntity } from '../modules/organization/organization-node.entity'
import { OrganizationEmployeeEntity } from '../modules/organization/organization-employee.entity'

async function main() {
  if (process.env.FOP_DATA_MODE !== 'demo' || process.env.DB_DATABASE !== 'autoflow_local_demo'
    || !['127.0.0.1', 'localhost'].includes(process.env.DB_HOST ?? '')
    || !['development', 'local'].includes(process.env.NODE_ENV ?? '')) throw new Error('Only the explicit local demo database is supported')
  await dataSource.initialize()
  try {
    const owners = await dataSource.getRepository(OrganizationNodeEntity).createQueryBuilder('node')
      .select('DISTINCT node.ownerUserId', 'id').getRawMany<{ id: string }>()
    for (const owner of owners) {
      const result = await dataSource.transaction(async manager => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`autoflow:organization:${owner.id}`])
        const nodes = await manager.getRepository(OrganizationNodeEntity).findBy({ ownerUserId: owner.id })
        const employees = await manager.getRepository(OrganizationEmployeeEntity).findBy({ ownerUserId: owner.id })
        const backupDir = resolve(__dirname, '../../../.runtime/local-demo')
        await mkdir(backupDir, { recursive: true })
        await writeFile(resolve(backupDir, `sales-departments-backup-${owner.id}-${Date.now()}.json`), JSON.stringify({ ownerUserId: owner.id, nodes, employees }, null, 2), { mode: 0o600 })
        return flattenDemoSalesDepartments(manager, owner.id)
      })
      console.log(JSON.stringify({ ownerUserId: owner.id, ...result }))
    }
  } finally { await dataSource.destroy() }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Demo department upgrade failed'); process.exitCode = 1 })
