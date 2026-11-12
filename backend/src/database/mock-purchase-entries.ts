import type { EntityManager } from 'typeorm'
import { assertMockDatabase } from '../modules/workbench-replica/workbench-mock'

/** Synthetic fixtures only: each mock fulfillment allocation gets an explicit purchase source entry. */
export async function populateMockPurchaseEntries(m: EntityManager): Promise<void> {
  assertMockDatabase(m.connection)
  await m.query(`INSERT INTO hz_fop_source_lines(id,connection_id,company_id,dataset_id,document_id,entry_entity,source_entry_id,sequence,sku_code,product_name,variant,image_url,quantity,unit_code,source_version)
    SELECT md5(a.id::text||':mock-purchase-entry')::uuid,a.connection_id,a.company_id,a.dataset_id,a.purchase_document_id,'hzkj_billentry',
      'mock-entry-'||a.id::text,l.sequence,l.sku_code,l.product_name,l.variant,l.image_url,a.allocated_requirement_quantity,l.unit_code,1
    FROM hz_fop_workbench_purchase_allocations a JOIN hz_fop_source_lines l ON l.id=a.order_line_id AND l.company_id=a.company_id AND l.dataset_id=a.dataset_id
    ON CONFLICT(id) DO UPDATE SET quantity=EXCLUDED.quantity,removed_at=NULL`)
  await m.query(`INSERT INTO hz_fop_procurement_line_details(line_id,company_id,dataset_id,ordered_quantity,supplier_shipped_quantity,cancelled_quantity,sales_order_number)
    SELECT md5(a.id::text||':mock-purchase-entry')::uuid,a.company_id,a.dataset_id,a.allocated_requirement_quantity,a.supplier_shipped_quantity,0,o.order_number
    FROM hz_fop_workbench_purchase_allocations a JOIN hz_fop_workbench_orders o ON o.document_id=a.order_document_id AND o.company_id=a.company_id AND o.dataset_id=a.dataset_id
    ON CONFLICT(line_id) DO UPDATE SET ordered_quantity=EXCLUDED.ordered_quantity,supplier_shipped_quantity=EXCLUDED.supplier_shipped_quantity,sales_order_number=EXCLUDED.sales_order_number`)
  await m.query(`UPDATE hz_fop_workbench_purchase_allocations SET purchase_line_id=md5(id::text||':mock-purchase-entry')::uuid`)
  await m.query(`UPDATE hz_fop_source_lines l SET removed_at=now() FROM hz_fop_purchase_orders p WHERE p.document_id=l.document_id AND p.company_id=l.company_id AND p.dataset_id=l.dataset_id
    AND NOT EXISTS(SELECT 1 FROM hz_fop_workbench_purchase_allocations a WHERE a.purchase_line_id=l.id AND a.purchase_document_id=p.document_id)`)
}
