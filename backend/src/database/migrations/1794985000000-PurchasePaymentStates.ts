import type {MigrationInterface,QueryRunner} from 'typeorm'
export class PurchasePaymentStates1794985000000 implements MigrationInterface {
 name='PurchasePaymentStates1794985000000'
 async up(q:QueryRunner){
  const [definition]=await q.query("SELECT pg_get_functiondef('hz_exception_procurement_reason_number_v3(uuid,text)'::regprocedure) sql")
  let sql=definition.sql.replace("NOT IN ('0','1','3')","NOT IN ('0','1','2','3','4')")
  if(!sql.includes("trim(l->>'hzkj_srcbillnumber')=order_number")) sql=sql.replace("trim(l->>'hzkj_salbillnumber')=order_number","(trim(l->>'hzkj_srcbillnumber')=order_number OR trim(l->>'hzkj_salbillnumber')=order_number)")
  await q.query(sql)
  const [evaluation]=await q.query("SELECT pg_get_functiondef('hz_exception_evaluate_order_v2(uuid,text,boolean)'::regprocedure) sql")
  await q.query(evaluation.sql.replaceAll('procurement-number-v3','procurement-payment-v5'))
  await q.query("SELECT hz_exception_enqueue_v1(batch_id,'order',source_id) FROM hz_fop_collected_orders WHERE exception_reason LIKE '%采购付款信息不完整%' OR exception_reason LIKE '%采购关联未核实%'")
  await q.query('SELECT hz_exception_flush_v1(id) FROM hz_fop_collected_batches')
 }
 async down(q:QueryRunner){
  const [evaluation]=await q.query("SELECT pg_get_functiondef('hz_exception_evaluate_order_v2(uuid,text,boolean)'::regprocedure) sql")
  await q.query(evaluation.sql.replaceAll('procurement-payment-v5','procurement-number-v3'))
  const [definition]=await q.query("SELECT pg_get_functiondef('hz_exception_procurement_reason_number_v3(uuid,text)'::regprocedure) sql")
  await q.query(definition.sql.replace("NOT IN ('0','1','2','3','4')","NOT IN ('0','1','3')").replace("(trim(l->>'hzkj_srcbillnumber')=order_number OR trim(l->>'hzkj_salbillnumber')=order_number)","trim(l->>'hzkj_salbillnumber')=order_number"))
 }
}
