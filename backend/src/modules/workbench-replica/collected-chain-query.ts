import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { chainSourceSignature } from './collected-chain-storage'
/** One SQL snapshot; root permission is checked before any downstream information is returned. */
export async function readCollectedChain(db:Pick<DataSource,'query'>,batch:Record<string,any>,employeeIds:readonly string[]|null,orderId:string,kind:'fulfillment'|'stock'='fulfillment'){
 const rows=await db.query(`
 WITH authorized AS (
 SELECT source_id FROM ${kind==='stock'?'hz_fop_collected_entities':'hz_fop_collected_orders'} WHERE batch_id=$1 AND source_id=$2 ${kind==='stock'?"AND entity_type='stock_orders'":''}
 AND ($3::text[] IS NULL OR owner_employee_id=ANY($3::text[]))
 ), chain AS (SELECT * FROM hz_fop_collected_chains WHERE batch_id=$1),
 root AS (SELECT d.* FROM hz_fop_source_documents d JOIN chain c ON c.dataset_id=d.dataset_id
 JOIN authorized a ON a.source_id=d.source_id JOIN ${kind==='stock'?'hz_fop_stock_orders':'hz_fop_fulfillment_orders'} f ON f.document_id=d.id
 WHERE d.entity_code='${kind==='stock'?'hzkj_stock_order_new':'hzkj_orders'}' AND ($3::text[] IS NULL OR f.owner_employee_id=ANY($3::text[]))),
 rel AS (SELECT r.*,p.basis FROM root o JOIN hz_fop_order_relation_paths p
 ON p.company_id=o.company_id AND p.dataset_id=o.dataset_id AND p.order_document_id=o.id
 JOIN hz_fop_document_relations r ON r.id=p.relation_id AND r.company_id=p.company_id AND r.dataset_id=p.dataset_id AND r.removed_at IS NULL AND r.resolution_state='resolved'),
 node_ids AS (SELECT id FROM root UNION SELECT from_document_id FROM rel UNION SELECT to_document_id FROM rel),
 line_ids AS (SELECT from_line_id AS id FROM rel WHERE from_line_id IS NOT NULL UNION SELECT to_line_id FROM rel WHERE to_line_id IS NOT NULL)
 SELECT EXISTS(SELECT 1 FROM authorized) AS authorized,
 (SELECT source_signature FROM chain) AS signature,(SELECT content_hash FROM chain) AS revision,
 (SELECT built_at FROM chain) AS built_at,(SELECT id FROM root) AS root_id,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'entity',d.entity_code,'sourceId',d.source_id,'number',d.document_number,'billStatus',d.raw_bill_status,'businessStatus',CASE WHEN d.entity_code='hzkj_purorderbill' THEN CASE d.payload->'raw'->>'hzkj_pay_status' WHEN '0' THEN '未支付' WHEN '1' THEN '已支付' WHEN '2' THEN '未支付已取消' WHEN '3' THEN '已退款' WHEN '4' THEN '部分退款' END END,'capturedAt',d.synced_at,'sourceVersion',d.source_version) ORDER BY d.entity_code,d.source_id)
 FROM hz_fop_source_documents d JOIN node_ids n ON n.id=d.id),'[]') AS documents,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'documentId',l.document_id,'sourceEntryId',l.source_entry_id,'sequence',l.sequence,'sku',l.sku_code) ORDER BY l.id)
 FROM hz_fop_source_lines l JOIN line_ids i ON i.id=l.id),'[]') AS lines,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'fromDocumentId',r.from_document_id,'toDocumentId',r.to_document_id,'fromLineId',r.from_line_id,'toLineId',r.to_line_id,'type',r.relation_type,'basis',r.basis,'quantity',r.allocated_quantity::text,'amount',r.allocated_amount::text,'currency',r.currency_code) ORDER BY r.id) FROM rel r),'[]') AS relations
 `,[batch.id,orderId,employeeIds])
 const r=rows[0]
 if(!r?.authorized)throw new NotFoundException('Order not found')
 if(!r.signature)throw new ServiceUnavailableException({code:'business_chain_not_built',message:'Local business chain has not been built'})
 if(r.signature!==chainSourceSignature(batch))throw new ConflictException({code:'business_chain_stale',message:'Collected sources changed; rebuild the local business chain'})
 if(!r.root_id)throw new NotFoundException('Order source not available in current scope')
 return {orderId,rootDocumentId:r.root_id,documents:r.documents,lines:r.lines,relations:r.relations,revision:r.revision,builtAt:r.built_at,
  dataAvailability:{mode:'collected',complete:false,nonconsistentSnapshot:true,sourceVersionsVerified:false,deletionsVerified:false,executionAvailable:false,
   reason:'仅展示可验证的来源关系；缺少关系不代表没有下游业务。关联数量、金额未知时留空，不使用合并单整单总额。'}}
}
