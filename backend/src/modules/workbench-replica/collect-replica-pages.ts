import { ConflictException, ServiceUnavailableException } from '@nestjs/common'

export interface ReplicaExportProof { readMode: 'local'; datasetId: string; revision: string }
export interface ReplicaExportPage<T> { items: T[]; total: number; page: number; pageSize: number; replica?: ReplicaExportProof }
const changed = () => new ConflictException({ code: 'workbench_replica_export_changed', message: 'Replica data or pagination changed during export; reload and retry' })
export function sameReplicaExportProof(left: ReplicaExportProof, right: ReplicaExportProof): boolean {
  return left.readMode === 'local' && right.readMode === 'local' && left.datasetId === right.datasetId && left.revision === right.revision
}

/** A workbook never joins pages from different published datasets, revisions or incomplete result sets. */
export async function collectReplicaPages<T extends { id?: unknown; orderId?: unknown }>(read: (page: number) => Promise<ReplicaExportPage<T>>, expected?: ReplicaExportProof): Promise<{ items: T[]; replica: ReplicaExportProof }> {
  const items: T[] = [], ids = new Set<string>()
  let total: number | undefined, proof = expected, pageSize: number | undefined
  for (let page = 1; page <= 1000; page++) {
    const result = await read(page), replica = result.replica
    if (!replica || replica.readMode !== 'local' || typeof replica.datasetId !== 'string' || !replica.datasetId.trim()
      || typeof replica.revision !== 'string' || !replica.revision.trim()) throw changed()
    if (!proof) proof = { readMode: 'local', datasetId: replica.datasetId, revision: replica.revision }
    if (!sameReplicaExportProof(proof, replica) || !Number.isSafeInteger(result.total) || result.total < 0
      || !Number.isSafeInteger(result.pageSize) || result.pageSize < 1 || result.pageSize > 1000 || result.page !== page || !Array.isArray(result.items)) throw changed()
    if (total === undefined) { total = result.total; pageSize = result.pageSize }
    if (result.total !== total || result.pageSize !== pageSize || result.items.length !== Math.min(pageSize!, Math.max(0, total - (page - 1) * pageSize!))) throw changed()
    if (total > 100_000) throw new ServiceUnavailableException({ code: 'workbench_replica_export_too_large', message: 'Export exceeds the bounded local result limit' })
    for (const row of result.items) {
      const id = row?.id ?? row?.orderId
      if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw changed()
      ids.add(id); items.push(row)
    }
    if (items.length === total) return { items, replica: proof }
  }
  throw new ServiceUnavailableException({ code: 'workbench_replica_export_too_large', message: 'Export exceeds the bounded local page limit' })
}
