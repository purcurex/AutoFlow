import type { MigrationInterface, QueryRunner } from 'typeorm'
export class CollectedBusinessChain1794580000000 implements MigrationInterface {
 name='CollectedBusinessChain1794580000000'
 async up(q:QueryRunner):Promise<void>{await q.query(`
 CREATE TABLE hz_fop_collected_chains (
 batch_id uuid PRIMARY KEY REFERENCES hz_fop_collected_batches(id) ON DELETE RESTRICT,
 dataset_id uuid NOT NULL UNIQUE REFERENCES hz_fop_datasets(id) ON DELETE RESTRICT,
 source_signature text NOT NULL, content_hash text NOT NULL, mapping_version integer NOT NULL,
 summary jsonb NOT NULL, built_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE hz_fop_order_relation_paths (
 company_id uuid NOT NULL,dataset_id uuid NOT NULL,order_document_id uuid NOT NULL,relation_id uuid NOT NULL,
 basis text NOT NULL,
 PRIMARY KEY(company_id,dataset_id,order_document_id,relation_id),
 FOREIGN KEY(company_id,dataset_id,order_document_id) REFERENCES hz_fop_source_documents(company_id,dataset_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(relation_id) REFERENCES hz_fop_document_relations(id) ON DELETE RESTRICT);
 CREATE INDEX ix_order_relation_path_relation ON hz_fop_order_relation_paths(relation_id);
 COMMENT ON TABLE hz_fop_collected_chains IS '已采集非一致快照的规范关联索引；不得用作正式增量初始化证明';
 COMMENT ON TABLE hz_fop_order_relation_paths IS '已验证来源关系的履约/备货根单索引；不固化用户权限';`)}
 async down(q:QueryRunner):Promise<void>{await q.query('DROP TABLE hz_fop_order_relation_paths; DROP TABLE hz_fop_collected_chains')}
}
