import { createHash } from 'node:crypto'
import { DataSource, EntityManager } from 'typeorm'
import { assertMockDatabase, MOCK_CREDENTIAL } from '../modules/workbench-replica/workbench-mock'

const id = (key: string) => {
  const hex = createHash('sha256').update(`mock-logistics:${key}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
const plans = [
  { provider: 'YT', name: '云途YT', channel: '云途标准专线' },
  { provider: '4PX', name: '递四方4PX', channel: '递四方标准专线' },
  { provider: 'YW', name: '燕文物流', channel: '燕文标准专线' },
]

/** Used by both fresh seeds and a non-destructive repair of existing synthetic orders. */
export async function populateMockLogistics(manager: EntityManager): Promise<number> {
  const rows = await manager.query(`SELECT o.* FROM hz_fop_workbench_orders o JOIN hz_fop_connections c ON c.id=o.connection_id
    WHERE o.order_kind='fulfillment' AND c.credential_ref=$1 AND c.tenant_id='local-mock' AND c.base_url='https://mock.invalid'
    ORDER BY o.document_id`, [MOCK_CREDENTIAL])
  for (const row of rows) {
    const plan = plans[createHash('sha256').update(row.document_id).digest().readUInt32BE(0) % plans.length]
    const provider = `mock-provider-${plan.provider}`, channel = `mock-channel-${plan.provider}-STD`
    for (const ref of [{ type: 'logistics_provider', source: provider, code: plan.provider, name: plan.name, parent: null },
      { type: 'actual_channel', source: channel, code: `MOCK-${plan.provider}-STD`, name: plan.channel, parent: provider }]) {
      await manager.query(`INSERT INTO hz_fop_reference_items(id,connection_id,company_id,resource_type,source_id,code,name,parent_source_id,attributes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'{"source":"mock"}') ON CONFLICT(connection_id,company_id,resource_type,source_id)
        DO UPDATE SET code=EXCLUDED.code,name=EXCLUDED.name,parent_source_id=EXCLUDED.parent_source_id,deleted_at=NULL`,
      [id(`${row.company_id}:${ref.source}`), row.connection_id, row.company_id, ref.type, ref.source, ref.code, ref.name, ref.parent])
    }
    const packageId = id(`package:${row.document_id}`)
    await manager.query(`INSERT INTO hz_fop_order_packages(id,connection_id,company_id,dataset_id,order_document_id,source_package_key,warehouse_id,provider_id,channel_id,expected_active,source_version)
      VALUES($1,$2,$3,$4,$5,'mock-selected-channel',$6,$7,$8,true,1)
      ON CONFLICT(id) DO UPDATE SET provider_id=EXCLUDED.provider_id,channel_id=EXCLUDED.channel_id,expected_active=true,removed_at=NULL`,
    [packageId, row.connection_id, row.company_id, row.dataset_id, row.document_id, row.warehouse_id, provider, channel])
    await manager.query('UPDATE hz_fop_order_packages SET tracking_number=NULL WHERE id=$1',[packageId])
    await manager.query('UPDATE hz_fop_tracking_numbers SET removed_at=now() WHERE package_id=$1',[packageId])
    const [dispatches] = await manager.query(`UPDATE hz_fop_dispatches d SET provider_id=$1,actual_channel_id=$2
      FROM hz_fop_document_relations r WHERE r.from_document_id=$3 AND r.to_document_id=d.document_id
      AND r.connection_id=$4 AND r.company_id=$5 AND r.dataset_id=$6 AND d.company_id=r.company_id AND d.dataset_id=r.dataset_id
      AND r.relation_type='dispatch' AND r.resolution_state='resolved' AND r.removed_at IS NULL RETURNING d.document_id`,
    [provider, channel, row.document_id, row.connection_id, row.company_id, row.dataset_id])
    const documents = dispatches.length ? await manager.query(`SELECT id,raw_bill_status FROM hz_fop_source_documents WHERE id=ANY($1::uuid[]) AND validation_state='verified' AND deleted_at IS NULL`, [dispatches.map((d: {document_id: string}) => d.document_id)]) : []
    const state = !documents.length ? 'dispatch_missing' : row.shopify_sync_state === 'synced' ? 'dispatch_synced'
      : documents.every((d: {raw_bill_status:string})=>d.raw_bill_status==='C') ? 'dispatch_tracking' : 'dispatch_pending'
    if(documents.length)await manager.query(`UPDATE hz_fop_dispatches SET raw_delivery_status=$1 WHERE document_id=ANY($2::uuid[])`,[state==='dispatch_synced'?'FULFILLED':state==='dispatch_tracking'?'TRACKING_OBTAINED':'PENDING',documents.map((d:{id:string})=>d.id)])
    await manager.query('UPDATE hz_fop_workbench_orders SET dispatch_task_state=$1 WHERE document_id=$2', [state === 'dispatch_tracking' ? 'dispatch_approved' : state,row.document_id])
    // Approval is downstream of obtaining the selected tracking number, upstream of Shopify fulfillment.
    // A paid order alone does not prove dispatch preparation.
    if (row.order_review_state === 'approved' && documents.length === 1 && documents[0].raw_bill_status === 'C') {
      await manager.query(`INSERT INTO hz_fop_tracking_numbers(id,connection_id,company_id,dataset_id,dispatch_document_id,package_id,tracking_type,number,provider_id,shopify_selected,source_version)
        VALUES($1,$2,$3,$4,$5,$6,'full',$7,$8,true,1) ON CONFLICT(id) DO UPDATE SET dispatch_document_id=EXCLUDED.dispatch_document_id,number=EXCLUDED.number,provider_id=EXCLUDED.provider_id,shopify_selected=true,removed_at=NULL`,
      [id(`tracking:${row.document_id}`), row.connection_id, row.company_id, row.dataset_id, documents[0].id, packageId,
        `MOCK${plan.provider}${row.order_number.replace(/\D/g, '')}${documents[0].id.replace(/-/g, '').slice(-6)}`, provider])
      await manager.query(`UPDATE hz_fop_tracking_numbers SET removed_at=NULL WHERE package_id=$1 AND dispatch_document_id=$2 AND tracking_type='last_mile'`,[packageId,documents[0].id])
      await manager.query(`UPDATE hz_fop_order_packages SET tracking_number=(SELECT number FROM hz_fop_tracking_numbers WHERE id=$2 AND removed_at IS NULL) WHERE id=$1`,[packageId,id(`tracking:${row.document_id}`)])
    }
  }
  return rows.length
}

export async function repairMockLogistics(db: DataSource): Promise<number> {
  assertMockDatabase(db)
  return db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['schema-mock-write'])
    return populateMockLogistics(manager)
  })
}
