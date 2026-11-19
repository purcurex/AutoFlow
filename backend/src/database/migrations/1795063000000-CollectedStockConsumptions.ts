import type {MigrationInterface,QueryRunner} from 'typeorm'
import {stockConsumptionTableSql} from '../../modules/workbench-replica/collected-stock-consumptions'
export class CollectedStockConsumptions1795063000000 implements MigrationInterface {
 name='CollectedStockConsumptions1795063000000'
 async up(q:QueryRunner):Promise<void>{
  await q.query(stockConsumptionTableSql)
  await q.query('CREATE INDEX ix_collected_stock_consumption_order_sku ON hz_fop_collected_stock_consumptions(batch_id,order_number,sku_id)')
  await q.query("COMMENT ON TABLE hz_fop_collected_stock_consumptions IS '备货单当前耗用记录：0预占，1客户支付确认；按备货单类型和订单SKU拆分，缺SKU保留未知。'")
 }
 async down(q:QueryRunner):Promise<void>{await q.query('DROP TABLE hz_fop_collected_stock_consumptions')}
}
