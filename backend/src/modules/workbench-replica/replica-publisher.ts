import { createHash, randomUUID } from 'crypto'
import { Injectable } from '@nestjs/common'
import { DataSource, QueryRunner } from 'typeorm'
import { WORKBENCH_PRIMARY_KEYS, WORKBENCH_TABLE_COLUMNS } from '../../database/workbench-schema'
import { validateChangeGroup, type ReplicaChange, type ReplicaChangeGroup, type ReplicaDatasetScope, type ReplicaRow } from './replica-change-contract'

const projectionTables = ['hz_fop_workbench_orders', 'hz_fop_workbench_order_lines', 'hz_fop_workbench_memberships', 'hz_fop_projection_dependencies', 'hz_fop_workbench_procurement_demands', 'hz_fop_workbench_purchase_allocations']
const factTables = new Set(['fulfillment_orders', 'stock_orders', 'purchase_requisitions', 'purchase_orders', 'receipt_notices', 'inbound_bills', 'allocations', 'dispatches', 'delivery_notices', 'outbound_bills', 'receipts', 'payments', 'receipt_adjustments', 'rma_orders', 'purchase_returns', 'source_lines', 'order_line_details', 'procurement_line_details', 'allocation_line_details', 'inventory_line_details', 'financial_line_details', 'return_line_details', 'order_packages', 'package_lines', 'platform_orders', 'document_relations', 'document_packages', 'stock_consumptions', 'tracking_numbers', 'tracking_events', 'exception_marks', 'order_flags'].map(table => `hz_fop_${table}`))
// JSON object order is not semantic; arrays retain source/entry ordering.
export const replicaPayloadHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item)).digest('hex')

export const replicaSnapshotHash = (event: ReplicaChange) => replicaPayloadHash({ operation: event.operation, rows: event.rows, sourceFields: event.sourceFields ?? {} })

/** Internal service entry point only. No public endpoint accepts normalized rows or SQL. */
@Injectable()
export class ReplicaPublisher {
  constructor(private readonly db: DataSource) {}

  async apply(scope: ReplicaDatasetScope, streamId: string, input: ReplicaChangeGroup, lease?: { taskId: string; token: string }, snapshot?: { batchId: string }): Promise<string> {
    const group = validateChangeGroup(input)
    const runner = this.db.createQueryRunner()
    await runner.connect(); await runner.startTransaction()
    try {
      // A source commit may reference another member that appears later in the manifest.
      await runner.query('SET CONSTRAINTS ALL DEFERRED')
      if (lease) {
        const fences = await runner.query("SELECT id FROM hz_fop_sync_tasks WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_expires_at>now() FOR UPDATE", [lease.taskId, lease.token])
        if (!fences.length) throw new Error('Replica lease lost')
      }
      // Serializes projection revisions across streams belonging to the same company.
      const companies = await runner.query("SELECT co.id FROM hz_fop_companies co JOIN hz_fop_connections c ON c.id=co.connection_id WHERE co.id=$1 AND co.connection_id=$2 AND co.enabled AND c.status='active' FOR UPDATE OF co", [scope.companyId, scope.connectionId])
      if (!companies.length) throw new Error('Replica company scope changed')
      const datasets = await runner.query("SELECT id,state FROM hz_fop_datasets WHERE id=$1 AND connection_id=$2 AND company_id=$3 AND state IN ('building','replaying','validating','active')", [scope.datasetId, scope.connectionId, scope.companyId])
      if (!datasets.length) throw new Error('Replica dataset is not writable')
      let snapshotMode = false
      if (snapshot) {
        const batches = await runner.query("SELECT id FROM hz_fop_bootstrap_batches WHERE id=$1 AND connection_id=$2 AND company_id=$3 AND dataset_id=$4 AND state='importing'", [snapshot.batchId,scope.connectionId,scope.companyId,scope.datasetId])
        if (datasets[0].state !== 'building' || !batches.length) throw new Error('Replica snapshot identity mode is not allowed')
        snapshotMode = true
      }
      const [stream] = await runner.query('SELECT * FROM hz_fop_sync_streams WHERE id=$1 AND connection_id=$2 AND company_id=$3 AND dataset_id=$4 FOR UPDATE', [streamId, scope.connectionId, scope.companyId, scope.datasetId])
      if (!stream || !['initializing', 'ready', 'catching_up'].includes(stream.state)) throw new Error('Replica stream is not writable')
      const manifestHash = replicaPayloadHash(group)
      const [previous] = await runner.query('SELECT state,manifest_hash FROM hz_fop_sync_commit_groups WHERE stream_id=$1 AND source_group_key=$2', [streamId, group.groupKey])
      if (previous) {
        if (previous.state !== 'applied' || previous.manifest_hash !== manifestHash) throw new Error('Conflicting commit replay')
        await runner.commitTransaction(); return stream.applied_cursor
      }
      if (stream.applied_cursor !== group.afterCursor || stream.received_cursor !== stream.applied_cursor) throw new Error('Non-contiguous source cursor')
      const [{ revision }] = await runner.query("SELECT (COALESCE(applied_watermarks->'_local'->>'projectionRevision','0')::bigint+1)::text AS revision FROM hz_fop_datasets WHERE id=$1", [scope.datasetId])
      const [{ position }] = await runner.query('SELECT COALESCE(MAX(stream_position),0)::text AS position FROM hz_fop_sync_events WHERE stream_id=$1', [streamId])
      const groupId = randomUUID()
      await runner.query(`INSERT INTO hz_fop_sync_commit_groups(id,connection_id,company_id,dataset_id,stream_id,source_group_key,expected_event_count,member_manifest,manifest_hash,end_cursor,state,source_committed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'applying',$11)`, [groupId, scope.connectionId, scope.companyId, scope.datasetId, streamId, group.groupKey, group.expectedCount, JSON.stringify(group.events.map(e => e.eventId)), manifestHash, group.endCursor, group.committedAt])
      const requiredOrders = new Set(group.events.flatMap(event => event.affectedOrderIds))
      for (const [i, event] of group.events.entries()) {
        const [identity] = await runner.query('SELECT connection_id,company_id,dataset_id,entity_code,source_id FROM hz_fop_source_documents WHERE id=$1 FOR UPDATE', [event.localDocumentId])
        if (identity && (identity.connection_id !== scope.connectionId || identity.company_id !== scope.companyId || identity.dataset_id !== scope.datasetId || identity.entity_code !== event.entityCode || identity.source_id !== event.sourceId)) throw new Error('Source identity or scope collision')
        const [old] = await runner.query('SELECT id,source_version,payload_hash,validation_state,payload FROM hz_fop_source_documents WHERE company_id=$1 AND dataset_id=$2 AND entity_code=$3 AND source_id=$4', [scope.companyId, scope.datasetId, event.entityCode, event.sourceId])
        const snapshotHash = replicaSnapshotHash(event)
        const placeholder = old?.source_version === null && snapshotMode && old.validation_state === 'unverified' && old.payload?.bootstrapBatchId === snapshot!.batchId && old.payload.sourceVersion === event.sourceVersion && old.payload.snapshotHash === snapshotHash
        if (old && (old.id !== event.localDocumentId || old.source_version === null && !placeholder || old.source_version !== null && (BigInt(old.source_version) > BigInt(event.sourceVersion) || BigInt(old.source_version) === BigInt(event.sourceVersion) && old.payload_hash !== snapshotHash))) throw new Error('Conflicting or regressed source version')
        const dependencies = await runner.query('SELECT order_document_id,source_version,relation_revision FROM hz_fop_projection_dependencies WHERE company_id=$1 AND dataset_id=$2 AND source_document_id=$3', [scope.companyId, scope.datasetId, event.localDocumentId])
        for (const dependency of dependencies) {
          // The order's consistent snapshot may be published before the referenced source page.
          // Filling that exact staged version cannot require an unchanged order to be resupplied.
          if (placeholder) {
            if (dependency.source_version !== event.sourceVersion || dependency.relation_revision !== (event.sourceFields?.relationRevision ?? '0')) throw new Error('Snapshot dependency version mismatch')
          } else requiredOrders.add(dependency.order_document_id)
        }
        if (['hzkj_orders', 'hzkj_stock_order_new'].includes(event.entityCode)) requiredOrders.add(event.localDocumentId)
        const registry = await runner.query(`INSERT INTO hz_fop_source_documents AS existing(id,connection_id,company_id,dataset_id,entity_code,source_id,document_number,source_version,source_committed_at,validation_state,deleted_at,payload_hash,raw_bill_status,source_created_at,source_modified_at,source_audited_at,relation_revision)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT(id) DO UPDATE SET source_version=EXCLUDED.source_version,document_number=EXCLUDED.document_number,source_committed_at=EXCLUDED.source_committed_at,validation_state=EXCLUDED.validation_state,deleted_at=EXCLUDED.deleted_at,payload_hash=EXCLUDED.payload_hash,raw_bill_status=EXCLUDED.raw_bill_status,source_created_at=EXCLUDED.source_created_at,source_modified_at=EXCLUDED.source_modified_at,source_audited_at=EXCLUDED.source_audited_at,relation_revision=EXCLUDED.relation_revision,payload=CASE WHEN existing.validation_state='unverified' THEN NULL ELSE existing.payload END,synced_at=now()
          WHERE existing.connection_id=EXCLUDED.connection_id AND existing.company_id=EXCLUDED.company_id AND existing.dataset_id=EXCLUDED.dataset_id AND existing.entity_code=EXCLUDED.entity_code AND existing.source_id=EXCLUDED.source_id RETURNING id`,
        [event.localDocumentId, scope.connectionId, scope.companyId, scope.datasetId, event.entityCode, event.sourceId, event.documentNumber, event.sourceVersion, group.committedAt, event.operation === 'delete' ? 'deleted' : 'verified', event.operation === 'delete' ? group.committedAt : null, snapshotHash,
          event.sourceFields?.rawBillStatus ?? null,event.sourceFields?.createdAt ?? null,event.sourceFields?.modifiedAt ?? null,event.sourceFields?.auditedAt ?? null,event.sourceFields?.relationRevision ?? '0'])
        if (!registry.length) throw new Error('Source identity or scope collision')
        // Full entry replacement also replaces each optional detail subtype. A missing detail
        // in the next complete snapshot means unknown, never reuse a previous quantity/status.
        for (const table of ['hz_fop_order_line_details','hz_fop_procurement_line_details','hz_fop_allocation_line_details','hz_fop_inventory_line_details','hz_fop_financial_line_details','hz_fop_return_line_details']) {
          await runner.query(`DELETE FROM ${table} WHERE company_id=$1 AND dataset_id=$2 AND line_id IN (SELECT id FROM hz_fop_source_lines WHERE company_id=$1 AND dataset_id=$2 AND document_id=$3)`, [scope.companyId, scope.datasetId, event.localDocumentId])
        }
        // Complete entry snapshots remove missing entries without erasing their source identities.
        await runner.query('UPDATE hz_fop_source_lines SET removed_at=$4 WHERE company_id=$1 AND dataset_id=$2 AND document_id=$3', [scope.companyId, scope.datasetId, event.localDocumentId, group.committedAt])
        // Each holder publishes COMPLETE current relations/collections; omitted rows are tombstones.
        // Source identities remain stable, so a later rebuild can reactivate the same row explicitly.
        for (const [table, owner] of Object.entries({
          hz_fop_document_relations: 'holder_document_id', hz_fop_order_packages: 'order_document_id',
          hz_fop_package_lines: 'order_document_id', hz_fop_platform_orders: 'purchase_document_id',
          hz_fop_document_packages: 'document_id', hz_fop_tracking_numbers: 'dispatch_document_id',
        })) await runner.query(`UPDATE ${table} SET removed_at=$4 WHERE company_id=$1 AND dataset_id=$2 AND ${owner}=$3`, [scope.companyId, scope.datasetId, event.localDocumentId, group.committedAt])
        if (event.operation === 'delete') {
          await runner.query('UPDATE hz_fop_document_relations SET removed_at=$4 WHERE company_id=$1 AND dataset_id=$2 AND (from_document_id=$3 OR to_document_id=$3)', [scope.companyId, scope.datasetId, event.localDocumentId, group.committedAt])
          await runner.query('UPDATE hz_fop_stock_consumptions SET removed_at=$4 WHERE company_id=$1 AND dataset_id=$2 AND (stock_document_id=$3 OR order_document_id=$3)', [scope.companyId, scope.datasetId, event.localDocumentId, group.committedAt])
          await runner.query('UPDATE hz_fop_document_packages SET removed_at=$4 WHERE company_id=$1 AND dataset_id=$2 AND order_document_id=$3', [scope.companyId, scope.datasetId, event.localDocumentId, group.committedAt])
        }
        if (event.operation === 'upsert') {
          if (!event.rows.some(row => row.table !== 'hz_fop_source_lines' && row.values.document_id === event.localDocumentId && row.values.entity_code === event.entityCode)) throw new Error('Missing typed source header')
          for (const row of event.rows) {
            if (!factTables.has(row.table)) throw new Error('Unapproved fact table')
            if (row.values.document_id !== undefined && row.values.document_id !== event.localDocumentId) throw new Error('Snapshot row belongs to another document')
            await this.upsert(runner, scope, row)
          }
        } else if (event.rows.length) throw new Error('Deleted source cannot publish facts')
        await runner.query(`INSERT INTO hz_fop_sync_events(id,connection_id,company_id,dataset_id,stream_id,commit_group_id,source_event_id,source_cursor,stream_position,entity_code,source_document_id,source_version,operation,change_group_key,group_end,source_committed_at,state,applied_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'applied',now())`,
        [randomUUID(), scope.connectionId, scope.companyId, scope.datasetId, streamId, groupId, event.eventId, group.endCursor, (BigInt(position) + BigInt(i + 1)).toString(), event.entityCode, event.sourceId, event.sourceVersion, event.operation, group.groupKey, i === group.events.length - 1, group.committedAt])
      }
      // Recompute the package's tracking mirror from valid current links. Deletion/unlink/rebuild
      // must never retain an old selected number, including when only the dispatch changed.
      await runner.query(`UPDATE hz_fop_order_packages pkg SET tracking_number=(
        SELECT min(tn.number) FROM hz_fop_tracking_numbers tn JOIN hz_fop_source_documents ds ON ds.id=tn.dispatch_document_id
        WHERE tn.package_id=pkg.id AND tn.company_id=pkg.company_id AND tn.dataset_id=pkg.dataset_id AND tn.removed_at IS NULL AND tn.shopify_selected IS TRUE
          AND ds.deleted_at IS NULL AND ds.validation_state='verified'
          AND EXISTS(SELECT 1 FROM hz_fop_document_relations r WHERE r.from_document_id=pkg.order_document_id AND r.to_document_id=tn.dispatch_document_id AND r.company_id=pkg.company_id AND r.dataset_id=pkg.dataset_id AND r.relation_type='dispatch' AND r.resolution_state='resolved' AND r.removed_at IS NULL)
        HAVING count(*)=1)
        WHERE pkg.company_id=$1 AND pkg.dataset_id=$2 AND pkg.order_document_id=ANY($3::uuid[])`, [scope.companyId,scope.datasetId,[...requiredOrders]])
      const receipts = new Map((group.receiptNotices ?? []).map(projection => [projection.documentId, projection]))
      for (const event of group.events.filter(event => event.entityCode === 'hzkj_receiptnotice')) {
        const projection = receipts.get(event.localDocumentId)
        if (!projection) throw new Error('Receipt notice projection missing')
        if (projection.deleted !== (event.operation === 'delete')) throw new Error('Receipt notice deletion mismatch')
        if (projection.deleted) {
          if (projection.rows.length) throw new Error('Deleted receipt notice has rows')
          await runner.query('DELETE FROM hz_fop_workbench_receipt_notices WHERE document_id=$1', [event.localDocumentId])
        } else {
          if (projection.rows.length !== 1 || projection.rows[0].table !== 'hz_fop_workbench_receipt_notices' || projection.rows[0].values.document_id !== event.localDocumentId || projection.rows[0].values.source_version !== event.sourceVersion) throw new Error('Invalid receipt notice projection grain or version')
          await this.upsert(runner, scope, {table: projection.rows[0].table, values: {...projection.rows[0].values, published_at: new Date().toISOString()}})
        }
        receipts.delete(event.localDocumentId)
      }
      if (receipts.size) throw new Error('Unrelated receipt notice publication')
      const suppliedOrders = new Set(group.projections.map(item => item.orderDocumentId))
      for (const order of requiredOrders) if (!suppliedOrders.has(order)) throw new Error('Old or new affected order projection missing')
      for (const projection of group.projections) {
        if (!requiredOrders.has(projection.orderDocumentId)) throw new Error('Unrelated order publication')
        for (const table of projectionTables.slice(1).reverse()) await runner.query(`DELETE FROM ${table} WHERE company_id=$1 AND dataset_id=$2 AND order_document_id=$3`, [scope.companyId, scope.datasetId, projection.orderDocumentId])
        if (projection.deleted) {
          if (projection.rows.length) throw new Error('Deleted projection has rows')
          await runner.query('DELETE FROM hz_fop_workbench_orders WHERE company_id=$1 AND dataset_id=$2 AND document_id=$3', [scope.companyId, scope.datasetId, projection.orderDocumentId])
          continue
        }
        if (projection.rows.filter(row => row.table === 'hz_fop_workbench_orders').length !== 1 || !projection.rows.some(row => row.table === 'hz_fop_workbench_memberships')
          || !projection.rows.some(row => row.table === 'hz_fop_projection_dependencies' && row.values.source_document_id === projection.orderDocumentId)) throw new Error('Incomplete order publication or dependencies')
        for (const row of projection.rows) {
          if (!projectionTables.includes(row.table) || (row.values.order_document_id ?? row.values.document_id) !== projection.orderDocumentId) throw new Error('Invalid projection grain')
          await this.upsert(runner, scope, { table: row.table, values: { ...row.values, projection_revision: revision,
            ...(WORKBENCH_TABLE_COLUMNS[row.table].includes('published_at') ? { published_at: new Date().toISOString() } : {}) } })
        }
      }
      const invalidDependencies = await runner.query(`SELECT dep.id FROM hz_fop_projection_dependencies dep JOIN hz_fop_source_documents source ON source.id=dep.source_document_id AND source.company_id=dep.company_id AND source.dataset_id=dep.dataset_id
        WHERE dep.company_id=$1 AND dep.dataset_id=$2 AND dep.order_document_id=ANY($3::uuid[]) AND (dep.source_version IS DISTINCT FROM source.source_version OR dep.relation_revision<>source.relation_revision) AND NOT ($4::boolean AND source.source_version IS NULL AND source.validation_state='unverified' AND source.payload->>'bootstrapBatchId'=$5) LIMIT 1`, [scope.companyId, scope.datasetId, [...requiredOrders], snapshotMode,snapshot?.batchId ?? null])
      if (invalidDependencies.length) throw new Error('Projection dependency version mismatch')
      // Publication, source facts, removed memberships and the contiguous applied cursor commit together.
      await runner.query("UPDATE hz_fop_sync_commit_groups SET state='applied',applied_at=now(),updated_at=now() WHERE id=$1", [groupId])
      await runner.query("UPDATE hz_fop_sync_streams SET received_cursor=$2,applied_cursor=$2,last_received_at=now(),last_applied_at=now(),last_source_healthy_at=now(),updated_at=now() WHERE id=$1", [streamId, group.endCursor])
      // Reserved local metadata is distinct from the opaque source cursor vector; deletions never reset the revision.
      await runner.query("UPDATE hz_fop_datasets SET applied_watermarks=jsonb_set(applied_watermarks,'{_local}',COALESCE(applied_watermarks->'_local','{}'::jsonb)||jsonb_build_object('projectionRevision',$2::text)),updated_at=now() WHERE id=$1", [scope.datasetId, revision])
      await runner.commitTransaction(); return group.endCursor
    } catch (error) { await runner.rollbackTransaction(); throw error } finally { await runner.release() }
  }

  private async upsert(runner: QueryRunner, scope: ReplicaDatasetScope, row: ReplicaRow) {
    const columns = WORKBENCH_TABLE_COLUMNS[row.table], keys = WORKBENCH_PRIMARY_KEYS[row.table]
    if (!columns || !keys || Object.keys(row.values).some(key => !columns.includes(key))) throw new Error('Unapproved replica column')
    const values = { ...row.values }
    for (const [name, expected] of Object.entries({ company_id: scope.companyId, dataset_id: scope.datasetId, connection_id: scope.connectionId })) if (columns.includes(name)) {
      if (values[name] !== undefined && values[name] !== expected) throw new Error('Cross-scope replica row')
      values[name] = expected
    }
    if (keys.some(key => !values[key])) throw new Error('Missing stable replica row key')
    const existing = await runner.query(`SELECT * FROM "${row.table}" WHERE ${keys.map((key, i) => `"${key}"=$${i+1}`).join(' AND ')} FOR UPDATE`, keys.map(key => values[key]))
    if (existing.some((entry: Record<string, unknown>) => ['connection_id','company_id','dataset_id','document_id','order_document_id','source_line_id'].some(key => columns.includes(key) && (entry[key] ?? null) !== (values[key] ?? null)))) throw new Error('Replica row identity or scope collision')
    const names = Object.keys(values)
    const updates = columns.filter(name => !keys.includes(name)).map(name => `"${name}"=EXCLUDED."${name}"`).join(',')
    const parameters = names.map(name => { const value = values[name]; return name !== 'owner_employee_ids' && value !== null && typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value })
    const identity = ['connection_id','company_id','dataset_id','document_id','order_document_id','source_line_id'].filter(key => columns.includes(key)).map(key => `existing."${key}" IS NOT DISTINCT FROM EXCLUDED."${key}"`).join(' AND ')
    const written = await runner.query(`INSERT INTO "${row.table}" AS existing(${names.map(name => `"${name}"`).join(',')}) VALUES(${names.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT(${keys.map(key => `"${key}"`).join(',')}) DO UPDATE SET ${updates} WHERE ${identity} RETURNING "${keys[0]}"`, parameters)
    if (!written.length) throw new Error('Replica row identity or scope collision')
  }
}
