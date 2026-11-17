import { MigrationInterface, QueryRunner } from 'typeorm'
export class CollectedEntities1794480000000 implements MigrationInterface {
 async up(q:QueryRunner):Promise<void>{await q.query(`CREATE TABLE hz_fop_collected_entities (
 batch_id uuid NOT NULL REFERENCES hz_fop_collected_batches(id) ON DELETE CASCADE,
 entity_type text NOT NULL,source_id text NOT NULL,owner_employee_id text,search_text text NOT NULL,
 display jsonb NOT NULL,raw jsonb NOT NULL,captured_at timestamptz NOT NULL,
 PRIMARY KEY(batch_id,entity_type,source_id));
 CREATE INDEX hz_fop_collected_entities_owner ON hz_fop_collected_entities(batch_id,entity_type,owner_employee_id)`)}
 async down(q:QueryRunner):Promise<void>{await q.query('DROP TABLE hz_fop_collected_entities')}
}
