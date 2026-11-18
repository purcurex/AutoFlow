import type { MigrationInterface, QueryRunner } from 'typeorm'
/** Local, rebuildable exception projection. Source writes + marks + revision commit atomically.
 * Rule v1 is frozen here; a rule upgrade must explicitly rebuild, never rescan from a read request. */
export class PersistedExceptionState1794980000000 implements MigrationInterface {
 name='PersistedExceptionState1794980000000'
 async up(q:QueryRunner):Promise<void>{
  await q.query('ALTER TABLE hz_fop_collected_orders ADD COLUMN is_exception boolean NOT NULL DEFAULT false, ADD COLUMN exception_type text, ADD COLUMN exception_reason text, ADD COLUMN exception_code text, ADD COLUMN exception_checked_at timestamptz, ADD COLUMN exception_changed_at timestamptz, ADD COLUMN exception_facts_hash text, ADD COLUMN exception_rule_version integer NOT NULL DEFAULT 0, ADD COLUMN exception_dispatch_linked boolean NOT NULL DEFAULT false')
  await q.query('ALTER TABLE hz_fop_collected_entities ADD COLUMN is_exception boolean NOT NULL DEFAULT false, ADD COLUMN exception_type text, ADD COLUMN exception_reason text, ADD COLUMN exception_code text, ADD COLUMN exception_checked_at timestamptz, ADD COLUMN exception_changed_at timestamptz, ADD COLUMN exception_facts_hash text, ADD COLUMN exception_rule_version integer NOT NULL DEFAULT 0, ADD COLUMN exception_dispatch_linked boolean NOT NULL DEFAULT false')
  await q.query(String.raw`
-- Separate version row: source-first maintenance must not wait on a publisher's batch FOR UPDATE.
CREATE TABLE hz_fop_exception_versions(batch_id uuid PRIMARY KEY,revision bigint NOT NULL DEFAULT 0,transaction_id bigint);
CREATE FUNCTION hz_exception_batch_deleted_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM hz_fop_exception_dirty WHERE batch_id=OLD.id;
 DELETE FROM hz_fop_exception_versions WHERE batch_id=OLD.id;
 RETURN OLD;
END $$;
CREATE TRIGGER hz_exception_batch_delete AFTER DELETE ON hz_fop_collected_batches FOR EACH ROW EXECUTE FUNCTION hz_exception_batch_deleted_v1();
CREATE TABLE hz_fop_exception_dirty (
 batch_id uuid NOT NULL,
 document_kind text NOT NULL CHECK(document_kind IN ('order','stock','revision')), source_id text NOT NULL,
 dispatch_changed boolean NOT NULL DEFAULT false, transaction_id bigint NOT NULL DEFAULT txid_current(), PRIMARY KEY(batch_id,transaction_id,document_kind,source_id)
);
CREATE INDEX ix_exception_allocation_parent ON hz_fop_collected_entities(batch_id,(display->>'sourceOrderId')) WHERE entity_type='allocation';
CREATE INDEX ix_exception_dispatch_parent ON hz_fop_collected_entities(batch_id,(display->>'sourceOrderId')) WHERE entity_type='dispatch';
CREATE FUNCTION hz_exception_revision_v1(p_batch uuid) RETURNS void LANGUAGE sql AS $$
 INSERT INTO hz_fop_exception_versions(batch_id,revision,transaction_id) VALUES(p_batch,1,txid_current())
 ON CONFLICT(batch_id) DO UPDATE SET revision=hz_fop_exception_versions.revision+1,transaction_id=txid_current()
 WHERE hz_fop_exception_versions.transaction_id IS DISTINCT FROM txid_current();
$$;
CREATE FUNCTION hz_exception_enqueue_v1(p_batch uuid,p_kind text,p_id text,p_dispatch boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF p_id IS NULL OR p_id='' OR NOT EXISTS(SELECT 1 FROM hz_fop_collected_batches WHERE id=p_batch) THEN RETURN; END IF;
 INSERT INTO hz_fop_exception_dirty(batch_id,document_kind,source_id,dispatch_changed) VALUES(p_batch,p_kind,p_id,p_dispatch)
 ON CONFLICT(batch_id,transaction_id,document_kind,source_id) DO UPDATE SET dispatch_changed=hz_fop_exception_dirty.dispatch_changed OR excluded.dispatch_changed;
END $$;
CREATE FUNCTION hz_exception_source_changed_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior jsonb; current_row jsonb; b uuid; kind text; sid text; parent text;
BEGIN
 prior=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 current_row=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 -- Own projection writes and unchanged source replays never cause another check.
 IF TG_OP='UPDATE' AND (prior - ARRAY['is_exception','exception_type','exception_reason','exception_code','exception_checked_at','exception_changed_at','exception_facts_hash','exception_rule_version','exception_dispatch_linked','captured_at'])
  IS NOT DISTINCT FROM (current_row - ARRAY['is_exception','exception_type','exception_reason','exception_code','exception_checked_at','exception_changed_at','exception_facts_hash','exception_rule_version','exception_dispatch_linked','captured_at']) THEN RETURN NEW; END IF;
 b=coalesce(current_row->>'batch_id',prior->>'batch_id')::uuid;
 PERFORM hz_exception_enqueue_v1(b,'revision','batch');
 IF TG_TABLE_NAME='hz_fop_collected_orders' THEN
  IF TG_OP<>'DELETE' THEN PERFORM hz_exception_enqueue_v1(b,'order',current_row->>'source_id'); END IF;
 ELSIF TG_TABLE_NAME='hz_fop_collected_entities' THEN
  kind=coalesce(current_row->>'entity_type',prior->>'entity_type');
  IF kind='stock_orders' THEN PERFORM hz_exception_enqueue_v1(b,'stock',coalesce(current_row->>'source_id',prior->>'source_id'));
  ELSIF kind IN ('allocation','dispatch') THEN
   PERFORM hz_exception_enqueue_v1(b,'order',prior->'display'->>'sourceOrderId',kind='dispatch');
   PERFORM hz_exception_enqueue_v1(b,'order',current_row->'display'->>'sourceOrderId',kind='dispatch');
  END IF;
 ELSIF coalesce(current_row->>'entity_type',prior->>'entity_type')='stock' THEN
  PERFORM hz_exception_enqueue_v1(b,'stock',coalesce(current_row->>'source_id',prior->>'source_id'));
 END IF;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE FUNCTION hz_exception_evaluate_order_v1(p_batch uuid,p_id text,p_dispatch boolean DEFAULT false)
RETURNS TABLE(flag boolean,category text,reason text,code text,facts_hash text,dispatch_linked boolean) LANGUAGE sql AS $$
 WITH root AS (
 SELECT o.*, (p_dispatch OR o.exception_dispatch_linked OR b.metadata->'entityCaptures'->'dispatch'->>'coverage' IN ('full_parent_scan','full_company_scan')
  OR EXISTS(SELECT 1 FROM hz_fop_collected_entities e WHERE e.batch_id=p_batch AND e.entity_type='dispatch' AND e.display->>'sourceOrderId'=p_id)) IS TRUE AS use_dispatch
 FROM hz_fop_collected_orders o JOIN hz_fop_collected_batches b ON b.id=o.batch_id WHERE o.batch_id=p_batch AND o.source_id=p_id
 ), hz_fop_collected_orders AS (
 SELECT r.batch_id,r.source_id,r.raw_order_status,r.raw_bill_status,r.raw_payment_status,r.raw_delivery_status,r.paid_at,r.raw,r.use_dispatch,
  CASE WHEN r.use_dispatch THEN r.display || jsonb_build_object('dispatchDocuments',coalesce((SELECT jsonb_agg(e.display ORDER BY e.source_id) FROM hz_fop_collected_entities e WHERE e.batch_id=p_batch AND e.entity_type='dispatch' AND e.display->>'sourceOrderId'=p_id),'[]'::jsonb)) ELSE r.display END AS display
 FROM root r
 ), state AS (
 SELECT *, (CASE WHEN raw_order_status='6' OR (raw_payment_status='1' AND paid_at IS NULL
 AND display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id) THEN 'logistics_exception' WHEN (raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified'
 AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus'='SYNC_FAILED')) OR (raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified' AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED'
 AND (d->>'deliveryStatus'='TRACKING_OBTAINED' OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type' IN ('full','first_mile','last_mile') AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type'='full' AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))) OR (raw_bill_status='C' AND raw_order_status IN ('4','5')
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof((CASE WHEN display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END))='array' THEN (CASE WHEN display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END) ELSE '[]'::jsonb END) pkg
 WHERE jsonb_typeof(pkg->'hzkj_tracking_number')='string' AND NULLIF(trim(pkg->>'hzkj_tracking_number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL)) THEN 'dispatch_exception' ELSE COALESCE((CASE WHEN hz_fop_collected_orders.display->'exception'->>'code' IN ('paid_date_missing','fulfillment_cancelled')
   OR (hz_fop_collected_orders.display->'exception'->>'type'='dispatch_exception' AND hz_fop_collected_orders.display->'exception'->>'reason' IN ('Shopify跟踪号同步失败，请重新同步；成功回写后进入已履约清单。','已取号订单缺少物流跟踪号','已履约订单缺少物流跟踪号'))
   OR (hz_fop_collected_orders.display->'exception'->>'type'='outbound_exception' AND hz_fop_collected_orders.display->'exception'->>'reason'='部分出库无法核实')
   OR (hz_fop_collected_orders.display->'exception'->>'type'='allocation_exception' AND hz_fop_collected_orders.display->'exception'->>'reason'='配货单报错')
   THEN NULL ELSE NULLIF(hz_fop_collected_orders.display->'exception'->>'type','') END), CASE WHEN (hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown') THEN 'outbound_exception' WHEN EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id AND a.display->>'rawAllocationStatus'='error') THEN 'allocation_exception' END) END) AS diagnostic FROM hz_fop_collected_orders
 ) SELECT coalesce(((raw_order_status='6' OR (raw_payment_status='1' AND paid_at IS NULL
 AND display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id) OR ((coalesce(COALESCE((CASE WHEN hz_fop_collected_orders.display->'exception'->>'code' IN ('paid_date_missing','fulfillment_cancelled')
   OR (hz_fop_collected_orders.display->'exception'->>'type'='dispatch_exception' AND hz_fop_collected_orders.display->'exception'->>'reason' IN ('Shopify跟踪号同步失败，请重新同步；成功回写后进入已履约清单。','已取号订单缺少物流跟踪号','已履约订单缺少物流跟踪号'))
   OR (hz_fop_collected_orders.display->'exception'->>'type'='outbound_exception' AND hz_fop_collected_orders.display->'exception'->>'reason'='部分出库无法核实')
   OR (hz_fop_collected_orders.display->'exception'->>'type'='allocation_exception' AND hz_fop_collected_orders.display->'exception'->>'reason'='配货单报错')
   THEN NULL ELSE NULLIF(hz_fop_collected_orders.display->'exception'->>'type','') END), CASE WHEN (hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown') THEN 'outbound_exception' WHEN EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id AND a.display->>'rawAllocationStatus'='error') THEN 'allocation_exception' END),'')<>'' AND (display->'exception'->>'code' IS DISTINCT FROM 'paid_date_missing' OR (raw_payment_status='1' AND paid_at IS NULL
 AND display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id)) AND NOT (display->'exception'->>'type'='dispatch_exception' AND raw_order_status IN ('no','1') AND (CASE WHEN jsonb_exists(raw,'hzkj_fulfillment_status') THEN raw->>'hzkj_fulfillment_status'
  WHEN display->'salesSourceStatus'->>'source'='fulfillment_capture'
   AND display->'salesSourceStatus'->>'sourceId'=source_id
   AND display->'salesSourceStatus'->>'orderStatus'=raw_order_status
  THEN display->'salesSourceStatus'->>'fulfillmentStatus' END) IS DISTINCT FROM 'fulfilled')) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(display->'nativeAssociationIssues','[]'::jsonb)) issue WHERE issue IN ('parent_version_conflict','dispatch_relationship_conflict','allocation_relationship_conflict')) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(display->'nativeProcurementAssociationIssues','[]'::jsonb)) issue WHERE issue IN ('current_purchase_relationship_conflict')) OR (hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown') OR (raw_order_status IN ('2','3') AND display->>'dispatchTaskStatus'='dispatch_synced') OR EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id AND a.display->>'rawAllocationStatus'='error')) OR ((raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified'
 AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus'='SYNC_FAILED')) OR (raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified' AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED'
 AND (d->>'deliveryStatus'='TRACKING_OBTAINED' OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type' IN ('full','first_mile','last_mile') AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type'='full' AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))) OR (raw_bill_status='C' AND raw_order_status IN ('4','5')
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof((CASE WHEN display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END))='array' THEN (CASE WHEN display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END) ELSE '[]'::jsonb END) pkg
 WHERE jsonb_typeof(pkg->'hzkj_tracking_number')='string' AND NULLIF(trim(pkg->>'hzkj_tracking_number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))) OR (raw_order_status IS NULL OR raw_order_status NOT IN ('0','1','2','3','4','5','6','no') OR (raw_order_status IN ('2','3','4','5') AND (raw_payment_status IS NULL OR raw_payment_status NOT IN ('0','1')))))),false),diagnostic,(CASE WHEN raw_order_status='6' THEN '取消履约' WHEN (raw_payment_status='1' AND paid_at IS NULL
 AND display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id) THEN '收款日期为空' WHEN (raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified'
 AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus'='SYNC_FAILED')) THEN 'Shopify跟踪号同步失败，请重新同步；成功回写后进入已履约清单。' WHEN (raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified' AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED'
 AND (d->>'deliveryStatus'='TRACKING_OBTAINED' OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type' IN ('full','first_mile','last_mile') AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type'='full' AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))) THEN '已取号订单缺少物流跟踪号' WHEN (raw_bill_status='C' AND raw_order_status IN ('4','5')
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof((CASE WHEN display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END))='array' THEN (CASE WHEN display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END) ELSE '[]'::jsonb END) pkg
 WHERE jsonb_typeof(pkg->'hzkj_tracking_number')='string' AND NULLIF(trim(pkg->>'hzkj_tracking_number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL)) THEN '已履约订单缺少物流跟踪号' WHEN diagnostic='outbound_exception' AND raw_delivery_status='1' AND display->'businessStatus'->>'outbound'='unknown' THEN '部分出库无法核实' WHEN diagnostic='allocation_exception' AND EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=p_batch AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=p_id AND a.display->>'rawAllocationStatus'='error') THEN '配货单报错' WHEN diagnostic IS NOT NULL THEN display->'exception'->>'reason' END),(CASE WHEN raw_order_status='6' THEN 'fulfillment_cancelled' WHEN (raw_payment_status='1' AND paid_at IS NULL
 AND display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id) THEN 'paid_date_missing' WHEN diagnostic=display->'exception'->>'type' THEN display->'exception'->>'code' END),
 md5(jsonb_build_array(raw,display-'timestampProjection',raw_order_status,raw_bill_status,raw_payment_status,raw_delivery_status,paid_at,
  (SELECT jsonb_agg(jsonb_build_array(e.source_id,e.display) ORDER BY e.source_id) FROM hz_fop_collected_entities e WHERE e.batch_id=p_batch AND e.entity_type='allocation' AND e.display->>'sourceOrderId'=p_id))::text),use_dispatch
 FROM state hz_fop_collected_orders;
$$;
CREATE FUNCTION hz_exception_recheck_v1(p_batch uuid,p_kind text,p_id text,p_dispatch boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v record; prior record; source record; reasons text[]; hash text;
BEGIN
 IF p_kind='order' THEN
  SELECT * INTO prior FROM hz_fop_collected_orders WHERE batch_id=p_batch AND source_id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v FROM hz_exception_evaluate_order_v1(p_batch,p_id,p_dispatch);
  IF prior.exception_facts_hash=v.facts_hash AND prior.exception_rule_version=1 THEN RETURN; END IF;
  UPDATE hz_fop_collected_orders SET is_exception=v.flag,exception_type=CASE WHEN v.flag THEN v.category END,
   exception_reason=CASE WHEN v.flag THEN v.reason END,exception_code=CASE WHEN v.flag THEN v.code END,
   exception_facts_hash=v.facts_hash,exception_rule_version=1,exception_dispatch_linked=v.dispatch_linked,
   exception_checked_at=clock_timestamp(),exception_changed_at=CASE WHEN (prior.is_exception,prior.exception_type,prior.exception_reason,prior.exception_code) IS DISTINCT FROM (v.flag,CASE WHEN v.flag THEN v.category END,CASE WHEN v.flag THEN v.reason END,CASE WHEN v.flag THEN v.code END) THEN clock_timestamp() ELSE prior.exception_changed_at END
  WHERE batch_id=p_batch AND source_id=p_id;
 ELSE
  SELECT * INTO prior FROM hz_fop_collected_entities WHERE batch_id=p_batch AND entity_type='stock_orders' AND source_id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT f.raw INTO source FROM hz_fop_collected_analytics_facts f JOIN hz_fop_collected_batches b ON b.id=f.batch_id
   WHERE f.batch_id=p_batch AND f.entity_type='stock' AND f.source_id=p_id AND f.company_id=b.company_id AND f.raw->>'org_id'=b.company_id AND f.raw->>'id'=p_id AND f.raw->>'billno'=prior.display->>'stockNumber';
  hash=md5(jsonb_build_array(prior.display-'timestampProjection',prior.owner_employee_id,source.raw)::text);
  IF prior.exception_facts_hash=hash AND prior.exception_rule_version=1 THEN RETURN; END IF;
  reasons=ARRAY[]::text[];
  IF prior.owner_employee_id IS NULL AND source.raw ? 'hzkj_operator_id' AND coalesce(trim(source.raw->>'hzkj_operator_id'),'') IN ('','0') THEN reasons=array_append(reasons,'业务员为空'); END IF;
  IF source.raw->>'hzkj_orderstatus'='2' AND source.raw ? 'hzkj_receipt_status' AND coalesce(trim(source.raw->>'hzkj_receipt_status'),'')='' AND source.raw ? 'hzkj_receipt_date' AND coalesce(trim(source.raw->>'hzkj_receipt_date'),'')='' THEN reasons=array_append(reasons,'已支付，收款状态为空'); END IF;
  UPDATE hz_fop_collected_entities SET is_exception=cardinality(reasons)>0,exception_type=CASE WHEN cardinality(reasons)>0 THEN 'logistics_exception' END,
   exception_reason=nullif(array_to_string(reasons,'；'),''),exception_code=CASE WHEN cardinality(reasons)>0 THEN 'stock_data_missing' END,
   exception_facts_hash=hash,exception_rule_version=1,exception_checked_at=clock_timestamp(),
   exception_changed_at=CASE WHEN prior.exception_reason IS DISTINCT FROM nullif(array_to_string(reasons,'；'),'') THEN clock_timestamp() ELSE prior.exception_changed_at END
  WHERE batch_id=p_batch AND entity_type='stock_orders' AND source_id=p_id;
 END IF;
END $$;
CREATE FUNCTION hz_exception_flush_v1(p_batch uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record; changed boolean=false;
BEGIN
 FOR r IN SELECT * FROM hz_fop_exception_dirty WHERE batch_id=p_batch AND transaction_id=txid_current() ORDER BY document_kind,source_id FOR UPDATE LOOP
  changed=true;
  IF r.document_kind<>'revision' THEN PERFORM hz_exception_recheck_v1(r.batch_id,r.document_kind,r.source_id,r.dispatch_changed); END IF;
  DELETE FROM hz_fop_exception_dirty WHERE batch_id=r.batch_id AND document_kind=r.document_kind AND source_id=r.source_id AND transaction_id=txid_current();
 END LOOP;
 IF changed THEN PERFORM hz_exception_revision_v1(p_batch); END IF;
END $$;
CREATE FUNCTION hz_exception_commit_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM hz_exception_flush_v1(NEW.batch_id); RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER hz_exception_at_commit AFTER INSERT ON hz_fop_exception_dirty DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hz_exception_commit_v1();
`)
  await q.query('CREATE TRIGGER hz_exception_source_create_delete AFTER INSERT OR DELETE ON hz_fop_collected_orders FOR EACH ROW EXECUTE FUNCTION hz_exception_source_changed_v1()')
  await q.query('CREATE TRIGGER hz_exception_source_change AFTER UPDATE OF batch_id,source_id,order_number,owner_employee_id,customer_id,warehouse_code,country_code,bill_type,raw_bill_status,raw_order_status,raw_payment_status,raw_delivery_status,created_at,paid_at,consumer_paid_at,product_amount,total_amount,currency_code,total_quantity,search_text,display,raw ON hz_fop_collected_orders FOR EACH ROW EXECUTE FUNCTION hz_exception_source_changed_v1()')
  await q.query('CREATE TRIGGER hz_exception_source_create_delete AFTER INSERT OR DELETE ON hz_fop_collected_entities FOR EACH ROW EXECUTE FUNCTION hz_exception_source_changed_v1()')
  await q.query('CREATE TRIGGER hz_exception_source_change AFTER UPDATE OF batch_id,entity_type,source_id,owner_employee_id,search_text,display,raw ON hz_fop_collected_entities FOR EACH ROW EXECUTE FUNCTION hz_exception_source_changed_v1()')
  await q.query('CREATE TRIGGER hz_exception_source_create_delete AFTER INSERT OR DELETE ON hz_fop_collected_analytics_facts FOR EACH ROW EXECUTE FUNCTION hz_exception_source_changed_v1()')
  await q.query('CREATE TRIGGER hz_exception_source_change AFTER UPDATE OF batch_id,entity_type,source_id,company_id,document_number,owner_employee_id,customer_id,department_id,created_at,paid_at,source_paid_at,occurred_at,amount,currency_code,quantity,raw_status,facts,raw ON hz_fop_collected_analytics_facts FOR EACH ROW EXECUTE FUNCTION hz_exception_source_changed_v1()')
  await q.query(String.raw`WITH evaluated(batch_id,source_id,flag,category,reason,code,facts_hash,dispatch_linked) AS ( WITH root AS (
 SELECT o.*, (false OR o.exception_dispatch_linked OR b.metadata->'entityCaptures'->'dispatch'->>'coverage' IN ('full_parent_scan','full_company_scan')
  OR EXISTS(SELECT 1 FROM hz_fop_collected_entities e WHERE e.batch_id=o.batch_id AND e.entity_type='dispatch' AND e.display->>'sourceOrderId'=o.source_id)) IS TRUE AS use_dispatch
 FROM hz_fop_collected_orders o JOIN hz_fop_collected_batches b ON b.id=o.batch_id
 ), hz_fop_collected_orders AS (
 SELECT r.batch_id,r.source_id,r.raw_order_status,r.raw_bill_status,r.raw_payment_status,r.raw_delivery_status,r.paid_at,r.raw,r.use_dispatch,
  CASE WHEN r.use_dispatch THEN r.display || jsonb_build_object('dispatchDocuments',coalesce((SELECT jsonb_agg(e.display ORDER BY e.source_id) FROM hz_fop_collected_entities e WHERE e.batch_id=r.batch_id AND e.entity_type='dispatch' AND e.display->>'sourceOrderId'=r.source_id),'[]'::jsonb)) ELSE r.display END AS display
 FROM root r
 ), state AS (
 SELECT *, (CASE WHEN raw_order_status='6' OR (raw_payment_status='1' AND paid_at IS NULL
 AND display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id) THEN 'logistics_exception' WHEN (raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified'
 AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus'='SYNC_FAILED')) OR (raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified' AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED'
 AND (d->>'deliveryStatus'='TRACKING_OBTAINED' OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type' IN ('full','first_mile','last_mile') AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type'='full' AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))) OR (raw_bill_status='C' AND raw_order_status IN ('4','5')
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof((CASE WHEN display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END))='array' THEN (CASE WHEN display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END) ELSE '[]'::jsonb END) pkg
 WHERE jsonb_typeof(pkg->'hzkj_tracking_number')='string' AND NULLIF(trim(pkg->>'hzkj_tracking_number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL)) THEN 'dispatch_exception' ELSE COALESCE((CASE WHEN hz_fop_collected_orders.display->'exception'->>'code' IN ('paid_date_missing','fulfillment_cancelled')
   OR (hz_fop_collected_orders.display->'exception'->>'type'='dispatch_exception' AND hz_fop_collected_orders.display->'exception'->>'reason' IN ('Shopify跟踪号同步失败，请重新同步；成功回写后进入已履约清单。','已取号订单缺少物流跟踪号','已履约订单缺少物流跟踪号'))
   OR (hz_fop_collected_orders.display->'exception'->>'type'='outbound_exception' AND hz_fop_collected_orders.display->'exception'->>'reason'='部分出库无法核实')
   OR (hz_fop_collected_orders.display->'exception'->>'type'='allocation_exception' AND hz_fop_collected_orders.display->'exception'->>'reason'='配货单报错')
   THEN NULL ELSE NULLIF(hz_fop_collected_orders.display->'exception'->>'type','') END), CASE WHEN (hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown') THEN 'outbound_exception' WHEN EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id AND a.display->>'rawAllocationStatus'='error') THEN 'allocation_exception' END) END) AS diagnostic FROM hz_fop_collected_orders
 ) SELECT batch_id,source_id,coalesce(((raw_order_status='6' OR (raw_payment_status='1' AND paid_at IS NULL
 AND display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id) OR ((coalesce(COALESCE((CASE WHEN hz_fop_collected_orders.display->'exception'->>'code' IN ('paid_date_missing','fulfillment_cancelled')
   OR (hz_fop_collected_orders.display->'exception'->>'type'='dispatch_exception' AND hz_fop_collected_orders.display->'exception'->>'reason' IN ('Shopify跟踪号同步失败，请重新同步；成功回写后进入已履约清单。','已取号订单缺少物流跟踪号','已履约订单缺少物流跟踪号'))
   OR (hz_fop_collected_orders.display->'exception'->>'type'='outbound_exception' AND hz_fop_collected_orders.display->'exception'->>'reason'='部分出库无法核实')
   OR (hz_fop_collected_orders.display->'exception'->>'type'='allocation_exception' AND hz_fop_collected_orders.display->'exception'->>'reason'='配货单报错')
   THEN NULL ELSE NULLIF(hz_fop_collected_orders.display->'exception'->>'type','') END), CASE WHEN (hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown') THEN 'outbound_exception' WHEN EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id AND a.display->>'rawAllocationStatus'='error') THEN 'allocation_exception' END),'')<>'' AND (display->'exception'->>'code' IS DISTINCT FROM 'paid_date_missing' OR (raw_payment_status='1' AND paid_at IS NULL
 AND display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id)) AND NOT (display->'exception'->>'type'='dispatch_exception' AND raw_order_status IN ('no','1') AND (CASE WHEN jsonb_exists(raw,'hzkj_fulfillment_status') THEN raw->>'hzkj_fulfillment_status'
  WHEN display->'salesSourceStatus'->>'source'='fulfillment_capture'
   AND display->'salesSourceStatus'->>'sourceId'=source_id
   AND display->'salesSourceStatus'->>'orderStatus'=raw_order_status
  THEN display->'salesSourceStatus'->>'fulfillmentStatus' END) IS DISTINCT FROM 'fulfilled')) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(display->'nativeAssociationIssues','[]'::jsonb)) issue WHERE issue IN ('parent_version_conflict','dispatch_relationship_conflict','allocation_relationship_conflict')) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(display->'nativeProcurementAssociationIssues','[]'::jsonb)) issue WHERE issue IN ('current_purchase_relationship_conflict')) OR (hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown') OR (raw_order_status IN ('2','3') AND display->>'dispatchTaskStatus'='dispatch_synced') OR EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id AND a.display->>'rawAllocationStatus'='error')) OR ((raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified'
 AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus'='SYNC_FAILED')) OR (raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified' AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED'
 AND (d->>'deliveryStatus'='TRACKING_OBTAINED' OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type' IN ('full','first_mile','last_mile') AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type'='full' AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))) OR (raw_bill_status='C' AND raw_order_status IN ('4','5')
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof((CASE WHEN display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END))='array' THEN (CASE WHEN display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END) ELSE '[]'::jsonb END) pkg
 WHERE jsonb_typeof(pkg->'hzkj_tracking_number')='string' AND NULLIF(trim(pkg->>'hzkj_tracking_number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))) OR (raw_order_status IS NULL OR raw_order_status NOT IN ('0','1','2','3','4','5','6','no') OR (raw_order_status IN ('2','3','4','5') AND (raw_payment_status IS NULL OR raw_payment_status NOT IN ('0','1')))))),false),diagnostic,(CASE WHEN raw_order_status='6' THEN '取消履约' WHEN (raw_payment_status='1' AND paid_at IS NULL
 AND display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id) THEN '收款日期为空' WHEN (raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified'
 AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus'='SYNC_FAILED')) THEN 'Shopify跟踪号同步失败，请重新同步；成功回写后进入已履约清单。' WHEN (raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified' AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED'
 AND (d->>'deliveryStatus'='TRACKING_OBTAINED' OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type' IN ('full','first_mile','last_mile') AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type'='full' AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))) THEN '已取号订单缺少物流跟踪号' WHEN (raw_bill_status='C' AND raw_order_status IN ('4','5')
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof((CASE WHEN display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END))='array' THEN (CASE WHEN display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END) ELSE '[]'::jsonb END) pkg
 WHERE jsonb_typeof(pkg->'hzkj_tracking_number')='string' AND NULLIF(trim(pkg->>'hzkj_tracking_number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL)) THEN '已履约订单缺少物流跟踪号' WHEN diagnostic='outbound_exception' AND raw_delivery_status='1' AND display->'businessStatus'->>'outbound'='unknown' THEN '部分出库无法核实' WHEN diagnostic='allocation_exception' AND EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id AND a.display->>'rawAllocationStatus'='error') THEN '配货单报错' WHEN diagnostic IS NOT NULL THEN display->'exception'->>'reason' END),(CASE WHEN raw_order_status='6' THEN 'fulfillment_cancelled' WHEN (raw_payment_status='1' AND paid_at IS NULL
 AND display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id) THEN 'paid_date_missing' WHEN diagnostic=display->'exception'->>'type' THEN display->'exception'->>'code' END),
 md5(jsonb_build_array(raw,display-'timestampProjection',raw_order_status,raw_bill_status,raw_payment_status,raw_delivery_status,paid_at,
  (SELECT jsonb_agg(jsonb_build_array(e.source_id,e.display) ORDER BY e.source_id) FROM hz_fop_collected_entities e WHERE e.batch_id=hz_fop_collected_orders.batch_id AND e.entity_type='allocation' AND e.display->>'sourceOrderId'=hz_fop_collected_orders.source_id))::text),use_dispatch
 FROM state hz_fop_collected_orders) UPDATE hz_fop_collected_orders o SET is_exception=v.flag,exception_type=CASE WHEN v.flag THEN v.category END,exception_reason=CASE WHEN v.flag THEN v.reason END,exception_code=CASE WHEN v.flag THEN v.code END,exception_facts_hash=v.facts_hash,exception_rule_version=1,exception_dispatch_linked=v.dispatch_linked,exception_checked_at=clock_timestamp(),exception_changed_at=CASE WHEN v.flag THEN clock_timestamp() END FROM evaluated v WHERE o.batch_id=v.batch_id AND o.source_id=v.source_id`)
  await q.query("INSERT INTO hz_fop_exception_dirty(batch_id,document_kind,source_id) SELECT batch_id,'stock',source_id FROM hz_fop_collected_entities WHERE entity_type='stock_orders'")
  await q.query('SELECT hz_exception_flush_v1(id),hz_exception_revision_v1(id) FROM hz_fop_collected_batches')
  await q.query('CREATE INDEX ix_collected_exception_state ON hz_fop_collected_orders(batch_id,exception_type,owner_employee_id,paid_at,source_id) WHERE is_exception')
  await q.query("CREATE INDEX ix_collected_stock_exception_state ON hz_fop_collected_entities(batch_id,owner_employee_id,source_id) WHERE is_exception AND entity_type='stock_orders'")
  await q.query('ANALYZE hz_fop_collected_orders(is_exception,exception_type,batch_id,owner_employee_id,paid_at)')
  await q.query('ANALYZE hz_fop_collected_entities(is_exception,entity_type,batch_id,owner_employee_id)')
  await q.query("COMMENT ON COLUMN hz_fop_collected_orders.is_exception IS '本地异常投影，来源事实变更时事务内重算；不改变正常阶段清单资格。规则版本 1。'")
 }
 async down(q:QueryRunner):Promise<void>{
  for(const table of ['hz_fop_collected_orders','hz_fop_collected_entities','hz_fop_collected_analytics_facts']){await q.query(`DROP TRIGGER hz_exception_source_change ON ${table}`);await q.query(`DROP TRIGGER hz_exception_source_create_delete ON ${table}`)}
  await q.query('DROP TRIGGER hz_exception_batch_delete ON hz_fop_collected_batches')
  await q.query('DROP FUNCTION hz_exception_batch_deleted_v1()')
  await q.query('DROP TABLE hz_fop_exception_dirty CASCADE')
  await q.query('DROP TABLE hz_fop_exception_versions')
  for(const fn of ['hz_exception_commit_v1()','hz_exception_flush_v1(uuid)','hz_exception_recheck_v1(uuid,text,text,boolean)','hz_exception_evaluate_order_v1(uuid,text,boolean)','hz_exception_source_changed_v1()','hz_exception_enqueue_v1(uuid,text,text,boolean)','hz_exception_revision_v1(uuid)'])await q.query('DROP FUNCTION '+fn)
  for(const index of ['ix_collected_exception_state','ix_collected_stock_exception_state','ix_exception_allocation_parent','ix_exception_dispatch_parent'])await q.query('DROP INDEX '+index)
  for(const table of ['hz_fop_collected_orders','hz_fop_collected_entities'])for(const column of ['is_exception','exception_type','exception_reason','exception_code','exception_checked_at','exception_changed_at','exception_facts_hash','exception_rule_version','exception_dispatch_linked'])await q.query(`ALTER TABLE ${table} DROP COLUMN ${column}`)
 }
}
