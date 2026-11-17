import { MigrationInterface, QueryRunner } from 'typeorm'
/** Correlated queue membership is looked up by batch and source parent identity. */
export class CollectedAllocationOrderIndex1794481000000 implements MigrationInterface {
 async up(q:QueryRunner):Promise<void>{await q.query(`CREATE INDEX hz_collected_allocation_parent_idx ON hz_fop_collected_entities(batch_id,(display->>'sourceOrderId')) WHERE entity_type='allocation'`)}
 async down(q:QueryRunner):Promise<void>{await q.query('DROP INDEX hz_collected_allocation_parent_idx')}
}
