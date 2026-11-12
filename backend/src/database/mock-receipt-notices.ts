import { createHash } from 'node:crypto'
import type { DataSource, EntityManager } from 'typeorm'
import { assertMockDatabase, MOCK_CREDENTIAL } from '../modules/workbench-replica/workbench-mock'

const uuid = (key: string) => { const h=createHash('sha256').update(`mock-receipt-v1:${key}`).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}` }
/** Additive, idempotent fixtures; only synthetic connections in the dedicated mock DB. */
export async function populateMockReceiptNotices(m: EntityManager): Promise<number> {
  const sources = await m.query(`SELECT DISTINCT ON (o.company_id,o.owner_employee_id) o.* FROM hz_fop_workbench_orders o JOIN hz_fop_connections c ON c.id=o.connection_id
    WHERE c.credential_ref=$1 AND c.tenant_id='local-mock' AND c.base_url='https://mock.invalid' AND o.order_kind='fulfillment'
    ORDER BY o.company_id,o.owner_employee_id,o.document_id`, [MOCK_CREDENTIAL])
  for (const [i,o] of sources.entries()) {
    await m.query(`INSERT INTO hz_fop_resource_grants(id,connection_id,company_id,resource_type,target_key,decision,verified_at,source_as_of,expires_at,evidence)
      VALUES($1,$2,$3,'receipt_notices','*','allow',now(),now(),now()+interval '1 hour','{"source":"mock"}') ON CONFLICT(id) DO NOTHING`, [uuid(`grant:${o.company_id}`),o.connection_id,o.company_id])
    const products = await m.query('SELECT * FROM hz_fop_workbench_order_lines WHERE order_document_id=$1 ORDER BY sequence,id',[o.document_id])
    // Pending, partially received, complete, not shipped, cancelled: only the first two qualify.
    for (let n=0;n<5;n++) {
      const id=uuid(`${o.dataset_id}:${o.owner_employee_id}:${n}`), number=`SH20261111${String(i*10+n+1).padStart(5,'0')}`
      const exists=await m.query('SELECT id FROM hz_fop_source_documents WHERE id=$1',[id]); if(exists.length)continue
      const lines=products.map((l: any,j: number)=>({id:uuid(`${id}:${j}`),sku:l.sku_code,name:l.product_name,variant:l.variant,imageUrl:l.image_url,quantity:Number(l.quantity),inboundQuantity:n===2?Number(l.quantity):n===1&&j===0?Number(l.quantity):0}))
      const quantity=lines.reduce((sum: number,l: any)=>sum+l.quantity,0), inbound=lines.reduce((sum: number,l: any)=>sum+l.inboundQuantity,0)
      await m.query(`INSERT INTO hz_fop_source_documents(id,connection_id,company_id,dataset_id,entity_code,source_id,document_number,source_version,raw_bill_status,validation_state,payload,source_created_at,synced_at)
        VALUES($1,$2,$3,$4,'hzkj_receiptnotice',$5,$6,1,'C','verified','{"source":"mock"}',now(),now())`,[id,o.connection_id,o.company_id,o.dataset_id,`mock-receipt-${i}-${n}`,number])
      await m.query(`INSERT INTO hz_fop_receipt_notices(document_id,company_id,dataset_id,supplier_id,warehouse_id,business_at,supplier_shipped_at,tracking_number,raw_wms_status,raw_shipping_status)
        VALUES($1,$2,$3,'mock-supplier',$4,now(),CASE WHEN $5::int=3 THEN NULL ELSE now()-($5::int+1)*interval '1 day' END,$6,$7,$8)`,[id,o.company_id,o.dataset_id,o.warehouse_id,n,n===3?null:`SFMOCK${String(i*10+n).padStart(10,'0')}`,['5','10','30','0','20'][n],n===3?'pending':'shipped'])
      await m.query(`INSERT INTO hz_fop_workbench_receipt_notices(document_id,source_version,owner_employee_ids,ownership_verified_at,shipment_state,carrier_name,quantity,inbound_quantity,lines)
        VALUES($1,1,$2,now(),$3,$4,$5,$6,$7)`,[id,[o.owner_employee_id],n===3?'pending':'shipped',n===3?null:'顺丰速运',quantity,inbound,JSON.stringify(lines)])
    }
  }
  return sources.length*5
}
export async function repairMockReceiptNotices(db: DataSource) {
  assertMockDatabase(db)
  return db.transaction(async m => {
    await m.query("SELECT pg_advisory_xact_lock(hashtextextended('schema-mock-write',0))")
    return populateMockReceiptNotices(m)
  })
}
