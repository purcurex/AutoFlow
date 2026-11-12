import { ConfigService } from '@nestjs/config'
import type { DataSource } from 'typeorm'

export const MOCK_DATABASE = 'autoflow_workbench_mock'
export const MOCK_CREDENTIAL = 'local-mock-only'
export function workbenchMockEnabled(config: ConfigService): boolean {
  if (config.get('WORKBENCH_MOCK_ENABLED') !== 'true') return false
  if (!['test', 'development', 'local'].includes(config.get('NODE_ENV', 'development')) ||
    config.get('WORKBENCH_READ_MODE') !== 'local' || config.get('DB_DATABASE') !== MOCK_DATABASE ||
    !['127.0.0.1', 'localhost', '::1'].includes(config.get('DB_HOST', ''))) {
    throw new Error('Workbench mock requires the dedicated loopback mock database in a non-production local environment')
  }
  return true
}
export function assertMockDatabase(db: DataSource): void {
  if (db.options.database !== MOCK_DATABASE || db.options.type !== 'postgres' || !('host' in db.options) ||
    !['127.0.0.1', 'localhost', '::1'].includes(db.options.host ?? '')) throw new Error('Refusing mock writes outside the dedicated local mock database')
}
/** Synthetic authorization only; never refresh business source timestamps or real FOP proofs. */
export async function refreshMockProofs(db: DataSource): Promise<void> {
  assertMockDatabase(db)
  await db.transaction(async manager => {
    const connections = await manager.query('SELECT id FROM hz_fop_connections WHERE credential_ref=$1 AND tenant_id=$2 AND base_url=$3', [MOCK_CREDENTIAL, 'local-mock', 'https://mock.invalid'])
    const ids = connections.map((row: { id: string }) => row.id)
    if (!ids.length) throw new Error('Mock dataset is not initialized')
    await manager.query("UPDATE hz_fop_companies SET verified_at=now(),expires_at=now()+interval '1 hour' WHERE connection_id=ANY($1::uuid[])", [ids])
    await manager.query("UPDATE hz_fop_resource_grants SET verified_at=now(),source_as_of=now(),expires_at=now()+interval '1 hour' WHERE connection_id=ANY($1::uuid[]) AND evidence->>'source'='mock'", [ids])
    await manager.query('UPDATE hz_fop_workbench_receipt_notices p SET ownership_verified_at=now() FROM hz_fop_source_documents sd WHERE sd.id=p.document_id AND sd.connection_id=ANY($1::uuid[])', [ids])
    await manager.query('UPDATE hz_fop_workbench_orders SET ownership_verified_at=now() WHERE connection_id=ANY($1::uuid[])', [ids])
  })
}
