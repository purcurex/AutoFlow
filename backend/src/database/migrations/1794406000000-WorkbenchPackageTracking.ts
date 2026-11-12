import type { MigrationInterface, QueryRunner } from 'typeorm'
export class WorkbenchPackageTracking1794406000000 implements MigrationInterface {
 name='WorkbenchPackageTracking1794406000000'
 async up(q:QueryRunner):Promise<void>{
  await q.query('ALTER TABLE hz_fop_order_packages ADD COLUMN tracking_number text')
  await q.query("COMMENT ON COLUMN hz_fop_order_packages.tracking_number IS '履约订单包裹 hzkj_tracking_number；独立于发运单号码，不推定全程或尾程类型'")
 }
 async down(q:QueryRunner):Promise<void>{await q.query('ALTER TABLE hz_fop_order_packages DROP COLUMN tracking_number')}
}
