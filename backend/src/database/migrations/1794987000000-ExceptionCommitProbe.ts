import type { MigrationInterface, QueryRunner } from 'typeorm'

/** Deferred INSERT events remain queued after the first event drains the batch.
 * Probe the event's complete dirty-row key before invoking the batch scan again.
 * Keep the existing evaluator, flush ordering, revision and transaction boundary intact. */
export class ExceptionCommitProbe1794987000000 implements MigrationInterface {
  name = 'ExceptionCommitProbe1794987000000'
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE OR REPLACE FUNCTION hz_exception_commit_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.transaction_id=txid_current() AND EXISTS (
  SELECT 1 FROM hz_fop_exception_dirty
  WHERE batch_id=NEW.batch_id AND transaction_id=NEW.transaction_id
    AND document_kind=NEW.document_kind AND source_id=NEW.source_id
 ) THEN
  PERFORM hz_exception_flush_v1(NEW.batch_id);
 END IF;
 RETURN NULL;
END $$;`)
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`CREATE OR REPLACE FUNCTION hz_exception_commit_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM hz_exception_flush_v1(NEW.batch_id); RETURN NULL;
END $$;`)
  }
}
