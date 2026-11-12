import type { MigrationInterface, QueryRunner } from 'typeorm'
export class WorkbenchConfirmedSources1794405000000 implements MigrationInterface {
 name='WorkbenchConfirmedSources1794405000000'
 async up(q:QueryRunner):Promise<void>{
  await q.query('ALTER TABLE hz_fop_fulfillment_orders ADD COLUMN custom_channel_id varchar(128), ADD COLUMN custom_channel_name text')
  await q.query('ALTER TABLE hz_fop_purchase_orders ADD COLUMN paid_at timestamptz')
  await q.query('ALTER TABLE hz_fop_stock_orders ADD COLUMN procurement_paid_at timestamptz')
  await q.query("COMMENT ON COLUMN hz_fop_fulfillment_orders.custom_channel_id IS '履约订单物流决策 hzkj_customer_channel.id；不使用实际渠道替代'")
  await q.query("COMMENT ON COLUMN hz_fop_fulfillment_orders.custom_channel_name IS '履约订单物流决策 hzkj_customer_channel.name'")
  await q.query("COMMENT ON COLUMN hz_fop_purchase_orders.paid_at IS '采购订单付款时间；具体FOP字段待确认，禁止创建时间兜底'")
  await q.query("COMMENT ON COLUMN hz_fop_stock_orders.procurement_paid_at IS '备货订单采购付款时间，供明确使用该库存的履约订单引用；具体源字段待确认'")
 }
 async down(q:QueryRunner):Promise<void>{
  await q.query('ALTER TABLE hz_fop_stock_orders DROP COLUMN procurement_paid_at')
  await q.query('ALTER TABLE hz_fop_purchase_orders DROP COLUMN paid_at')
  await q.query('ALTER TABLE hz_fop_fulfillment_orders DROP COLUMN custom_channel_id, DROP COLUMN custom_channel_name')
 }
}
