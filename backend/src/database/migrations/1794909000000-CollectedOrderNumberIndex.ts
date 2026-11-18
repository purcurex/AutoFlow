import { MigrationInterface, QueryRunner } from 'typeorm'
export class CollectedOrderNumberIndex1794909000000 implements MigrationInterface {
 async up(runner:QueryRunner):Promise<void>{await runner.query('CREATE INDEX IF NOT EXISTS ix_collected_order_number ON hz_fop_collected_orders(batch_id,order_number)')}
 async down(runner:QueryRunner):Promise<void>{await runner.query('DROP INDEX IF EXISTS ix_collected_order_number')}
}
