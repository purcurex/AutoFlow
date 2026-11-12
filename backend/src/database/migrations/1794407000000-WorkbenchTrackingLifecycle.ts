import type { MigrationInterface, QueryRunner } from 'typeorm'

export class WorkbenchTrackingLifecycle1794407000000 implements MigrationInterface {
  name = 'WorkbenchTrackingLifecycle1794407000000'
  async up(q: QueryRunner): Promise<void> {
    await q.query("COMMENT ON COLUMN hz_fop_order_packages.tracking_number IS '履约订单包裹 hzkj_tracking_number 回写镜像；制作发运单时取号，删除发运单清空，重建更新；待审核只展示自定义与实际渠道，不读取此号码'")
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query("COMMENT ON COLUMN hz_fop_order_packages.tracking_number IS '履约订单包裹 hzkj_tracking_number；独立于发运单号码，不推定全程或尾程类型'")
  }
}
