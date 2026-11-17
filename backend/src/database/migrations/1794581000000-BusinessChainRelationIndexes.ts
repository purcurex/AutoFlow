import type { MigrationInterface, QueryRunner } from 'typeorm'
export class BusinessChainRelationIndexes1794581000000 implements MigrationInterface {
 name='BusinessChainRelationIndexes1794581000000'
 async up(q:QueryRunner):Promise<void>{await q.query(`
 CREATE INDEX ix_chain_relation_from_document ON hz_fop_document_relations(company_id,dataset_id,from_document_id);
 CREATE INDEX ix_chain_relation_to_document ON hz_fop_document_relations(company_id,dataset_id,to_document_id);
 CREATE INDEX ix_chain_relation_holder ON hz_fop_document_relations(company_id,dataset_id,holder_document_id);
 ALTER TABLE hz_fop_order_relation_paths ADD CONSTRAINT fk_chain_relation_scope FOREIGN KEY(company_id,dataset_id,relation_id) REFERENCES hz_fop_document_relations(company_id,dataset_id,id) ON DELETE RESTRICT;
 `)}
 async down(q:QueryRunner):Promise<void>{await q.query(`ALTER TABLE hz_fop_order_relation_paths DROP CONSTRAINT fk_chain_relation_scope; DROP INDEX ix_chain_relation_from_document; DROP INDEX ix_chain_relation_to_document; DROP INDEX ix_chain_relation_holder;`)}
}
