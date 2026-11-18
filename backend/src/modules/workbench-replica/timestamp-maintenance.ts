import type {QueryRunner} from 'typeorm'
/** Canonical facts and run receipts remain durable; only obsolete staging payloads expire. */
export async function pruneTimestampPages(q:QueryRunner,batchId:string,limit=100){
 if(!Number.isSafeInteger(limit)||limit<1||limit>5000)throw Error('timestamp_retention_limit_invalid')
 if(q.isTransactionActive)throw Error('timestamp_retention_transaction_active')
 await q.startTransaction()
 try{
  await q.query("SET LOCAL lock_timeout='2s'")
  await q.query("SET LOCAL statement_timeout='10s'")
  const [row]=await q.query(`WITH latest AS (
    SELECT DISTINCT ON(entity_code,mode) id FROM hz_fop_timestamp_runs
    WHERE batch_id=$1 AND state<>'running' ORDER BY entity_code,mode,started_at DESC,id DESC
   ), candidates AS (
    SELECT p.run_id,p.page_index FROM hz_fop_timestamp_pages p JOIN hz_fop_timestamp_runs r ON r.id=p.run_id
    WHERE r.batch_id=$1 AND r.state IN ('applied','projection_pending','failed')
     AND r.finished_at<now()-CASE WHEN r.state='failed' THEN interval '14 days' ELSE interval '7 days' END
     AND NOT EXISTS(SELECT 1 FROM latest WHERE latest.id=r.id)
     AND NOT EXISTS(SELECT 1 FROM hz_fop_timestamp_projection_tasks t WHERE t.run_id=r.id AND t.state='pending')
    ORDER BY r.finished_at,p.run_id,p.page_index LIMIT $2
   ), removed AS (
    DELETE FROM hz_fop_timestamp_pages p USING candidates c
    WHERE p.run_id=c.run_id AND p.page_index=c.page_index RETURNING p.run_id
   ) SELECT count(*)::int AS count FROM removed`,[batchId,limit])
  await q.commitTransaction();return {deletedPages:row.count as number}
 }catch(error){await q.rollbackTransaction();throw error}
}
