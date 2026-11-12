import type { MigrationInterface, QueryRunner } from 'typeorm'
export class WorkbenchPurchaseSalesNumber1794408000000 implements MigrationInterface {
  name='WorkbenchPurchaseSalesNumber1794408000000'
  async up(q:QueryRunner):Promise<void>{
    await q.query('ALTER TABLE hz_fop_procurement_line_details ADD COLUMN sales_order_number varchar(200)')
    await q.query("COMMENT ON COLUMN hz_fop_procurement_line_details.sales_order_number IS '采购分录销售订单编号：hzkj_purorderbill.hzkj_billentry.hzkj_salbillnumber；整单履约笔数按去除首尾空白后的非空编号去重；NULL表示未同步，禁止用履约ID或分摊行数替代'")
  }
  async down(q:QueryRunner):Promise<void>{await q.query('ALTER TABLE hz_fop_procurement_line_details DROP COLUMN sales_order_number')}
}
