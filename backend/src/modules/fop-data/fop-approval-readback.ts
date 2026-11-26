import type { DataSource } from 'typeorm'
import type { ApprovalReadback } from './fop-approval.types'
import { normalizeNativeCapture } from './collected-native-facts'
import { normalizeBusinessTimestamp } from './fop-business-time'

/** Apply only freshly read source facts, not a synthetic local approval. Other
 * amounts, products and independently collected procurement facts are preserved. */
export async function persistApprovalReadback(db: DataSource, proof: ApprovalReadback): Promise<boolean> {
  const source = proof.page.items?.[0]
  const target = proof.entity === 'hzkj_orders' ? source : proof.page.facts?.allocations?.find((a: any) => a.id === proof.documentId)
  if (proof.page.items?.length !== 1 || source?.id !== proof.orderId || source?.hzkj_org?.id !== proof.companyId || target?.id !== proof.documentId
    || target?.billstatus !== 'C' || !['hzkj_orders', 'hzkj_alloc_bill'].includes(proof.entity)
    || proof.entity === 'hzkj_alloc_bill' && target.hzkj_order_id !== proof.orderId || !Number.isFinite(Date.parse(proof.capturedAt))) throw new Error('Unconfirmed approval readback')
  const native = normalizeNativeCapture([proof.page], { complete: true, coverage: 'full_parent_scan', companyId: proof.companyId, queue: 'allocation' })
  return db.transaction(async manager => {
    // Match timestamp/import lock order before changing source rows or exception projections.
    await manager.query("SELECT id FROM hz_fop_collected_batches WHERE state='active' AND tenant_id=$1 AND company_id=$2 ORDER BY id FOR UPDATE",[proof.tenantId,proof.companyId])
    const matches = await manager.query(`SELECT o.batch_id,o.owner_employee_id,o.raw,o.display FROM hz_fop_collected_orders o JOIN hz_fop_collected_batches b ON b.id=o.batch_id
      WHERE b.state='active' AND b.tenant_id=$1 AND b.company_id=$2 AND o.source_id=$3 FOR UPDATE OF o`, [proof.tenantId, proof.companyId, proof.orderId])
    if (!matches.length) return false
    for (const existing of matches) {
      if (existing.owner_employee_id !== source.hzkj_operator?.id || existing.raw.billno !== source.billno) throw new Error('Readback identity or owner changed')
      if (existing.display.approvalReadbackAt && existing.display.approvalReadbackAt > proof.capturedAt) continue
      const rawPatch = Object.fromEntries(['billstatus', 'hzkj_orderstatus', 'hzkj_receipt_status', 'hzkj_delivery_status', 'hzkj_purchase_status', 'hzkj_fulfillment_status', 'auditdate'].filter(key => Object.prototype.hasOwnProperty.call(source, key)).map(key => [key, source[key]]))
      const displayPatch = { ...(proof.entity === 'hzkj_alloc_bill' ? native.parents.get(proof.orderId) : {}), reviewStatus: source.billstatus === 'C' ? 'approved' : existing.display.reviewStatus,
        reviewedAt: normalizeBusinessTimestamp(source.auditdate), approvalReadbackAt: proof.capturedAt }
      await manager.query(`UPDATE hz_fop_collected_orders SET raw=raw||$3::jsonb,display=display||$4::jsonb,
        raw_bill_status=$5,raw_order_status=$6,raw_payment_status=$7,raw_delivery_status=$8 WHERE batch_id=$1 AND source_id=$2`,
      [existing.batch_id,proof.orderId,JSON.stringify(rawPatch),JSON.stringify(displayPatch),source.billstatus,source.hzkj_orderstatus,source.hzkj_receipt_status,source.hzkj_delivery_status])
      // The allocation audit context proves the current, complete one-order relation.
      // Detach disappeared predecessors, retaining their raw history and newer captures.
      if (proof.entity === 'hzkj_alloc_bill') {
        const currentIds = native.entities.filter(e => e.entityType === 'allocation' && e.display.sourceOrderId === proof.orderId && e.display.association?.state === 'verified').map(e => e.sourceId)
        if (!currentIds.includes(proof.documentId)) throw new Error('Allocation readback relation not verified')
        await manager.query(`UPDATE hz_fop_collected_entities SET display=display||jsonb_build_object('sourceOrderId',NULL,'previousSourceOrderId',$2::text,'association',jsonb_build_object('state','superseded_by_readback')),captured_at=$4
          WHERE batch_id=$1 AND entity_type='allocation' AND display->>'sourceOrderId'=$2 AND NOT(source_id=ANY($3::text[])) AND captured_at<=$4`,
        [existing.batch_id,proof.orderId,currentIds,proof.capturedAt])
      }
      for (const e of native.entities) {
        if (!['allocation','dispatch','delivery_notice','outbound'].includes(e.entityType)) continue
        await manager.query(`INSERT INTO hz_fop_collected_entities(batch_id,entity_type,source_id,owner_employee_id,search_text,display,raw,captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(batch_id,entity_type,source_id) DO UPDATE SET display=hz_fop_collected_entities.display||EXCLUDED.display,raw=hz_fop_collected_entities.raw||EXCLUDED.raw,captured_at=EXCLUDED.captured_at
          WHERE hz_fop_collected_entities.captured_at<=EXCLUDED.captured_at`,
        [existing.batch_id,e.entityType,e.sourceId,e.ownerEmployeeId,e.raw.billno??e.sourceId,JSON.stringify(e.display),JSON.stringify(e.raw),proof.capturedAt])
      }
      await manager.query(`UPDATE hz_fop_collected_batches SET metadata=jsonb_set(metadata,'{manualApprovalReadbackAt}',to_jsonb($2::text)) WHERE id=$1`,[existing.batch_id,proof.capturedAt])
    }
    return true
  })
}
