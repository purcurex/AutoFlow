-- Reference only. Initialize using migrate-compiled.mjs run; not this SQL.
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15 (Homebrew)
-- Dumped by pg_dump version 16.15 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: autoflow_crm_activity_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.autoflow_crm_activity_type_enum AS ENUM (
    'note',
    'call',
    'email',
    'whatsapp',
    'status_change',
    'quote',
    'follow_up',
    'handoff'
);


--
-- Name: autoflow_lead_contact_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.autoflow_lead_contact_type_enum AS ENUM (
    'whatsapp',
    'email',
    'instagram',
    'facebook',
    'website',
    'phone',
    'linkedin',
    'other'
);


--
-- Name: autoflow_lead_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.autoflow_lead_status_enum AS ENUM (
    'new',
    'qualified',
    'contacted',
    'replied',
    'opportunity',
    'won',
    'lost',
    'invalid'
);


--
-- Name: autoflow_outreach_channel_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.autoflow_outreach_channel_enum AS ENUM (
    'whatsapp',
    'email',
    'instagram',
    'facebook',
    'other'
);


--
-- Name: autoflow_outreach_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.autoflow_outreach_status_enum AS ENUM (
    'draft',
    'ready',
    'sent',
    'replied',
    'skipped',
    'failed'
);


--
-- Name: autoflow_seed_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.autoflow_seed_type_enum AS ENUM (
    'keyword',
    'image'
);


--
-- Name: autoflow_workflow_job_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.autoflow_workflow_job_status_enum AS ENUM (
    'queued',
    'running',
    'completed',
    'failed'
);


--
-- Name: autoflow_workflow_stage_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.autoflow_workflow_stage_enum AS ENUM (
    'seed',
    'ad_discovery',
    'store_detection',
    'lead_cleaning',
    'lead_scoring',
    'message_generation',
    'outreach',
    'crm'
);


--
-- Name: autoflow_workflow_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.autoflow_workflow_status_enum AS ENUM (
    'draft',
    'running',
    'completed',
    'failed',
    'cancelled'
);


--
-- Name: autoflow_workflow_step_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.autoflow_workflow_step_status_enum AS ENUM (
    'pending',
    'running',
    'completed',
    'failed',
    'skipped'
);


--
-- Name: users_role_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.users_role_enum AS ENUM (
    'admin',
    'user'
);


--
-- Name: autoflow_valid_chart_permissions(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.autoflow_valid_chart_permissions(value jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
        SELECT CASE WHEN jsonb_typeof(value) = 'array' THEN public.autoflow_valid_chart_permissions_v1(
          COALESCE((SELECT jsonb_agg(CASE WHEN jsonb_typeof(item) = 'object' AND item->>'dataScope' = 'none'
            THEN jsonb_set(item, '{dataScope}', '"self"'::jsonb) ELSE item END)
            FROM jsonb_array_elements(value) AS item), '[]'::jsonb)) ELSE false END
      $$;


--
-- Name: autoflow_valid_chart_permissions_v1(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.autoflow_valid_chart_permissions_v1(value jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $$
      DECLARE item jsonb; department jsonb; seen text[] := ARRAY[]::text[]; departments text[]; chart text; mode text;
      BEGIN
        IF jsonb_typeof(value) <> 'array' THEN RETURN false; END IF;
        IF jsonb_array_length(value) > 7 THEN RETURN false; END IF;
        FOR item IN SELECT jsonb_array_elements(value) LOOP
          IF jsonb_typeof(item) <> 'object' THEN RETURN false; END IF;
          IF (SELECT count(*) FROM jsonb_object_keys(item)) <> 7
            OR NOT item ?& ARRAY['chartId','visibility','dataScope','summaryMode','summaryDepartments','details','export'] THEN RETURN false; END IF;
          chart := item->>'chartId'; mode := item->>'summaryMode';
          IF chart IS NULL OR chart NOT IN ('registrations','department_receipts','salesperson_receipts','order_volume','customer_orders','freight','sales_performance')
            OR chart = ANY(seen) THEN RETURN false; END IF;
          seen := array_append(seen, chart);
          IF item->>'visibility' IS NULL OR item->>'visibility' NOT IN ('inherit','allow','deny')
            OR item->>'dataScope' IS NULL OR item->>'dataScope' NOT IN ('inherit','self','department')
            OR item->>'details' IS NULL OR item->>'details' NOT IN ('inherit','allow','deny')
            OR item->>'export' IS NULL OR item->>'export' NOT IN ('inherit','allow','deny')
            OR mode IS NULL OR mode NOT IN ('inherit','none','selected','marketing') THEN RETURN false; END IF;
          IF jsonb_typeof(item->'summaryDepartments') <> 'array' THEN RETURN false; END IF;
          departments := ARRAY[]::text[];
          FOR department IN SELECT jsonb_array_elements(item->'summaryDepartments') LOOP
            IF jsonb_typeof(department) <> 'string' OR department #>> '{}' NOT IN ('sales1','sales2','sales3','sales4')
              OR department #>> '{}' = ANY(departments) THEN RETURN false; END IF;
            departments := array_append(departments, department #>> '{}');
          END LOOP;
          IF mode IN ('selected','marketing') AND chart NOT IN ('registrations','department_receipts','order_volume') THEN RETURN false; END IF;
          IF (mode = 'selected' AND cardinality(departments) = 0)
            OR (mode <> 'selected' AND cardinality(departments) <> 0) THEN RETURN false; END IF;
        END LOOP;
        RETURN true;
      END $$;


--
-- Name: hz_enqueue_relation_root(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_enqueue_relation_root(b uuid, k text, i text, n text) RETURNS void
    LANGUAGE plpgsql
    AS $$ BEGIN
 IF i IS NULL OR n IS NULL OR n='' THEN RETURN; END IF;
 INSERT INTO hz_fop_relation_refresh(batch_id,root_kind,root_id,root_number) VALUES(b,k,i,n)
 ON CONFLICT(batch_id,root_kind,root_id) DO UPDATE SET root_number=excluded.root_number,
 requested_version=hz_fop_relation_refresh.requested_version+1,next_attempt_at=now(),updated_at=now(); END $$;


--
-- Name: hz_exception_batch_deleted_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_batch_deleted_v1() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 DELETE FROM hz_fop_exception_dirty WHERE batch_id=OLD.id;
 DELETE FROM hz_fop_exception_versions WHERE batch_id=OLD.id;
 RETURN OLD;
END $$;


--
-- Name: hz_exception_commit_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_commit_v1() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW.transaction_id=txid_current() AND EXISTS (
  SELECT 1 FROM hz_fop_exception_dirty
  WHERE batch_id=NEW.batch_id AND transaction_id=NEW.transaction_id
    AND document_kind=NEW.document_kind AND source_id=NEW.source_id
 ) THEN
  PERFORM hz_exception_flush_v1(NEW.batch_id);
 END IF;
 RETURN NULL;
END $$;


--
-- Name: hz_exception_downstream_changed_v4(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_downstream_changed_v4() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
   DECLARE prior jsonb; current_row jsonb; source jsonb; parent text;
   BEGIN
    prior=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
    current_row=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
    IF TG_OP='UPDATE' AND (prior->'raw',prior->'display',prior->'batch_id',prior->'entity_type') IS NOT DISTINCT FROM
     (current_row->'raw',current_row->'display',current_row->'batch_id',current_row->'entity_type') THEN RETURN NEW; END IF;
    FOR source IN SELECT v FROM (VALUES(prior),(current_row)) rows(v) WHERE v->>'entity_type' IN ('delivery_notice','outbound') LOOP
     PERFORM hz_exception_enqueue_v1((source->>'batch_id')::uuid,'order',source->'display'->>'sourceOrderId');
     FOR parent IN SELECT source_id FROM hz_fop_collected_orders o WHERE o.batch_id=(source->>'batch_id')::uuid AND
      (o.order_number=source->'raw'->>'hzkj_platform_order_no' OR o.order_number IN
       (SELECT l->>'hzkj_entry_billno' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(source->'raw'->'billentry')='array' THEN source->'raw'->'billentry' ELSE '[]'::jsonb END) l)) LOOP
      PERFORM hz_exception_enqueue_v1((source->>'batch_id')::uuid,'order',parent);
     END LOOP;
    END LOOP;
    RETURN coalesce(NEW,OLD);
   END $$;


--
-- Name: hz_exception_enqueue_v1(uuid, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_enqueue_v1(p_batch uuid, p_kind text, p_id text, p_dispatch boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF p_id IS NULL OR p_id='' OR NOT EXISTS(SELECT 1 FROM hz_fop_collected_batches WHERE id=p_batch) THEN RETURN; END IF;
 INSERT INTO hz_fop_exception_dirty(batch_id,document_kind,source_id,dispatch_changed) VALUES(p_batch,p_kind,p_id,p_dispatch)
 ON CONFLICT(batch_id,transaction_id,document_kind,source_id) DO UPDATE SET dispatch_changed=hz_fop_exception_dirty.dispatch_changed OR excluded.dispatch_changed;
END $$;


--
-- Name: hz_exception_evaluate_order_base_v4(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_evaluate_order_base_v4(p_batch uuid, p_id text, p_dispatch boolean DEFAULT false) RETURNS TABLE(flag boolean, category text, reason text, code text, facts_hash text, dispatch_linked boolean)
    LANGUAGE sql
    AS $$
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
   THEN NULL ELSE NULLIF(hz_fop_collected_orders.display->'exception'->>'type','') END), CASE WHEN ((hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown') AND NOT (
 EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(hz_fop_collected_orders.raw->'hzkj_orders_billentry')='array' THEN hz_fop_collected_orders.raw->'hzkj_orders_billentry' ELSE '[]'::jsonb END) l
  WHERE l->'hzkj_local_sku'->>'number'='HZ000020-001' OR l->'hzkj_local_sku'->'hzkj_good'->>'hzkj_good_carrier'='2')
 AND EXISTS(SELECT 1 FROM hz_fop_collected_entities a
  WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id
   AND a.display->>'rawAllocationStatus' IS DISTINCT FROM 'voided'
  HAVING count(*)=1 AND bool_and(coalesce(a.display->'association'->>'state'='verified'
   AND a.display->>'rawBillStatus' IN ('A','B') AND a.display->>'rawAllocationStatus' IN ('pending','available','completed'),false)))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(hz_fop_collected_orders.display->'businessStatus'->'lines')='array' THEN hz_fop_collected_orders.display->'businessStatus'->'lines' ELSE '[]'::jsonb END) l
  WHERE l->>'excluded'='false' AND l->>'outbound' IN ('partial','completed'))
 AND NOT EXISTS(SELECT 1 FROM hz_fop_collected_entities e
  WHERE e.batch_id=hz_fop_collected_orders.batch_id AND e.entity_type IN ('delivery_notice','outbound')
   AND e.display->>'sourceOrderId'=hz_fop_collected_orders.source_id)
 AND NOT EXISTS(SELECT 1 FROM hz_fop_collected_entities e
  WHERE e.batch_id=hz_fop_collected_orders.batch_id AND e.entity_type='delivery_notice'
   AND e.raw->>'hzkj_platform_order_no'=hz_fop_collected_orders.raw->>'billno')
 AND NOT EXISTS(SELECT 1 FROM hz_fop_collected_entities e
  WHERE e.batch_id=hz_fop_collected_orders.batch_id AND e.entity_type='outbound'
   AND e.raw->'billentry' @> jsonb_build_array(jsonb_build_object('hzkj_entry_billno',hz_fop_collected_orders.raw->>'billno')))
 )) THEN 'outbound_exception' WHEN EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id AND a.display->>'rawAllocationStatus'='error') THEN 'allocation_exception' END) END) AS diagnostic FROM hz_fop_collected_orders
 ) SELECT coalesce(((raw_order_status='6' OR (raw_payment_status='1' AND paid_at IS NULL
 AND display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id) OR ((coalesce(COALESCE((CASE WHEN hz_fop_collected_orders.display->'exception'->>'code' IN ('paid_date_missing','fulfillment_cancelled')
   OR (hz_fop_collected_orders.display->'exception'->>'type'='dispatch_exception' AND hz_fop_collected_orders.display->'exception'->>'reason' IN ('Shopify跟踪号同步失败，请重新同步；成功回写后进入已履约清单。','已取号订单缺少物流跟踪号','已履约订单缺少物流跟踪号'))
   OR (hz_fop_collected_orders.display->'exception'->>'type'='outbound_exception' AND hz_fop_collected_orders.display->'exception'->>'reason'='部分出库无法核实')
   OR (hz_fop_collected_orders.display->'exception'->>'type'='allocation_exception' AND hz_fop_collected_orders.display->'exception'->>'reason'='配货单报错')
   THEN NULL ELSE NULLIF(hz_fop_collected_orders.display->'exception'->>'type','') END), CASE WHEN ((hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown') AND NOT (
 EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(hz_fop_collected_orders.raw->'hzkj_orders_billentry')='array' THEN hz_fop_collected_orders.raw->'hzkj_orders_billentry' ELSE '[]'::jsonb END) l
  WHERE l->'hzkj_local_sku'->>'number'='HZ000020-001' OR l->'hzkj_local_sku'->'hzkj_good'->>'hzkj_good_carrier'='2')
 AND EXISTS(SELECT 1 FROM hz_fop_collected_entities a
  WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id
   AND a.display->>'rawAllocationStatus' IS DISTINCT FROM 'voided'
  HAVING count(*)=1 AND bool_and(coalesce(a.display->'association'->>'state'='verified'
   AND a.display->>'rawBillStatus' IN ('A','B') AND a.display->>'rawAllocationStatus' IN ('pending','available','completed'),false)))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(hz_fop_collected_orders.display->'businessStatus'->'lines')='array' THEN hz_fop_collected_orders.display->'businessStatus'->'lines' ELSE '[]'::jsonb END) l
  WHERE l->>'excluded'='false' AND l->>'outbound' IN ('partial','completed'))
 AND NOT EXISTS(SELECT 1 FROM hz_fop_collected_entities e
  WHERE e.batch_id=hz_fop_collected_orders.batch_id AND e.entity_type IN ('delivery_notice','outbound')
   AND e.display->>'sourceOrderId'=hz_fop_collected_orders.source_id)
 AND NOT EXISTS(SELECT 1 FROM hz_fop_collected_entities e
  WHERE e.batch_id=hz_fop_collected_orders.batch_id AND e.entity_type='delivery_notice'
   AND e.raw->>'hzkj_platform_order_no'=hz_fop_collected_orders.raw->>'billno')
 AND NOT EXISTS(SELECT 1 FROM hz_fop_collected_entities e
  WHERE e.batch_id=hz_fop_collected_orders.batch_id AND e.entity_type='outbound'
   AND e.raw->'billentry' @> jsonb_build_array(jsonb_build_object('hzkj_entry_billno',hz_fop_collected_orders.raw->>'billno')))
 )) THEN 'outbound_exception' WHEN EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id AND a.display->>'rawAllocationStatus'='error') THEN 'allocation_exception' END),'')<>'' AND (display->'exception'->>'code' IS DISTINCT FROM 'paid_date_missing' OR (raw_payment_status='1' AND paid_at IS NULL
 AND display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id)) AND NOT (display->'exception'->>'type'='dispatch_exception' AND raw_order_status IN ('no','1') AND (CASE WHEN jsonb_exists(raw,'hzkj_fulfillment_status') THEN raw->>'hzkj_fulfillment_status'
  WHEN display->'salesSourceStatus'->>'source'='fulfillment_capture'
   AND display->'salesSourceStatus'->>'sourceId'=source_id
   AND display->'salesSourceStatus'->>'orderStatus'=raw_order_status
  THEN display->'salesSourceStatus'->>'fulfillmentStatus' END) IS DISTINCT FROM 'fulfilled')) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(display->'nativeAssociationIssues','[]'::jsonb)) issue WHERE issue IN ('parent_version_conflict','dispatch_relationship_conflict','allocation_relationship_conflict')) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(display->'nativeProcurementAssociationIssues','[]'::jsonb)) issue WHERE issue IN ('current_purchase_relationship_conflict')) OR ((hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown') AND NOT (
 EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(hz_fop_collected_orders.raw->'hzkj_orders_billentry')='array' THEN hz_fop_collected_orders.raw->'hzkj_orders_billentry' ELSE '[]'::jsonb END) l
  WHERE l->'hzkj_local_sku'->>'number'='HZ000020-001' OR l->'hzkj_local_sku'->'hzkj_good'->>'hzkj_good_carrier'='2')
 AND EXISTS(SELECT 1 FROM hz_fop_collected_entities a
  WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id
   AND a.display->>'rawAllocationStatus' IS DISTINCT FROM 'voided'
  HAVING count(*)=1 AND bool_and(coalesce(a.display->'association'->>'state'='verified'
   AND a.display->>'rawBillStatus' IN ('A','B') AND a.display->>'rawAllocationStatus' IN ('pending','available','completed'),false)))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(hz_fop_collected_orders.display->'businessStatus'->'lines')='array' THEN hz_fop_collected_orders.display->'businessStatus'->'lines' ELSE '[]'::jsonb END) l
  WHERE l->>'excluded'='false' AND l->>'outbound' IN ('partial','completed'))
 AND NOT EXISTS(SELECT 1 FROM hz_fop_collected_entities e
  WHERE e.batch_id=hz_fop_collected_orders.batch_id AND e.entity_type IN ('delivery_notice','outbound')
   AND e.display->>'sourceOrderId'=hz_fop_collected_orders.source_id)
 AND NOT EXISTS(SELECT 1 FROM hz_fop_collected_entities e
  WHERE e.batch_id=hz_fop_collected_orders.batch_id AND e.entity_type='delivery_notice'
   AND e.raw->>'hzkj_platform_order_no'=hz_fop_collected_orders.raw->>'billno')
 AND NOT EXISTS(SELECT 1 FROM hz_fop_collected_entities e
  WHERE e.batch_id=hz_fop_collected_orders.batch_id AND e.entity_type='outbound'
   AND e.raw->'billentry' @> jsonb_build_array(jsonb_build_object('hzkj_entry_billno',hz_fop_collected_orders.raw->>'billno')))
 )) OR (raw_order_status IN ('2','3') AND display->>'dispatchTaskStatus'='dispatch_synced') OR EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id AND a.display->>'rawAllocationStatus'='error')) OR ((raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
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


--
-- Name: hz_exception_evaluate_order_base_v5(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_evaluate_order_base_v5(p_batch uuid, p_id text, p_dispatch boolean DEFAULT false) RETURNS TABLE(flag boolean, category text, reason text, code text, facts_hash text, dispatch_linked boolean)
    LANGUAGE sql
    AS $$
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
   THEN NULL ELSE NULLIF(hz_fop_collected_orders.display->'exception'->>'type','') END), CASE WHEN (hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown'
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(hz_fop_collected_orders.raw->'hzkj_orders_billentry')='array' THEN hz_fop_collected_orders.raw->'hzkj_orders_billentry' ELSE '[]'::jsonb END) virtual_entry WHERE ((coalesce(virtual_entry->>'isVirtual','false')='true'
  OR trim(coalesce(virtual_entry->'hzkj_local_sku'->>'number',virtual_entry->'hzkj_material'->>'number',virtual_entry->>'hzkj_local_sku_number',virtual_entry->>'hzkj_local_sku.number',virtual_entry->>'sku',''))='HZ000020-001'
  OR trim(coalesce(virtual_entry->'hzkj_local_sku'->'hzkj_good'->>'hzkj_good_carrier',virtual_entry->'hzkj_material'->'hzkj_good'->>'hzkj_good_carrier',virtual_entry->>'hzkj_local_sku_hzkj_good_hzkj_good_carrier',virtual_entry->>'hzkj_local_sku.hzkj_good.hzkj_good_carrier',''))='2') OR EXISTS(SELECT 1 FROM hz_fop_collected_entities vp WHERE vp.batch_id=hz_fop_collected_orders.batch_id AND vp.entity_type='product'
  AND vp.source_id=coalesce(virtual_entry->'hzkj_local_sku'->>'id',virtual_entry->>'hzkj_local_sku_id')
  AND (coalesce(virtual_entry->'hzkj_local_sku'->>'number',virtual_entry->>'hzkj_local_sku_number') IS NULL OR vp.raw->>'number'=coalesce(virtual_entry->'hzkj_local_sku'->>'number',virtual_entry->>'hzkj_local_sku_number'))
  AND vp.raw->'hzkj_good'->>'hzkj_good_carrier'='2')))) THEN 'outbound_exception' WHEN EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id AND a.display->>'rawAllocationStatus'='error') THEN 'allocation_exception' END) END) AS diagnostic FROM hz_fop_collected_orders
 ) SELECT coalesce(((raw_order_status='6' OR (raw_payment_status='1' AND paid_at IS NULL
 AND display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id) OR ((coalesce(COALESCE((CASE WHEN hz_fop_collected_orders.display->'exception'->>'code' IN ('paid_date_missing','fulfillment_cancelled')
   OR (hz_fop_collected_orders.display->'exception'->>'type'='dispatch_exception' AND hz_fop_collected_orders.display->'exception'->>'reason' IN ('Shopify跟踪号同步失败，请重新同步；成功回写后进入已履约清单。','已取号订单缺少物流跟踪号','已履约订单缺少物流跟踪号'))
   OR (hz_fop_collected_orders.display->'exception'->>'type'='outbound_exception' AND hz_fop_collected_orders.display->'exception'->>'reason'='部分出库无法核实')
   OR (hz_fop_collected_orders.display->'exception'->>'type'='allocation_exception' AND hz_fop_collected_orders.display->'exception'->>'reason'='配货单报错')
   THEN NULL ELSE NULLIF(hz_fop_collected_orders.display->'exception'->>'type','') END), CASE WHEN (hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown'
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(hz_fop_collected_orders.raw->'hzkj_orders_billentry')='array' THEN hz_fop_collected_orders.raw->'hzkj_orders_billentry' ELSE '[]'::jsonb END) virtual_entry WHERE ((coalesce(virtual_entry->>'isVirtual','false')='true'
  OR trim(coalesce(virtual_entry->'hzkj_local_sku'->>'number',virtual_entry->'hzkj_material'->>'number',virtual_entry->>'hzkj_local_sku_number',virtual_entry->>'hzkj_local_sku.number',virtual_entry->>'sku',''))='HZ000020-001'
  OR trim(coalesce(virtual_entry->'hzkj_local_sku'->'hzkj_good'->>'hzkj_good_carrier',virtual_entry->'hzkj_material'->'hzkj_good'->>'hzkj_good_carrier',virtual_entry->>'hzkj_local_sku_hzkj_good_hzkj_good_carrier',virtual_entry->>'hzkj_local_sku.hzkj_good.hzkj_good_carrier',''))='2') OR EXISTS(SELECT 1 FROM hz_fop_collected_entities vp WHERE vp.batch_id=hz_fop_collected_orders.batch_id AND vp.entity_type='product'
  AND vp.source_id=coalesce(virtual_entry->'hzkj_local_sku'->>'id',virtual_entry->>'hzkj_local_sku_id')
  AND (coalesce(virtual_entry->'hzkj_local_sku'->>'number',virtual_entry->>'hzkj_local_sku_number') IS NULL OR vp.raw->>'number'=coalesce(virtual_entry->'hzkj_local_sku'->>'number',virtual_entry->>'hzkj_local_sku_number'))
  AND vp.raw->'hzkj_good'->>'hzkj_good_carrier'='2')))) THEN 'outbound_exception' WHEN EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id AND a.display->>'rawAllocationStatus'='error') THEN 'allocation_exception' END),'')<>'' AND (display->'exception'->>'code' IS DISTINCT FROM 'paid_date_missing' OR (raw_payment_status='1' AND paid_at IS NULL
 AND display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id)) AND NOT (display->'exception'->>'type'='dispatch_exception' AND raw_order_status IN ('no','1') AND (CASE WHEN jsonb_exists(raw,'hzkj_fulfillment_status') THEN raw->>'hzkj_fulfillment_status'
  WHEN display->'salesSourceStatus'->>'source'='fulfillment_capture'
   AND display->'salesSourceStatus'->>'sourceId'=source_id
   AND display->'salesSourceStatus'->>'orderStatus'=raw_order_status
  THEN display->'salesSourceStatus'->>'fulfillmentStatus' END) IS DISTINCT FROM 'fulfilled')) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(display->'nativeAssociationIssues','[]'::jsonb)) issue WHERE issue IN ('parent_version_conflict','dispatch_relationship_conflict','allocation_relationship_conflict')) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(display->'nativeProcurementAssociationIssues','[]'::jsonb)) issue WHERE issue IN ('current_purchase_relationship_conflict')) OR (hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown'
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(hz_fop_collected_orders.raw->'hzkj_orders_billentry')='array' THEN hz_fop_collected_orders.raw->'hzkj_orders_billentry' ELSE '[]'::jsonb END) virtual_entry WHERE ((coalesce(virtual_entry->>'isVirtual','false')='true'
  OR trim(coalesce(virtual_entry->'hzkj_local_sku'->>'number',virtual_entry->'hzkj_material'->>'number',virtual_entry->>'hzkj_local_sku_number',virtual_entry->>'hzkj_local_sku.number',virtual_entry->>'sku',''))='HZ000020-001'
  OR trim(coalesce(virtual_entry->'hzkj_local_sku'->'hzkj_good'->>'hzkj_good_carrier',virtual_entry->'hzkj_material'->'hzkj_good'->>'hzkj_good_carrier',virtual_entry->>'hzkj_local_sku_hzkj_good_hzkj_good_carrier',virtual_entry->>'hzkj_local_sku.hzkj_good.hzkj_good_carrier',''))='2') OR EXISTS(SELECT 1 FROM hz_fop_collected_entities vp WHERE vp.batch_id=hz_fop_collected_orders.batch_id AND vp.entity_type='product'
  AND vp.source_id=coalesce(virtual_entry->'hzkj_local_sku'->>'id',virtual_entry->>'hzkj_local_sku_id')
  AND (coalesce(virtual_entry->'hzkj_local_sku'->>'number',virtual_entry->>'hzkj_local_sku_number') IS NULL OR vp.raw->>'number'=coalesce(virtual_entry->'hzkj_local_sku'->>'number',virtual_entry->>'hzkj_local_sku_number'))
  AND vp.raw->'hzkj_good'->>'hzkj_good_carrier'='2')))) OR (raw_order_status IN ('2','3') AND display->>'dispatchTaskStatus'='dispatch_synced') OR EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id AND a.display->>'rawAllocationStatus'='error')) OR ((raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
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


--
-- Name: hz_exception_evaluate_order_v1(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_evaluate_order_v1(p_batch uuid, p_id text, p_dispatch boolean DEFAULT false) RETURNS TABLE(flag boolean, category text, reason text, code text, facts_hash text, dispatch_linked boolean)
    LANGUAGE sql
    AS $$
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


--
-- Name: hz_exception_evaluate_order_v2(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_evaluate_order_v2(p_batch uuid, p_id text, p_dispatch boolean DEFAULT false) RETURNS TABLE(flag boolean, category text, reason text, code text, facts_hash text, dispatch_linked boolean)
    LANGUAGE sql
    AS $$
 WITH previous AS (SELECT * FROM hz_exception_evaluate_order_v1(p_batch,p_id,p_dispatch)),
 procurement AS (SELECT hz_exception_procurement_reason_number_v3(p_batch,p_id) reason)
 SELECT previous.flag OR procurement.reason IS NOT NULL,
 CASE WHEN procurement.reason IS NOT NULL AND (previous.category IS NULL OR previous.category='procurement_exception') THEN 'procurement_exception' ELSE previous.category END,
 CASE WHEN procurement.reason IS NOT NULL THEN concat_ws('；',nullif(previous.reason,''),procurement.reason) ELSE previous.reason END,
 CASE WHEN procurement.reason IS NOT NULL AND (previous.category IS NULL OR previous.category='procurement_exception') THEN 'procurement_data_incomplete' ELSE previous.code END,
 md5(jsonb_build_array('procurement-payment-v5',previous.facts_hash,procurement.reason)::text),previous.dispatch_linked FROM previous CROSS JOIN procurement;
$$;


--
-- Name: hz_exception_evaluate_order_v4(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_evaluate_order_v4(p_batch uuid, p_id text, p_dispatch boolean DEFAULT false) RETURNS TABLE(flag boolean, category text, reason text, code text, facts_hash text, dispatch_linked boolean)
    LANGUAGE sql
    AS $$
 WITH previous AS (SELECT * FROM hz_exception_evaluate_order_base_v4(p_batch,p_id,p_dispatch)),
 procurement AS (SELECT hz_exception_procurement_reason_number_v3(p_batch,p_id) reason)
 SELECT previous.flag OR procurement.reason IS NOT NULL,
 CASE WHEN procurement.reason IS NOT NULL AND (previous.category IS NULL OR previous.category='procurement_exception') THEN 'procurement_exception' ELSE previous.category END,
 CASE WHEN procurement.reason IS NOT NULL THEN concat_ws('；',nullif(previous.reason,''),procurement.reason) ELSE previous.reason END,
 CASE WHEN procurement.reason IS NOT NULL AND (previous.category IS NULL OR previous.category='procurement_exception') THEN 'procurement_data_incomplete' ELSE previous.code END,
 md5(jsonb_build_array('outbound-gate-v4',previous.facts_hash,procurement.reason,previous.flag,previous.category,previous.reason)::text),previous.dispatch_linked FROM previous CROSS JOIN procurement;
$$;


--
-- Name: hz_exception_evaluate_order_v5(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_evaluate_order_v5(p_batch uuid, p_id text, p_dispatch boolean DEFAULT false) RETURNS TABLE(flag boolean, category text, reason text, code text, facts_hash text, dispatch_linked boolean)
    LANGUAGE sql
    AS $$
 WITH previous AS (SELECT * FROM hz_exception_evaluate_order_base_v5(p_batch,p_id,p_dispatch)),
 procurement AS (SELECT hz_exception_procurement_reason_v5(p_batch,p_id) reason)
 SELECT previous.flag OR procurement.reason IS NOT NULL,
 CASE WHEN procurement.reason IS NOT NULL AND (previous.category IS NULL OR previous.category='procurement_exception') THEN 'procurement_exception' ELSE previous.category END,
 CASE WHEN procurement.reason IS NOT NULL THEN concat_ws('；',nullif(previous.reason,''),procurement.reason) ELSE previous.reason END,
 CASE WHEN procurement.reason IS NOT NULL AND (previous.category IS NULL OR previous.category='procurement_exception') THEN 'procurement_data_incomplete' ELSE previous.code END,
 md5(jsonb_build_array('physical-business-v5',previous.facts_hash,procurement.reason,previous.flag,previous.category,previous.reason)::text),previous.dispatch_linked FROM previous CROSS JOIN procurement;
$$;


--
-- Name: hz_exception_evaluate_order_v6(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_evaluate_order_v6(p_batch uuid, p_id text, p_dispatch boolean DEFAULT false) RETURNS TABLE(flag boolean, category text, reason text, code text, facts_hash text, dispatch_linked boolean)
    LANGUAGE sql
    AS $$
 WITH root AS (
  SELECT o.*, (p_dispatch OR o.exception_dispatch_linked OR b.metadata->'entityCaptures'->'dispatch'->>'coverage' IN ('full_parent_scan','full_company_scan')
   OR EXISTS(SELECT 1 FROM hz_fop_collected_entities e WHERE e.batch_id=p_batch AND e.entity_type='dispatch' AND e.display->>'sourceOrderId'=p_id)) IS TRUE use_dispatch
  FROM hz_fop_collected_orders o JOIN hz_fop_collected_batches b ON b.id=o.batch_id WHERE o.batch_id=p_batch AND o.source_id=p_id
 ), hz_fop_collected_orders AS (
  SELECT r.batch_id,r.source_id,r.raw_order_status,r.raw_bill_status,r.raw_payment_status,r.raw_delivery_status,r.paid_at,r.raw,r.use_dispatch,
   CASE WHEN r.use_dispatch THEN r.display||jsonb_build_object('dispatchDocuments',coalesce((SELECT jsonb_agg(e.display ORDER BY e.source_id)
    FROM hz_fop_collected_entities e WHERE e.batch_id=p_batch AND e.entity_type='dispatch' AND e.display->>'sourceOrderId'=p_id),'[]'::jsonb)) ELSE r.display END display
  FROM root r
 ), facts AS (
  SELECT *,(raw_payment_status='1' AND paid_at IS NULL
 AND raw->>'id'=source_id AND raw->>'hzkj_receipt_status'='1'
 AND jsonb_exists(raw,'hzkj_receipt_date') AND NULLIF(trim(raw->>'hzkj_receipt_date'),'') IS NULL
 AND ((display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id)
 OR (raw->'timestampProjection'->>'entityCode'='hzkj_orders'
 AND raw->'timestampProjection'->>'companyBasis' IN ('verified_timestamp_scope','source_org_id_checked_against_timestamp_scope')
 AND raw->'timestampProjection'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[raw->>'org_id',raw->'org'->>'id',raw->>'organizationId',raw->'hzkj_org'->>'id']) company
 WHERE company IS NOT NULL AND company<>raw->'timestampProjection'->>'companyId')))) payment_missing,(raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified'
 AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus'='SYNC_FAILED')) sync_failure,
   (raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified' AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED'
 AND (d->>'deliveryStatus'='TRACKING_OBTAINED' OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type' IN ('full','first_mile','last_mile') AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type'='full' AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))) obtained_missing,(raw_bill_status='C' AND raw_order_status IN ('4','5')
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof((CASE WHEN NOT jsonb_exists(raw,'hzkj_logistics_info') AND display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END))='array' THEN (CASE WHEN NOT jsonb_exists(raw,'hzkj_logistics_info') AND display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END) ELSE '[]'::jsonb END) pkg
 WHERE jsonb_typeof(pkg->'hzkj_tracking_number')='string' AND NULLIF(trim(pkg->>'hzkj_tracking_number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL)) fulfilled_missing,
   (CASE WHEN NOT jsonb_exists(raw,'hzkj_logistics_info') AND display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END) packages,(hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown'
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(hz_fop_collected_orders.raw->'hzkj_orders_billentry')='array' THEN hz_fop_collected_orders.raw->'hzkj_orders_billentry' ELSE '[]'::jsonb END) virtual_entry WHERE ((coalesce(virtual_entry->>'isVirtual','false')='true'
  OR trim(coalesce(virtual_entry->'hzkj_local_sku'->>'number',virtual_entry->'hzkj_material'->>'number',virtual_entry->>'hzkj_local_sku_number',virtual_entry->>'hzkj_local_sku.number',virtual_entry->>'sku',''))='HZ000020-001'
  OR trim(coalesce(virtual_entry->'hzkj_local_sku'->'hzkj_good'->>'hzkj_good_carrier',virtual_entry->'hzkj_material'->'hzkj_good'->>'hzkj_good_carrier',virtual_entry->>'hzkj_local_sku_hzkj_good_hzkj_good_carrier',virtual_entry->>'hzkj_local_sku.hzkj_good.hzkj_good_carrier',''))='2') OR EXISTS(SELECT 1 FROM hz_fop_collected_entities vp WHERE vp.batch_id=hz_fop_collected_orders.batch_id AND vp.entity_type='product'
  AND vp.source_id=coalesce(virtual_entry->'hzkj_local_sku'->>'id',virtual_entry->>'hzkj_local_sku_id')
  AND (coalesce(virtual_entry->'hzkj_local_sku'->>'number',virtual_entry->>'hzkj_local_sku_number') IS NULL OR vp.raw->>'number'=coalesce(virtual_entry->'hzkj_local_sku'->>'number',virtual_entry->>'hzkj_local_sku_number'))
  AND vp.raw->'hzkj_good'->>'hzkj_good_carrier'='2')))) outbound_unverified,
   hz_exception_procurement_reason_v6(p_batch,p_id) procurement_reason,
   (SELECT string_agg(DISTINCT CASE a.raw->>'hzkj_error_code'
    WHEN 'ALLOC-DATA-001' THEN CASE WHEN strpos(coalesce(a.raw->>'hzkj_error_msg',''),'配货明细缺少有效的来源订单商品行')>0 THEN '配货明细来源商品行关联缺失' ELSE '配货数据校验失败' END
    WHEN 'ALLOC-PURCHASE-TIMEOUT' THEN '采购入库自动配货超时' ELSE '配货单报错' END,'；')
    FROM hz_fop_collected_entities a WHERE a.batch_id=p_batch AND a.entity_type='allocation'
    AND a.display->>'sourceOrderId'=p_id AND coalesce(a.display->'association'->>'state','verified')='verified'
    AND a.display->>'rawAllocationStatus'='error') allocation_reason
  FROM hz_fop_collected_orders
 ), candidates AS (
 SELECT v.* FROM facts CROSS JOIN LATERAL (VALUES
  (10,'logistics_exception',CASE WHEN raw_order_status='6' THEN '取消履约' END,'fulfillment_cancelled'),
  (20,'logistics_exception',CASE WHEN payment_missing THEN '收款日期为空' END,'paid_date_missing'),
  (30,'dispatch_exception',CASE WHEN sync_failure THEN CASE WHEN raw_order_status IN ('4','5') THEN '发运审核同步状态与履约状态不一致' ELSE '发运单审核同步失败' END END,'dispatch_sync_failed'),
  (40,'dispatch_exception',CASE WHEN obtained_missing THEN '已取号订单缺少物流跟踪号' END,'dispatch_tracking_missing'),
  (50,'dispatch_exception',CASE WHEN fulfilled_missing THEN CASE WHEN packages IS NULL THEN '履约订单物流信息待核验' ELSE '履约订单物流跟踪号为空' END END,'fulfillment_tracking_missing'),
  (60,'outbound_exception',CASE WHEN outbound_unverified THEN '部分出库无法核实' END,'outbound_unverified'),
  (70,'allocation_exception',allocation_reason,'allocation_source_error'),
  (80,'procurement_exception',procurement_reason,'procurement_data_missing'),
  (90,'logistics_exception',CASE WHEN raw_bill_status='C' AND raw_order_status IN ('2','3','4','5') AND raw_payment_status='0' THEN '单据审核状态与收款状态不一致' END,'receipt_status_conflict'),
  (100,'logistics_exception',CASE WHEN display->'nativeAssociationIssues' ?| ARRAY['parent_version_conflict','dispatch_relationship_conflict','allocation_relationship_conflict'] THEN '业务单据关联待核验' END,'association_conflict'),
  (110,'logistics_exception',CASE WHEN raw_order_status IS NULL OR raw_order_status NOT IN ('0','1','2','3','4','5','6','no') THEN '履约订单状态待核验'
    WHEN raw_order_status IN ('2','3','4','5') AND (raw_payment_status IS NULL OR raw_payment_status NOT IN ('0','1')) THEN '履约订单收款状态待核验' END,'order_status_unverified'),
  (120,'dispatch_exception',CASE WHEN raw_order_status IN ('2','3') AND display->>'dispatchTaskStatus'='dispatch_synced' THEN '履约状态与发运进度不一致' END,'dispatch_progress_conflict'),
  (130,display->'exception'->>'type',CASE WHEN NULLIF(display->'exception'->>'type','') IS NOT NULL
   AND coalesce(display->'exception'->>'code','') NOT IN ('paid_date_missing','fulfillment_cancelled','dispatch_sync_failed','dispatch_tracking_missing','fulfillment_tracking_missing','outbound_unverified','allocation_source_error','procurement_data_missing','receipt_status_conflict','association_conflict','order_status_unverified','dispatch_progress_conflict')
   AND coalesce(display->'exception'->>'reason','') NOT IN ('Shopify跟踪号同步失败，请重新同步；成功回写后进入已履约清单。','已履约订单缺少物流跟踪号','已取号订单缺少物流跟踪号','部分出库无法核实','配货单报错','发运单审核同步失败','发运审核同步状态与履约状态不一致','履约订单物流跟踪号为空','履约订单物流信息待核验')
   AND NOT(display->'exception'->>'type'='dispatch_exception' AND raw_order_status IN ('no','1') AND coalesce(raw->>'hzkj_fulfillment_status',display->'salesSourceStatus'->>'fulfillmentStatus','')<>'fulfilled')
   THEN coalesce(NULLIF(display->'exception'->>'reason',''),'源单据异常待核验') END,display->'exception'->>'code')
 ) v(priority,category,reason,code) WHERE v.reason IS NOT NULL
 ), reasons AS (SELECT category,reason,code,min(priority) priority FROM candidates GROUP BY category,reason,code)
 SELECT EXISTS(SELECT 1 FROM reasons),(SELECT category FROM reasons ORDER BY priority LIMIT 1),
  (SELECT string_agg(reason,'；' ORDER BY priority,reason) FROM reasons),(SELECT code FROM reasons ORDER BY priority LIMIT 1),
  md5(jsonb_build_array('source-audit-v6',raw,display-'timestampProjection',raw_order_status,raw_bill_status,raw_payment_status,raw_delivery_status,paid_at,
   (SELECT jsonb_agg(jsonb_build_array(e.source_id,e.display,e.raw) ORDER BY e.source_id) FROM hz_fop_collected_entities e
    WHERE e.batch_id=p_batch AND ((e.entity_type='allocation' AND e.display->>'sourceOrderId'=p_id)
    OR(e.entity_type='purchase' AND e.display->'rows' @> jsonb_build_array(jsonb_build_object('orderId',p_id))))))::text),use_dispatch FROM facts;
 $$;


--
-- Name: hz_exception_evaluate_order_v7(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_evaluate_order_v7(p_batch uuid, p_id text, p_dispatch boolean DEFAULT false) RETURNS TABLE(flag boolean, category text, reason text, code text, facts_hash text, dispatch_linked boolean)
    LANGUAGE sql
    AS $$
 WITH root AS (
  SELECT o.*, (p_dispatch OR o.exception_dispatch_linked OR b.metadata->'entityCaptures'->'dispatch'->>'coverage' IN ('full_parent_scan','full_company_scan')
   OR EXISTS(SELECT 1 FROM hz_fop_collected_entities e WHERE e.batch_id=p_batch AND e.entity_type='dispatch' AND e.display->>'sourceOrderId'=p_id)) IS TRUE use_dispatch
  FROM hz_fop_collected_orders o JOIN hz_fop_collected_batches b ON b.id=o.batch_id WHERE o.batch_id=p_batch AND o.source_id=p_id
 ), hz_fop_collected_orders AS (
  SELECT r.batch_id,r.source_id,r.raw_order_status,r.raw_bill_status,r.raw_payment_status,r.raw_delivery_status,r.paid_at,r.raw,r.use_dispatch,
   CASE WHEN r.use_dispatch THEN r.display||jsonb_build_object('dispatchDocuments',coalesce((SELECT jsonb_agg(e.display ORDER BY e.source_id)
    FROM hz_fop_collected_entities e WHERE e.batch_id=p_batch AND e.entity_type='dispatch' AND e.display->>'sourceOrderId'=p_id),'[]'::jsonb)) ELSE r.display END display
  FROM root r
 ), facts AS (
  SELECT *,(raw_payment_status='1' AND paid_at IS NULL
 AND raw->>'id'=source_id AND raw->>'hzkj_receipt_status'='1'
 AND jsonb_exists(raw,'hzkj_receipt_date') AND NULLIF(trim(raw->>'hzkj_receipt_date'),'') IS NULL
 AND ((display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id)
 OR (raw->'timestampProjection'->>'entityCode'='hzkj_orders'
 AND raw->'timestampProjection'->>'companyBasis' IN ('verified_timestamp_scope','source_org_id_checked_against_timestamp_scope')
 AND raw->'timestampProjection'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[raw->>'org_id',raw->'org'->>'id',raw->>'organizationId',raw->'hzkj_org'->>'id']) company
 WHERE company IS NOT NULL AND company<>raw->'timestampProjection'->>'companyId')))) payment_missing,(raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified'
 AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus'='SYNC_FAILED')) sync_failure,
   (raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(display->'dispatchDocuments')='array' THEN display->'dispatchDocuments' ELSE '[]'::jsonb END) d WHERE coalesce(d->'association'->>'state','verified')='verified' AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED'
 AND (d->>'deliveryStatus'='TRACKING_OBTAINED' OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type' IN ('full','first_mile','last_mile') AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d->'trackingNumbers')='array' THEN d->'trackingNumbers' ELSE '[]'::jsonb END) t WHERE t->>'type'='full' AND jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))) obtained_missing,(raw_bill_status='C' AND raw_order_status IN ('4','5')
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof((CASE WHEN NOT jsonb_exists(raw,'hzkj_logistics_info') AND display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END))='array' THEN (CASE WHEN NOT jsonb_exists(raw,'hzkj_logistics_info') AND display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END) ELSE '[]'::jsonb END) pkg
 WHERE jsonb_typeof(pkg->'hzkj_tracking_number')='string' AND NULLIF(trim(pkg->>'hzkj_tracking_number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL)) fulfilled_missing,
   (CASE WHEN NOT jsonb_exists(raw,'hzkj_logistics_info') AND display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END) packages,(hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown'
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(hz_fop_collected_orders.raw->'hzkj_orders_billentry')='array' THEN hz_fop_collected_orders.raw->'hzkj_orders_billentry' ELSE '[]'::jsonb END) virtual_entry WHERE ((coalesce(virtual_entry->>'isVirtual','false')='true'
  OR trim(coalesce(virtual_entry->'hzkj_local_sku'->>'number',virtual_entry->'hzkj_material'->>'number',virtual_entry->>'hzkj_local_sku_number',virtual_entry->>'hzkj_local_sku.number',virtual_entry->>'sku',''))='HZ000020-001'
  OR trim(coalesce(virtual_entry->'hzkj_local_sku'->'hzkj_good'->>'hzkj_good_carrier',virtual_entry->'hzkj_material'->'hzkj_good'->>'hzkj_good_carrier',virtual_entry->>'hzkj_local_sku_hzkj_good_hzkj_good_carrier',virtual_entry->>'hzkj_local_sku.hzkj_good.hzkj_good_carrier',''))='2') OR EXISTS(SELECT 1 FROM hz_fop_collected_entities vp WHERE vp.batch_id=hz_fop_collected_orders.batch_id AND vp.entity_type='product'
  AND vp.source_id=coalesce(virtual_entry->'hzkj_local_sku'->>'id',virtual_entry->>'hzkj_local_sku_id')
  AND (coalesce(virtual_entry->'hzkj_local_sku'->>'number',virtual_entry->>'hzkj_local_sku_number') IS NULL OR vp.raw->>'number'=coalesce(virtual_entry->'hzkj_local_sku'->>'number',virtual_entry->>'hzkj_local_sku_number'))
  AND vp.raw->'hzkj_good'->>'hzkj_good_carrier'='2')))) outbound_unverified,
   hz_exception_procurement_reason_v6(p_batch,p_id) procurement_reason,
   (SELECT string_agg(DISTINCT CASE a.raw->>'hzkj_error_code'
    WHEN 'ALLOC-DATA-001' THEN CASE WHEN strpos(coalesce(a.raw->>'hzkj_error_msg',''),'配货明细缺少有效的来源订单商品行')>0 THEN '配货明细来源商品行关联缺失' ELSE '配货数据校验失败' END
    WHEN 'ALLOC-PURCHASE-TIMEOUT' THEN '采购入库自动配货超时' ELSE '配货单报错' END,'；')
    FROM hz_fop_collected_entities a WHERE a.batch_id=p_batch AND a.entity_type='allocation'
    AND a.display->>'sourceOrderId'=p_id AND coalesce(a.display->'association'->>'state','verified')='verified'
    AND a.display->>'rawAllocationStatus'='error') allocation_reason
  FROM hz_fop_collected_orders
 ), candidates AS (
 SELECT v.* FROM facts CROSS JOIN LATERAL (VALUES
  (10,'logistics_exception',CASE WHEN raw_order_status='6' THEN '取消履约' END,'fulfillment_cancelled'),
  (20,'logistics_exception',CASE WHEN payment_missing THEN CASE WHEN (raw->'timestampProjection'->>'entityCode'='hzkj_orders'
      AND raw->'timestampProjection'->>'companyBasis' IN ('verified_timestamp_scope','source_org_id_checked_against_timestamp_scope')
      AND raw->'timestampProjection'->>'companyId'=(SELECT company_id FROM hz_fop_collected_batches WHERE id=p_batch)
      AND jsonb_typeof(raw->'timestampProjection'->'unknownTimes')='array'
      AND (raw->'timestampProjection'->'unknownTimes') ? 'hzkj_receipt_date') THEN '收款日期格式待核验' ELSE '收款日期为空' END END,CASE WHEN (raw->'timestampProjection'->>'entityCode'='hzkj_orders'
      AND raw->'timestampProjection'->>'companyBasis' IN ('verified_timestamp_scope','source_org_id_checked_against_timestamp_scope')
      AND raw->'timestampProjection'->>'companyId'=(SELECT company_id FROM hz_fop_collected_batches WHERE id=p_batch)
      AND jsonb_typeof(raw->'timestampProjection'->'unknownTimes')='array'
      AND (raw->'timestampProjection'->'unknownTimes') ? 'hzkj_receipt_date') THEN 'paid_date_invalid' ELSE 'paid_date_missing' END),
  (30,'dispatch_exception',CASE WHEN sync_failure THEN CASE WHEN raw_order_status IN ('4','5') THEN '发运审核同步状态与履约状态不一致' ELSE '发运单审核同步失败' END END,'dispatch_sync_failed'),
  (40,'dispatch_exception',CASE WHEN obtained_missing THEN '已取号订单缺少物流跟踪号' END,'dispatch_tracking_missing'),
  (50,'dispatch_exception',CASE WHEN fulfilled_missing THEN CASE WHEN packages IS NULL THEN '履约订单物流信息待核验' ELSE '履约订单物流跟踪号为空' END END,'fulfillment_tracking_missing'),
  (60,'outbound_exception',CASE WHEN outbound_unverified THEN '部分出库无法核实' END,'outbound_unverified'),
  (70,'allocation_exception',allocation_reason,'allocation_source_error'),
  (80,'procurement_exception',procurement_reason,'procurement_data_missing'),
  (90,'logistics_exception',CASE WHEN raw_bill_status='C' AND raw_order_status IN ('2','3','4','5') AND raw_payment_status='0' THEN '单据审核状态与收款状态不一致' END,'receipt_status_conflict'),
  (100,'logistics_exception',CASE WHEN display->'nativeAssociationIssues' ?| ARRAY['parent_version_conflict','dispatch_relationship_conflict','allocation_relationship_conflict'] THEN '业务单据关联待核验' END,'association_conflict'),
  (110,'logistics_exception',CASE WHEN raw_order_status IS NULL OR raw_order_status NOT IN ('0','1','2','3','4','5','6','no') THEN '履约订单状态待核验'
    WHEN raw_order_status IN ('2','3','4','5') AND (raw_payment_status IS NULL OR raw_payment_status NOT IN ('0','1')) THEN '履约订单收款状态待核验' END,'order_status_unverified'),
  (120,'dispatch_exception',CASE WHEN raw_order_status IN ('2','3') AND display->>'dispatchTaskStatus'='dispatch_synced' THEN '履约状态与发运进度不一致' END,'dispatch_progress_conflict'),
  (130,display->'exception'->>'type',CASE WHEN NULLIF(display->'exception'->>'type','') IS NOT NULL
   AND coalesce(display->'exception'->>'code','') NOT IN ('paid_date_missing','paid_date_invalid','fulfillment_cancelled','dispatch_sync_failed','dispatch_tracking_missing','fulfillment_tracking_missing','outbound_unverified','allocation_source_error','procurement_data_missing','receipt_status_conflict','association_conflict','order_status_unverified','dispatch_progress_conflict')
   AND coalesce(display->'exception'->>'reason','') NOT IN ('Shopify跟踪号同步失败，请重新同步；成功回写后进入已履约清单。','已履约订单缺少物流跟踪号','已取号订单缺少物流跟踪号','部分出库无法核实','配货单报错','发运单审核同步失败','发运审核同步状态与履约状态不一致','履约订单物流跟踪号为空','履约订单物流信息待核验')
   AND NOT(display->'exception'->>'type'='dispatch_exception' AND raw_order_status IN ('no','1') AND coalesce(raw->>'hzkj_fulfillment_status',display->'salesSourceStatus'->>'fulfillmentStatus','')<>'fulfilled')
   THEN coalesce(NULLIF(display->'exception'->>'reason',''),'源单据异常待核验') END,display->'exception'->>'code')
 ) v(priority,category,reason,code) WHERE v.reason IS NOT NULL
 ), reasons AS (SELECT category,reason,code,min(priority) priority FROM candidates GROUP BY category,reason,code)
 SELECT EXISTS(SELECT 1 FROM reasons),(SELECT category FROM reasons ORDER BY priority LIMIT 1),
  (SELECT string_agg(reason,'；' ORDER BY priority,reason) FROM reasons),(SELECT code FROM reasons ORDER BY priority LIMIT 1),
  md5(jsonb_build_array('source-audit-v7',raw,display-'timestampProjection',raw_order_status,raw_bill_status,raw_payment_status,raw_delivery_status,paid_at,
   (SELECT jsonb_agg(jsonb_build_array(e.source_id,e.display,e.raw) ORDER BY e.source_id) FROM hz_fop_collected_entities e
    WHERE e.batch_id=p_batch AND ((e.entity_type='allocation' AND e.display->>'sourceOrderId'=p_id)
    OR(e.entity_type='purchase' AND e.display->'rows' @> jsonb_build_array(jsonb_build_object('orderId',p_id))))))::text),use_dispatch FROM facts;
 $$;


--
-- Name: hz_exception_flush_v1(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_flush_v1(p_batch uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE r record; changed boolean=false;
BEGIN
 FOR r IN SELECT * FROM hz_fop_exception_dirty WHERE batch_id=p_batch AND transaction_id=txid_current() ORDER BY document_kind,source_id FOR UPDATE LOOP
  changed=true;
  IF r.document_kind<>'revision' THEN PERFORM hz_exception_recheck_v1(r.batch_id,r.document_kind,r.source_id,r.dispatch_changed); END IF;
  DELETE FROM hz_fop_exception_dirty WHERE batch_id=r.batch_id AND document_kind=r.document_kind AND source_id=r.source_id AND transaction_id=txid_current();
 END LOOP;
 IF changed THEN PERFORM hz_exception_revision_v1(p_batch); END IF;
END $$;


--
-- Name: hz_exception_procurement_reason_number_v3(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_procurement_reason_number_v3(p_batch uuid, p_id text) RETURNS text
    LANGUAGE sql
    AS $$
 WITH root AS (SELECT display,order_number FROM hz_fop_collected_orders WHERE batch_id=p_batch AND source_id=p_id),
 linked AS (
  SELECT e.raw,root.order_number FROM hz_fop_collected_entities e CROSS JOIN root
  WHERE e.batch_id=p_batch AND e.entity_type='purchase'
   AND e.display->'rows' @> jsonb_build_array(jsonb_build_object('orderId',p_id))
   AND e.raw->>'hzkj_cancelstatus' IS DISTINCT FROM 'B'
 ), reasons AS (
 SELECT 1 priority,'采购单状态缺失' reason WHERE EXISTS(SELECT 1 FROM linked WHERE nullif(trim(raw->>'billstatus'),'') IS NULL OR nullif(trim(raw->>'hzkj_cancelstatus'),'') IS NULL)
 UNION ALL SELECT 2,'采购付款信息不完整' WHERE EXISTS(SELECT 1 FROM linked WHERE coalesce(raw->>'hzkj_pay_status','') NOT IN ('0','1','2','3','4'))
 UNION ALL SELECT 3,'采购关联未核实' WHERE EXISTS(SELECT 1 FROM linked WHERE NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw->'hzkj_billentry')='array' THEN raw->'hzkj_billentry' ELSE '[]'::jsonb END) l
  WHERE (trim(l->>'hzkj_srcbillnumber')=order_number OR trim(l->>'hzkj_salbillnumber')=order_number)))
  OR (NOT EXISTS(SELECT 1 FROM linked) AND EXISTS(SELECT 1 FROM root WHERE display->'nativeProcurementAssociationIssues' ?| ARRAY['current_purchase_relationship_conflict','current_purchase_relationship_unresolved']))
 ) SELECT string_agg(reason,'；' ORDER BY priority) FROM reasons;
$$;


--
-- Name: hz_exception_procurement_reason_v2(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_procurement_reason_v2(p_batch uuid, p_id text) RETURNS text
    LANGUAGE sql
    AS $$
 WITH root AS (SELECT display FROM hz_fop_collected_orders WHERE batch_id=p_batch AND source_id=p_id),
 linked AS (
  SELECT e.raw,e.display,r AS row FROM hz_fop_collected_entities e
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.display->'rows')='array' THEN e.display->'rows' ELSE '[]'::jsonb END) r
  WHERE e.batch_id=p_batch AND e.entity_type='purchase'
   AND e.display->'rows' @> jsonb_build_array(jsonb_build_object('orderId',p_id))
   AND r->>'orderId'=p_id AND e.raw->>'hzkj_cancelstatus' IS DISTINCT FROM 'B'
 ), reasons AS (
 SELECT 1 priority,'采购单状态缺失' reason WHERE EXISTS(SELECT 1 FROM linked WHERE nullif(trim(raw->>'billstatus'),'') IS NULL OR nullif(trim(raw->>'hzkj_cancelstatus'),'') IS NULL)
 UNION ALL SELECT 2,'采购付款信息不完整' WHERE EXISTS(SELECT 1 FROM linked WHERE coalesce(raw->>'hzkj_pay_status','') NOT IN ('0','1','3'))
 UNION ALL SELECT 3,'采购关联未核实' WHERE EXISTS(SELECT 1 FROM linked WHERE display->'association'->>'state' IS DISTINCT FROM 'verified' OR row->>'associationState' IS DISTINCT FROM 'verified'
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(row->'lines')='array' THEN row->'lines' ELSE '[]'::jsonb END) l WHERE nullif(trim(l->>'fulfillmentLineId'),'') IS NULL))
  OR EXISTS(SELECT 1 FROM root WHERE display->'nativeProcurementAssociationIssues' ?| ARRAY['current_purchase_relationship_conflict','current_purchase_relationship_unresolved'])
 ) SELECT string_agg(reason,'；' ORDER BY priority) FROM reasons;
$$;


--
-- Name: hz_exception_procurement_reason_v5(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_procurement_reason_v5(p_batch uuid, p_id text) RETURNS text
    LANGUAGE sql
    AS $$
 WITH root AS (SELECT display,order_number FROM hz_fop_collected_orders WHERE batch_id=p_batch AND source_id=p_id),
 linked AS (
  SELECT e.raw,root.order_number FROM hz_fop_collected_entities e CROSS JOIN root
  WHERE e.batch_id=p_batch AND e.entity_type='purchase'
   AND e.display->'rows' @> jsonb_build_array(jsonb_build_object('orderId',p_id))
   AND e.raw->>'hzkj_cancelstatus' IS DISTINCT FROM 'B'
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.display->'rows') r WHERE r->>'orderId'=p_id AND jsonb_array_length(coalesce(r->'lines','[]'::jsonb))>0
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'lines') l WHERE NOT (coalesce(l->>'isVirtual','false')='true'
  OR trim(coalesce(l->'hzkj_local_sku'->>'number',l->'hzkj_material'->>'number',l->>'hzkj_local_sku_number',l->>'hzkj_local_sku.number',l->>'sku',''))='HZ000020-001'
  OR trim(coalesce(l->'hzkj_local_sku'->'hzkj_good'->>'hzkj_good_carrier',l->'hzkj_material'->'hzkj_good'->>'hzkj_good_carrier',l->>'hzkj_local_sku_hzkj_good_hzkj_good_carrier',l->>'hzkj_local_sku.hzkj_good.hzkj_good_carrier',''))='2')
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(root.display->'businessStatus'->'lines','[]'::jsonb)) b WHERE b->>'id'=l->>'fulfillmentLineId' AND b->>'excluded'='true')))
 ), reasons AS (
 SELECT 1 priority,'采购单状态缺失' reason WHERE EXISTS(SELECT 1 FROM linked WHERE nullif(trim(raw->>'billstatus'),'') IS NULL OR nullif(trim(raw->>'hzkj_cancelstatus'),'') IS NULL)
 UNION ALL SELECT 2,'采购付款信息不完整' WHERE EXISTS(SELECT 1 FROM linked WHERE coalesce(raw->>'hzkj_pay_status','') NOT IN ('0','1','2','3','4'))
 UNION ALL SELECT 3,'采购关联未核实' WHERE EXISTS(SELECT 1 FROM linked WHERE NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw->'hzkj_billentry')='array' THEN raw->'hzkj_billentry' ELSE '[]'::jsonb END) l
  WHERE (trim(l->>'hzkj_srcbillnumber')=order_number OR trim(l->>'hzkj_salbillnumber')=order_number)))
  OR (NOT EXISTS(SELECT 1 FROM linked) AND EXISTS(SELECT 1 FROM root WHERE display->'nativeProcurementAssociationIssues' ?| ARRAY['current_purchase_relationship_conflict','current_purchase_relationship_unresolved']))
 ) SELECT string_agg(reason,'；' ORDER BY priority) FROM reasons;
$$;


--
-- Name: hz_exception_procurement_reason_v6(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_procurement_reason_v6(p_batch uuid, p_id text) RETURNS text
    LANGUAGE sql
    AS $$
 WITH root AS (SELECT display,order_number FROM hz_fop_collected_orders WHERE batch_id=p_batch AND source_id=p_id),
 linked AS (
  SELECT e.raw,root.order_number FROM hz_fop_collected_entities e CROSS JOIN root
  WHERE e.batch_id=p_batch AND e.entity_type='purchase'
   AND e.display->'rows' @> jsonb_build_array(jsonb_build_object('orderId',p_id))
   AND e.raw->>'hzkj_cancelstatus' IS DISTINCT FROM 'B'
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.display->'rows') r WHERE r->>'orderId'=p_id AND jsonb_array_length(coalesce(r->'lines','[]'::jsonb))>0
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'lines') l WHERE NOT (coalesce(l->>'isVirtual','false')='true'
  OR trim(coalesce(l->'hzkj_local_sku'->>'number',l->'hzkj_material'->>'number',l->>'hzkj_local_sku_number',l->>'hzkj_local_sku.number',l->>'sku',''))='HZ000020-001'
  OR trim(coalesce(l->'hzkj_local_sku'->'hzkj_good'->>'hzkj_good_carrier',l->'hzkj_material'->'hzkj_good'->>'hzkj_good_carrier',l->>'hzkj_local_sku_hzkj_good_hzkj_good_carrier',l->>'hzkj_local_sku.hzkj_good.hzkj_good_carrier',''))='2')
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(root.display->'businessStatus'->'lines','[]'::jsonb)) b WHERE b->>'id'=l->>'fulfillmentLineId' AND b->>'excluded'='true')))
 ), reasons AS (
 SELECT 1 priority,'采购单状态缺失' reason WHERE EXISTS(SELECT 1 FROM linked WHERE nullif(trim(raw->>'billstatus'),'') IS NULL OR nullif(trim(raw->>'hzkj_cancelstatus'),'') IS NULL)
 UNION ALL SELECT 2,'采购付款状态待核验' WHERE EXISTS(SELECT 1 FROM linked WHERE (NULLIF(trim(raw->>'hzkj_pay_status'),'') IS NOT NULL AND raw->>'hzkj_pay_status' NOT IN ('0','1','2','3','4')
    OR NULLIF(trim(raw->>'hzkj_pay_status'),'') IS NULL AND NULLIF(trim(raw->>'hzkj_1688_order_n'),'') IS NOT NULL))
 UNION ALL SELECT 3,'采购关联未核实' WHERE EXISTS(SELECT 1 FROM linked WHERE NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw->'hzkj_billentry')='array' THEN raw->'hzkj_billentry' ELSE '[]'::jsonb END) l
  WHERE (trim(l->>'hzkj_srcbillnumber')=order_number OR trim(l->>'hzkj_salbillnumber')=order_number)))
  OR (NOT EXISTS(SELECT 1 FROM linked) AND EXISTS(SELECT 1 FROM root WHERE display->'nativeProcurementAssociationIssues' ?| ARRAY['current_purchase_relationship_conflict','current_purchase_relationship_unresolved']))
 ) SELECT string_agg(reason,'；' ORDER BY priority) FROM reasons;
$$;


--
-- Name: hz_exception_purchase_changed_v2(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_purchase_changed_v2() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE before_row jsonb; after_row jsonb; source jsonb; parent text;
BEGIN
 before_row=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 after_row=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 IF TG_OP='UPDATE' AND (before_row->'display',before_row->'raw',before_row->'batch_id',before_row->'entity_type') IS NOT DISTINCT FROM (after_row->'display',after_row->'raw',after_row->'batch_id',after_row->'entity_type') THEN RETURN NEW; END IF;
 FOR source IN SELECT v FROM (VALUES(before_row),(after_row)) rows(v) WHERE v->>'entity_type'='purchase' LOOP
  FOR parent IN SELECT DISTINCT r->>'orderId' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(source->'display'->'rows')='array' THEN source->'display'->'rows' ELSE '[]'::jsonb END) r LOOP
   PERFORM hz_exception_enqueue_v1((source->>'batch_id')::uuid,'order',parent);
  END LOOP;
 END LOOP;
 RETURN coalesce(NEW,OLD);
END $$;


--
-- Name: hz_exception_recheck_v1(uuid, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_recheck_v1(p_batch uuid, p_kind text, p_id text, p_dispatch boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE v record; prior record; source record; reasons text[]; hash text;
BEGIN
 IF p_kind='order' THEN
  SELECT * INTO prior FROM hz_fop_collected_orders WHERE batch_id=p_batch AND source_id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v FROM hz_exception_evaluate_order_v7(p_batch,p_id,p_dispatch);
  IF prior.exception_facts_hash=v.facts_hash AND prior.exception_rule_version=7 THEN RETURN; END IF;
  UPDATE hz_fop_collected_orders SET is_exception=v.flag,exception_type=CASE WHEN v.flag THEN v.category END,
   exception_reason=CASE WHEN v.flag THEN v.reason END,exception_code=CASE WHEN v.flag THEN v.code END,
   exception_facts_hash=v.facts_hash,exception_rule_version=7,exception_dispatch_linked=v.dispatch_linked,
   exception_checked_at=clock_timestamp(),exception_changed_at=CASE WHEN (prior.is_exception,prior.exception_type,prior.exception_reason,prior.exception_code) IS DISTINCT FROM (v.flag,CASE WHEN v.flag THEN v.category END,CASE WHEN v.flag THEN v.reason END,CASE WHEN v.flag THEN v.code END) THEN clock_timestamp() ELSE prior.exception_changed_at END
  WHERE batch_id=p_batch AND source_id=p_id;
 ELSE
  SELECT * INTO prior FROM hz_fop_collected_entities WHERE batch_id=p_batch AND entity_type='stock_orders' AND source_id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT f.raw INTO source FROM hz_fop_collected_analytics_facts f JOIN hz_fop_collected_batches b ON b.id=f.batch_id
   WHERE f.batch_id=p_batch AND f.entity_type='stock' AND f.source_id=p_id AND f.company_id=b.company_id AND f.raw->>'org_id'=b.company_id AND f.raw->>'id'=p_id AND f.raw->>'billno'=prior.display->>'stockNumber';
  hash=md5(jsonb_build_array(prior.display-'timestampProjection',prior.owner_employee_id,source.raw)::text);
  IF prior.exception_facts_hash=hash AND prior.exception_rule_version=7 THEN RETURN; END IF;
  reasons=ARRAY[]::text[];
  IF prior.owner_employee_id IS NULL AND source.raw ? 'hzkj_operator_id' AND coalesce(trim(source.raw->>'hzkj_operator_id'),'') IN ('','0') THEN reasons=array_append(reasons,'业务员为空'); END IF;
  IF source.raw->>'hzkj_orderstatus'='2' AND source.raw ? 'hzkj_receipt_date' AND coalesce(trim(source.raw->>'hzkj_receipt_date'),'')='' THEN reasons=array_append(reasons,'备货收款日期待补齐'); END IF;
  UPDATE hz_fop_collected_entities SET is_exception=cardinality(reasons)>0,exception_type=CASE WHEN cardinality(reasons)>0 THEN 'logistics_exception' END,
   exception_reason=nullif(array_to_string(reasons,'；'),''),exception_code=CASE WHEN cardinality(reasons)>0 THEN 'stock_data_missing' END,
   exception_facts_hash=hash,exception_rule_version=7,exception_checked_at=clock_timestamp(),
   exception_changed_at=CASE WHEN prior.exception_reason IS DISTINCT FROM nullif(array_to_string(reasons,'；'),'') THEN clock_timestamp() ELSE prior.exception_changed_at END
  WHERE batch_id=p_batch AND entity_type='stock_orders' AND source_id=p_id;
 END IF;
END $$;


--
-- Name: hz_exception_revision_v1(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_revision_v1(p_batch uuid) RETURNS void
    LANGUAGE sql
    AS $$
 INSERT INTO hz_fop_exception_versions(batch_id,revision,transaction_id) VALUES(p_batch,1,txid_current())
 ON CONFLICT(batch_id) DO UPDATE SET revision=hz_fop_exception_versions.revision+1,transaction_id=txid_current()
 WHERE hz_fop_exception_versions.transaction_id IS DISTINCT FROM txid_current();
$$;


--
-- Name: hz_exception_source_changed_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_exception_source_changed_v1() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: hz_lead_origin_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_lead_origin_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN IF NEW.lead_type IS DISTINCT FROM OLD.lead_type OR NEW.registrar_user_id IS DISTINCT FROM OLD.registrar_user_id THEN RAISE EXCEPTION 'Lead origin is immutable'; END IF; RETURN NEW; END $$;


--
-- Name: hz_mark_relation_source(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hz_mark_relation_source() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
 DECLARE b uuid; r jsonb; d jsonb; code text; sid text; k text; x record;
 BEGIN
 IF TG_OP='UPDATE' AND (NEW.raw-'timestampProjection') IS NOT DISTINCT FROM (OLD.raw-'timestampProjection') THEN RETURN NEW; END IF;
 b:=CASE WHEN TG_OP='DELETE' THEN OLD.batch_id ELSE NEW.batch_id END;
 sid:=CASE WHEN TG_OP='DELETE' THEN OLD.source_id ELSE NEW.source_id END;
 IF TG_TABLE_NAME='hz_fop_collected_orders' THEN code:='hzkj_orders';k:='fulfillment';
 ELSE
 code:=CASE COALESCE(CASE WHEN TG_OP='DELETE' THEN OLD.entity_type ELSE NEW.entity_type END,'')
 WHEN 'stock_orders' THEN 'hzkj_stock_order_new' WHEN 'purchase' THEN 'hzkj_purorderbill'
 WHEN 'purchase_application' THEN 'hzkj_purapplybill' WHEN 'receipt_notice' THEN 'hzkj_receiptnotice'
 WHEN 'inbound' THEN 'im_purinbill' WHEN 'outbound' THEN 'im_saloutbill'
 WHEN 'dispatch' THEN 'hzkj_deliver_bill' WHEN 'delivery_notice' THEN 'hzkj_deliver_order'
 WHEN 'allocation' THEN 'hzkj_alloc_bill' WHEN 'receipt' THEN 'hzkj_receive_bill'
 WHEN 'rma' THEN 'hzkj_after_sale_orders' WHEN 'payment' THEN 'hzkj_paymentbill' END;
 IF code='hzkj_stock_order_new' THEN k:='stock'; END IF;
 END IF;
 IF code IS NULL THEN RETURN NULL; END IF;
 INSERT INTO hz_fop_relation_dirty_sources VALUES(b,code,sid) ON CONFLICT DO NOTHING;
 -- Existing paths capture OLD roots before a source is reassigned or removed.
 FOR x IN SELECT DISTINCT root.source_id,root.document_number,root.entity_code FROM hz_fop_source_documents doc
 JOIN hz_fop_document_relations rel ON rel.dataset_id=doc.dataset_id AND (rel.from_document_id=doc.id OR rel.to_document_id=doc.id)
 JOIN hz_fop_order_relation_paths p ON p.relation_id=rel.id AND p.dataset_id=doc.dataset_id
 JOIN hz_fop_source_documents root ON root.id=p.order_document_id
 JOIN hz_fop_collected_chains chain ON chain.dataset_id=doc.dataset_id AND chain.batch_id=b
 WHERE doc.entity_code=code AND doc.source_id=sid LOOP
 PERFORM hz_enqueue_relation_root(b,CASE WHEN x.entity_code='hzkj_stock_order_new' THEN 'stock' ELSE 'fulfillment' END,x.source_id,x.document_number); END LOOP;
 FOR x IN SELECT split_part(e.source_id,':',1) kind,split_part(e.source_id,':',2) id,e.raw->>'orderNo' number
 FROM hz_fop_collected_entities e WHERE e.batch_id=b AND e.entity_type='api_bill_relations'
 AND (e.raw->'bills') @> jsonb_build_array(jsonb_build_object('entity',code,'billId',sid)) LOOP
 PERFORM hz_enqueue_relation_root(b,x.kind,x.id,x.number); END LOOP;
 FOR r,d IN SELECT v.r,v.d FROM (VALUES
 (CASE WHEN TG_OP<>'INSERT' THEN OLD.raw END,CASE WHEN TG_OP<>'INSERT' THEN OLD.display END),
 (CASE WHEN TG_OP<>'DELETE' THEN NEW.raw END,CASE WHEN TG_OP<>'DELETE' THEN NEW.display END)) v(r,d) WHERE v.r IS NOT NULL LOOP
 IF k IS NOT NULL THEN PERFORM hz_enqueue_relation_root(b,k,sid,coalesce(r->>'billno',d->>'stockNumber',d->>'orderNumber')); END IF;
 FOR x IN SELECT source_id,order_number FROM hz_fop_collected_orders WHERE batch_id=b AND source_id=d->>'sourceOrderId' LOOP
 PERFORM hz_enqueue_relation_root(b,'fulfillment',x.source_id,x.order_number); END LOOP;
 END LOOP;
 RETURN NULL; END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ad_creatives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_creatives (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    workflow_run_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    team_id uuid,
    provider character varying(40) NOT NULL,
    deduplication_key character varying(64) NOT NULL,
    advertiser_name character varying(160) NOT NULL,
    source_url character varying(1000) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    image_url character varying(1000),
    confidence double precision DEFAULT 0 NOT NULL,
    raw_payload jsonb,
    discovered_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ad_creatives_confidence CHECK (((confidence >= (0)::double precision) AND (confidence <= (100)::double precision)))
);


--
-- Name: ai_outreach_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_outreach_conversations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    owner_user_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    title character varying(160) NOT NULL,
    status character varying(24) DEFAULT 'active'::character varying NOT NULL,
    options jsonb NOT NULL,
    context_snapshot jsonb NOT NULL,
    summary text,
    last_draft_version integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ai_outreach_conversations_status CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'drafted'::character varying, 'accepted'::character varying, 'archived'::character varying])::text[]))),
    CONSTRAINT chk_ai_outreach_conversations_version CHECK ((last_draft_version >= 0))
);


--
-- Name: ai_outreach_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_outreach_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    conversation_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    role character varying(16) NOT NULL,
    sequence integer NOT NULL,
    content text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ai_outreach_messages_role CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'assistant'::character varying])::text[]))),
    CONSTRAINT chk_ai_outreach_messages_sequence CHECK ((sequence >= 1))
);


--
-- Name: ai_prompt_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_prompt_bindings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    owner_user_id uuid NOT NULL,
    module_key character varying(40) NOT NULL,
    template_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ai_prompt_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_prompt_templates (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    owner_user_id uuid,
    module_key character varying(40) NOT NULL,
    name character varying(80) NOT NULL,
    content text NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    actor_user_id uuid,
    action character varying(120) NOT NULL,
    target_type character varying(120) NOT NULL,
    target_id character varying(200),
    outcome character varying(24) NOT NULL,
    correlation_id character varying(80) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_audit_events_outcome CHECK (((outcome)::text = ANY ((ARRAY['succeeded'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: crm_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_activities (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    lead_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    team_id uuid,
    type public.autoflow_crm_activity_type_enum NOT NULL,
    subject character varying(160),
    content text DEFAULT ''::text NOT NULL,
    from_status public.autoflow_lead_status_enum,
    to_status public.autoflow_lead_status_enum,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    next_follow_up_at timestamp with time zone,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fop_handoffs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fop_handoffs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    lead_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    status character varying(24) DEFAULT 'pending'::character varying NOT NULL,
    fop_lead_id character varying(160),
    fop_opportunity_id character varying(160),
    conflicts jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_error text,
    attempts integer DEFAULT 0 NOT NULL,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_fop_handoffs_attempts CHECK ((attempts >= 0)),
    CONSTRAINT chk_fop_handoffs_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'succeeded'::character varying, 'requires_review'::character varying, 'failed'::character varying, 'unavailable'::character varying])::text[])))
);


--
-- Name: hz_fop_action_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_action_requests (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    actor_account_id uuid NOT NULL,
    operation character varying(40) NOT NULL,
    client_request_key character varying(160) NOT NULL,
    actor_binding_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_version character varying(160) NOT NULL,
    parameters_hash character varying(64) NOT NULL,
    state character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hz_fop_action_requests_actor_binding_snapshot_shape CHECK ((jsonb_typeof(actor_binding_snapshot) = 'object'::text)),
    CONSTRAINT ck_hz_fop_action_requests_operation CHECK (((operation)::text = ANY ((ARRAY['audit_fulfillment'::character varying, 'audit_allocation'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_action_requests_state CHECK (((state)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'succeeded'::character varying, 'partial'::character varying, 'blocked'::character varying, 'failed'::character varying, 'unknown'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_action_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_action_requests IS '实时审核批次与请求；执行读取副本之外的实时审核协调；保留真实人员与技术调用身份。；无 FOP 条件审核、真实授权及幂等保障前，不开放真实写操作。';


--
-- Name: COLUMN hz_fop_action_requests.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_requests.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_requests.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_requests.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_requests.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_requests.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_requests.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_requests.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_requests.actor_account_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_requests.actor_account_id IS '真实本地操作人；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_requests.operation; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_requests.operation IS '操作；来源：本地设计；audit_fulfillment,audit_allocation；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_requests.client_request_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_requests.client_request_key IS '客户端请求号；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_requests.actor_binding_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_requests.actor_binding_snapshot IS '受信任映射及委托证据；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_requests.authorization_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_requests.authorization_version IS '提交时权限版本；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_requests.parameters_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_requests.parameters_hash IS '不可变请求参数摘要；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_requests.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_requests.state IS '批次结果；来源：本地设计；选项：pending, running, succeeded, partial, blocked, failed, unknown；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_requests.started_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_requests.started_at IS '开始；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_requests.finished_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_requests.finished_at IS '结束；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_requests.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_requests.created_at IS '本地首次登记；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_requests.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_requests.updated_at IS '本地最近更新；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: hz_fop_action_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_action_targets (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    request_id uuid NOT NULL,
    document_id uuid NOT NULL,
    operation character varying(40) NOT NULL,
    idempotency_key character varying(200) NOT NULL,
    expected_source_version character varying(240) NOT NULL,
    parameters_hash character varying(64) NOT NULL,
    state character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    outcome_code character varying(100),
    outcome_message text,
    fop_receipt jsonb,
    submitted_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    CONSTRAINT ck_hz_fop_action_targets_state CHECK (((state)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'approved'::character varying, 'already_approved'::character varying, 'blocked'::character varying, 'failed'::character varying, 'unknown'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_action_targets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_action_targets IS '审核逐单版本与回执；超时结果未知时按原请求号查结果，不生成新键重试审核。；本地唯一约束不能代替 FOP 原子幂等；FOP 业务提交与结果回执需可恢复地关联。；任一 unknown 暂停未提交目标；其余目标重新预检与权限复验后才可继续。';


--
-- Name: COLUMN hz_fop_action_targets.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_targets.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_targets.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_targets.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_targets.request_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.request_id IS '审核批次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_targets.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.document_id IS '实际审核目标；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_targets.operation; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.operation IS '具体操作；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_targets.idempotency_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.idempotency_key IS '提交给 FOP 的唯一键；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_targets.expected_source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.expected_source_version IS 'FOP 预检版本／签名凭据；来源：实时审核契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_action_targets.parameters_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.parameters_hash IS '目标参数摘要；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_targets.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.state IS '逐单结果；来源：本地设计；选项：pending, running, approved, already_approved, blocked, failed, unknown；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_targets.outcome_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.outcome_code IS 'FOP 结果码；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_targets.outcome_message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.outcome_message IS '简明回执；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_targets.fop_receipt; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.fop_receipt IS '非敏感真实执行回执；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_targets.submitted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.submitted_at IS '提交；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_targets.confirmed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.confirmed_at IS '结果确认；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_action_targets.attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_action_targets.attempts IS '查询／恢复次数；来源：本地设计；证据：本地设计';


--
-- Name: hz_fop_allocation_line_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_allocation_line_details (
    line_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    source_order_entry_id character varying(128),
    required_quantity numeric(24,8),
    newly_reserved_quantity numeric(24,8),
    allocated_quantity numeric(24,8),
    short_quantity numeric(24,8),
    customer_reserved_quantity numeric(24,8),
    common_reserved_quantity numeric(24,8),
    protected_quantity numeric(24,8)
);


--
-- Name: TABLE hz_fop_allocation_line_details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_allocation_line_details IS '配货需求／占用扩展；来源分录的领域字段扩展；适用 hzkj_alloc_bill；通过 source_lines.document_id 追溯类型头表；公司和实体类型必须匹配。；本项目只同步占用结果，不在副本中执行锁库或释放库存。';


--
-- Name: COLUMN hz_fop_allocation_line_details.line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocation_line_details.line_id IS '分录登记主键；来源：本地设计；PK／FK→source_lines.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_allocation_line_details.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocation_line_details.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_allocation_line_details.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocation_line_details.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_allocation_line_details.source_order_entry_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocation_line_details.source_order_entry_id IS '来源履约商品行；来源：hzkj_src_entry_number；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_allocation_line_details.required_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocation_line_details.required_quantity IS '配货需求数量；来源：hzkj_req_qty；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_allocation_line_details.newly_reserved_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocation_line_details.newly_reserved_quantity IS '本次新增占用；来源：hzkj_line_ready_qty；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_allocation_line_details.allocated_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocation_line_details.allocated_quantity IS '已配货数量；来源：hzkj_line_alloc_qty；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_allocation_line_details.short_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocation_line_details.short_quantity IS '待配货数量；来源：hzkj_line_short_qty；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_allocation_line_details.customer_reserved_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocation_line_details.customer_reserved_quantity IS '客户库存占用；来源：hzkj_cust_occ_qty；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_allocation_line_details.common_reserved_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocation_line_details.common_reserved_quantity IS '公共库存占用；来源：hzkj_common_occ_qty；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_allocation_line_details.protected_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocation_line_details.protected_quantity IS '防饥饿保护量；来源：hzkj_protect_qty；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: hz_fop_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_allocations (
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) DEFAULT 'hzkj_alloc_bill'::character varying NOT NULL,
    source_order_id character varying(128),
    source_order_number character varying(160),
    package_number character varying(128),
    warehouse_id character varying(128),
    customer_id character varying(128),
    owner_employee_id character varying(128),
    raw_allocation_status character varying(64),
    raw_operation_status character varying(64),
    ready_at timestamp with time zone,
    idempotency_key character varying(200),
    CONSTRAINT ck_hz_fop_allocations_entity_code CHECK (((entity_code)::text = 'hzkj_alloc_bill'::text))
);


--
-- Name: TABLE hz_fop_allocations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_allocations IS '配货单；保存 配货单 的必要真实业务事实。；仅接收 entity_code=hzkj_alloc_bill 的来源登记；同一源单快照、分录及关系在同一事务应用。；当前 FOP 按订单包裹可产生多张配货单；不能对 source_order_id 建唯一约束。；前端旧单一 allocationDocument 字段在接入时改为集合或受控汇总；缺包裹不推定整单完成。';


--
-- Name: COLUMN hz_fop_allocations.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocations.document_id IS '来源登记主键；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_allocations.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocations.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_allocations.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocations.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_allocations.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocations.entity_code IS '固定来源实体；来源：本地设计；CHECK entity_code = hzkj_alloc_bill；证据：本地设计';


--
-- Name: COLUMN hz_fop_allocations.source_order_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocations.source_order_id IS '履约订单 ID；来源：hzkj_order_id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_allocations.source_order_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocations.source_order_number IS '来源履约单号；来源：hzkj_order_no；证据：接口文档';


--
-- Name: COLUMN hz_fop_allocations.package_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocations.package_number IS '包裹号；来源：hzkj_pkg_no；证据：接口文档';


--
-- Name: COLUMN hz_fop_allocations.warehouse_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocations.warehouse_id IS '配货仓库；来源：hzkj_warehouse.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_allocations.customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocations.customer_id IS '客户；来源：hzkj_customer.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_allocations.owner_employee_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocations.owner_employee_id IS '业务员；来源：hzkj_operator.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_allocations.raw_allocation_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocations.raw_allocation_status IS '原生配货状态；来源：hzkj_alloc_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_allocations.raw_operation_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocations.raw_operation_status IS '操作状态；来源：hzkj_op_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_allocations.ready_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocations.ready_at IS '齐套时间；来源：hzkj_complete_time；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_allocations.idempotency_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_allocations.idempotency_key IS 'FOP 幂等键；来源：hzkj_idem_key；证据：接口文档';


--
-- Name: hz_fop_bootstrap_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_bootstrap_batches (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    sync_run_id uuid NOT NULL,
    snapshot_id character varying(200),
    start_watermarks jsonb DEFAULT '{}'::jsonb NOT NULL,
    entity_scope jsonb DEFAULT '[]'::jsonb NOT NULL,
    page_progress jsonb DEFAULT '{}'::jsonb NOT NULL,
    state character varying(40) DEFAULT 'preparing'::character varying NOT NULL,
    validation_report jsonb DEFAULT '{}'::jsonb NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    start_barrier_id uuid,
    cutover_barrier_id uuid,
    CONSTRAINT ck_hz_fop_bootstrap_batches_entity_scope_shape CHECK ((jsonb_typeof(entity_scope) = 'array'::text)),
    CONSTRAINT ck_hz_fop_bootstrap_batches_page_progress_shape CHECK ((jsonb_typeof(page_progress) = 'object'::text)),
    CONSTRAINT ck_hz_fop_bootstrap_batches_start_watermarks_shape CHECK ((jsonb_typeof(start_watermarks) = 'object'::text)),
    CONSTRAINT ck_hz_fop_bootstrap_batches_state CHECK (((state)::text = ANY ((ARRAY['preparing'::character varying, 'importing'::character varying, 'replaying'::character varying, 'validating'::character varying, 'published'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_bootstrap_batches_validation_report_shape CHECK ((jsonb_typeof(validation_report) = 'object'::text))
);


--
-- Name: TABLE hz_fop_bootstrap_batches; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_bootstrap_batches IS '初始化快照批次；初始化暂存代次，校验追平后统一发布；不直接向在线查询暴露半套全量。；数据写入本批 dataset_id；核对完成后事务切换 companies.active_dataset_id，暂存代次不参与在线查询。；备份没有匹配水位与后续日志时重建快照。';


--
-- Name: COLUMN hz_fop_bootstrap_batches.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_bootstrap_batches.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_bootstrap_batches.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_bootstrap_batches.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_bootstrap_batches.sync_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.sync_run_id IS '执行批次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_bootstrap_batches.snapshot_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.snapshot_id IS '源快照标识；来源：初始化契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_bootstrap_batches.start_watermarks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.start_watermarks IS '全量前可靠起点 C0；来源：初始化契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_bootstrap_batches.entity_scope; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.entity_scope IS '实体和字段范围；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_bootstrap_batches.page_progress; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.page_progress IS '各实体稳定分页进度；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_bootstrap_batches.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.state IS '批次状态；来源：本地设计；选项：preparing, importing, replaying, validating, published, failed；证据：本地设计';


--
-- Name: COLUMN hz_fop_bootstrap_batches.validation_report; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.validation_report IS 'ID／版本／金额／关系核对；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_bootstrap_batches.published_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.published_at IS '切换时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_bootstrap_batches.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.created_at IS '本地首次登记；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_bootstrap_batches.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.updated_at IS '本地最近更新；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_bootstrap_batches.start_barrier_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.start_barrier_id IS '全量前C0屏障；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_bootstrap_batches.cutover_barrier_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_bootstrap_batches.cutover_barrier_id IS '切换目标屏障；来源：本地设计；证据：本地设计';


--
-- Name: hz_fop_bootstrap_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_bootstrap_pages (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    stream_id uuid NOT NULL,
    snapshot_id character varying(200) NOT NULL,
    page_index integer NOT NULL,
    after_cursor text,
    end_cursor text,
    complete boolean NOT NULL,
    groups jsonb NOT NULL,
    payload_hash character varying(64) NOT NULL,
    state character varying(40) DEFAULT 'collected'::character varying NOT NULL,
    collected_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_at timestamp with time zone,
    CONSTRAINT hz_fop_bootstrap_pages_groups_check CHECK ((jsonb_typeof(groups) = 'array'::text)),
    CONSTRAINT hz_fop_bootstrap_pages_page_index_check CHECK ((page_index >= 0)),
    CONSTRAINT hz_fop_bootstrap_pages_state_check CHECK (((state)::text = ANY ((ARRAY['collected'::character varying, 'prepared'::character varying, 'applied'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_bootstrap_pages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_bootstrap_pages IS '初始化内部归一化快照持久暂存；采集分页与业务发布游标分离。所有快照页收齐后创建未验证身份骨架，完整发布与校验后才允许数据集激活；不表示真实FOP接口已提供。';


--
-- Name: hz_fop_collected_analytics_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_collected_analytics_facts (
    batch_id uuid NOT NULL,
    entity_type text NOT NULL,
    source_id text NOT NULL,
    company_id text NOT NULL,
    document_number text NOT NULL,
    owner_employee_id text,
    customer_id text,
    department_id text,
    created_at timestamp with time zone,
    paid_at timestamp with time zone,
    source_paid_at timestamp with time zone,
    occurred_at timestamp with time zone,
    amount numeric,
    currency_code text,
    quantity numeric,
    raw_status text,
    facts jsonb NOT NULL,
    raw jsonb NOT NULL,
    captured_at timestamp with time zone NOT NULL,
    CONSTRAINT hz_fop_collected_analytics_facts_check CHECK (((amount IS NULL) OR (currency_code IS NOT NULL))),
    CONSTRAINT hz_fop_collected_analytics_facts_currency_code_check CHECK (((currency_code IS NULL) OR (currency_code ~ '^[A-Z]{3}$'::text))),
    CONSTRAINT hz_fop_collected_analytics_facts_entity_type_check CHECK ((entity_type = ANY (ARRAY['fulfillment'::text, 'stock'::text, 'purchase'::text, 'dispatch'::text, 'receipt'::text])))
);


--
-- Name: TABLE hz_fop_collected_analytics_facts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_collected_analytics_facts IS '现有来源单据的可重建分析投影；不替代主单表，不生成业务状态；金额币种缺失保留空值，分项原生金额保存在facts。';


--
-- Name: hz_fop_collected_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_collected_batches (
    id uuid NOT NULL,
    workspace_owner_id uuid NOT NULL,
    tenant_id text NOT NULL,
    company_id text NOT NULL,
    state text NOT NULL,
    source_as_of timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    row_count integer DEFAULT 0 NOT NULL,
    page_count integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT hz_fop_collected_batches_page_count_check CHECK ((page_count >= 0)),
    CONSTRAINT hz_fop_collected_batches_row_count_check CHECK ((row_count >= 0)),
    CONSTRAINT hz_fop_collected_batches_state_check CHECK ((state = ANY (ARRAY['staging'::text, 'active'::text, 'failed'::text, 'superseded'::text])))
);


--
-- Name: hz_fop_collected_chains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_collected_chains (
    batch_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    source_signature text NOT NULL,
    content_hash text NOT NULL,
    mapping_version integer NOT NULL,
    summary jsonb NOT NULL,
    built_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE hz_fop_collected_chains; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_collected_chains IS '已采集非一致快照的规范关联索引；不得用作正式增量初始化证明';


--
-- Name: hz_fop_collected_customer_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_collected_customer_registrations (
    batch_id uuid NOT NULL,
    source_id text NOT NULL,
    company_id text NOT NULL,
    source_entity text NOT NULL,
    source_owner_user_id text,
    created_at timestamp with time zone,
    raw jsonb NOT NULL,
    captured_at timestamp with time zone NOT NULL,
    CONSTRAINT hz_fop_collected_customer_registrations_source_entity_check CHECK ((source_entity = 'hzkj_member_customer'::text))
);


--
-- Name: hz_fop_collected_entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_collected_entities (
    batch_id uuid NOT NULL,
    entity_type text NOT NULL,
    source_id text NOT NULL,
    owner_employee_id text,
    search_text text NOT NULL,
    display jsonb NOT NULL,
    raw jsonb NOT NULL,
    captured_at timestamp with time zone NOT NULL,
    is_exception boolean DEFAULT false NOT NULL,
    exception_type text,
    exception_reason text,
    exception_code text,
    exception_checked_at timestamp with time zone,
    exception_changed_at timestamp with time zone,
    exception_facts_hash text,
    exception_rule_version integer DEFAULT 0 NOT NULL,
    exception_dispatch_linked boolean DEFAULT false NOT NULL
);


--
-- Name: hz_fop_collected_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_collected_orders (
    batch_id uuid NOT NULL,
    source_id text NOT NULL,
    order_number text NOT NULL,
    owner_employee_id text,
    customer_id text,
    warehouse_code text,
    country_code text,
    bill_type text,
    raw_bill_status text,
    raw_order_status text,
    raw_payment_status text,
    raw_delivery_status text,
    created_at timestamp with time zone,
    paid_at timestamp with time zone,
    consumer_paid_at timestamp with time zone,
    product_amount numeric,
    total_amount numeric,
    currency_code text,
    total_quantity numeric,
    search_text text NOT NULL,
    display jsonb NOT NULL,
    raw jsonb NOT NULL,
    is_exception boolean DEFAULT false NOT NULL,
    exception_type text,
    exception_reason text,
    exception_code text,
    exception_checked_at timestamp with time zone,
    exception_changed_at timestamp with time zone,
    exception_facts_hash text,
    exception_rule_version integer DEFAULT 0 NOT NULL,
    exception_dispatch_linked boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE hz_fop_collected_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_collected_orders IS '旧API单轮采集只读事实；非一致快照、非正式副本、不生成授权租约；未知事实留空。';


--
-- Name: COLUMN hz_fop_collected_orders.is_exception; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_collected_orders.is_exception IS '本地异常投影，来源事实变更时事务内重算；不改变正常阶段清单资格。规则版本 1。';


--
-- Name: hz_fop_collected_stock_consumptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_collected_stock_consumptions (
    batch_id uuid NOT NULL,
    stock_id text NOT NULL,
    record_id text NOT NULL,
    order_number text NOT NULL,
    sku_id text,
    stock_type text,
    use_status text,
    quantity numeric(24,8),
    payload jsonb NOT NULL,
    captured_at timestamp with time zone NOT NULL
);


--
-- Name: TABLE hz_fop_collected_stock_consumptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_collected_stock_consumptions IS '备货单当前耗用记录：0预占，1客户支付确认；按备货单类型和订单SKU拆分，缺SKU保留未知。';


--
-- Name: hz_fop_companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_companies (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    source_company_id character varying(128) NOT NULL,
    company_number character varying(128) NOT NULL,
    name character varying(200),
    enabled boolean DEFAULT false NOT NULL,
    scope_version bigint DEFAULT 1 NOT NULL,
    verified_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    active_dataset_id uuid
);


--
-- Name: TABLE hz_fop_companies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_companies IS 'FOP 公司范围；隔离公司；测试公司内码 100000、编码 hyperzone，仅作为测试配置。；公司权限过期停止访问；不以请求参数伪造业务单据公司。；复合 FK(id,active_dataset_id)→datasets(company_id,id)；NULL 时公司处于未初始化，不返回假空清单。';


--
-- Name: COLUMN hz_fop_companies.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_companies.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_companies.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_companies.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_companies.source_company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_companies.source_company_id IS 'FOP 公司内码；来源：org.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_companies.company_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_companies.company_number IS '公司编码；来源：配置／目录；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_companies.name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_companies.name IS '公司名称；来源：目录；证据：映射待确认';


--
-- Name: COLUMN hz_fop_companies.enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_companies.enabled IS '当前允许同步；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_companies.scope_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_companies.scope_version IS '公司范围版本；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_companies.verified_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_companies.verified_at IS '授权核验时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_companies.expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_companies.expires_at IS '授权有效截止；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_companies.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_companies.created_at IS '本地首次登记；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_companies.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_companies.updated_at IS '本地最近更新；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_companies.active_dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_companies.active_dataset_id IS '当前在线数据集；来源：本地设计；证据：本地设计';


--
-- Name: hz_fop_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_connections (
    id uuid NOT NULL,
    workspace_owner_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    environment character varying(40) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    base_url text NOT NULL,
    credential_ref character varying(160) NOT NULL,
    status character varying(40) DEFAULT 'draft'::character varying NOT NULL,
    capabilities jsonb DEFAULT '{}'::jsonb NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    scope_version bigint DEFAULT 1 NOT NULL,
    source_timezone character varying(64) DEFAULT 'Asia/Shanghai'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sync_schedule jsonb DEFAULT '{"scope": "all_authorized_companies_and_resources_changes", "manual": {"mode": "incremental", "capture_request_barrier": true, "include_membership_removals": true}, "status": "configured_not_enabled", "calendar": "daily", "timezone": "Asia/Shanghai", "off_hours": {"slots": ["20:30", "22:30", "00:30", "02:30", "04:30", "06:30"], "anchor": "18:30", "interval_minutes": 120}, "morning_at": "08:30", "navigation": {"after_local_load": true, "filters_trigger_sync": false, "min_interval_seconds": 60, "coalesce_across_users": true}, "business_window": {"end": "18:30", "start": "09:00", "end_inclusive": true, "interval_minutes": 30}, "sync_on_page_open": true}'::jsonb NOT NULL,
    CONSTRAINT ck_hz_fop_connections_capabilities_shape CHECK ((jsonb_typeof(capabilities) = 'object'::text)),
    CONSTRAINT ck_hz_fop_connections_environment CHECK (((environment)::text = ANY ((ARRAY['test'::character varying, 'production'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_connections_status CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'disabled'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_connections_sync_schedule_shape CHECK ((jsonb_typeof(sync_schedule) = 'object'::text))
);


--
-- Name: TABLE hz_fop_connections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_connections IS 'FOP 集成连接；按工作空间、测试／生产环境隔离同步及授权。；FK workspace_owner_id→users.id，删除 RESTRICT；不按每位业务员建立独立全量副本。';


--
-- Name: COLUMN hz_fop_connections.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_connections.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_connections.workspace_owner_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_connections.workspace_owner_id IS '复用本地组织工作空间；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_connections.name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_connections.name IS '连接名称；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_connections.environment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_connections.environment IS '环境；来源：本地设计；选项：test, production；证据：本地设计';


--
-- Name: COLUMN hz_fop_connections.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_connections.tenant_id IS 'FOP 租户；来源：配置；FOP ID／外部编号按字符串保存，不能转 JS number；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_connections.base_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_connections.base_url IS 'FOP 服务地址；来源：配置；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_connections.credential_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_connections.credential_ref IS '私有凭据引用；来源：配置；只存密钥管理／环境配置标识，不存 Token、AppSecret；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_connections.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_connections.status IS '连接状态；来源：本地设计；选项：draft, active, disabled；证据：本地设计';


--
-- Name: COLUMN hz_fop_connections.capabilities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_connections.capabilities IS '已验证接口能力；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_connections.schema_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_connections.schema_version IS '本地映射模式版本；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_connections.scope_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_connections.scope_version IS '连接授权范围版本；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_connections.source_timezone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_connections.source_timezone IS '源无时区时间解释；来源：配置；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_connections.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_connections.created_at IS '本地首次登记；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_connections.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_connections.updated_at IS '本地最近更新；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_connections.sync_schedule; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_connections.sync_schedule IS 'V2.2策略：先查本地；进入/切换清单按需增量，60秒节流及跨用户合并；08:30、工作时段每30分钟、非工作时段每2小时兜底。配置不启用真实FOP，暂停规则优先。';


--
-- Name: hz_fop_datasets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_datasets (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    previous_dataset_id uuid,
    snapshot_id character varying(200),
    state character varying(40) DEFAULT 'building'::character varying NOT NULL,
    start_watermarks jsonb DEFAULT '{}'::jsonb NOT NULL,
    applied_watermarks jsonb DEFAULT '{}'::jsonb NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    validated_at timestamp with time zone,
    activated_at timestamp with time zone,
    retired_at timestamp with time zone,
    purge_after timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hz_fop_datasets_applied_watermarks_shape CHECK ((jsonb_typeof(applied_watermarks) = 'object'::text)),
    CONSTRAINT ck_hz_fop_datasets_start_watermarks_shape CHECK ((jsonb_typeof(start_watermarks) = 'object'::text)),
    CONSTRAINT ck_hz_fop_datasets_state CHECK (((state)::text = ANY ((ARRAY['building'::character varying, 'replaying'::character varying, 'validating'::character varying, 'active'::character varying, 'retired'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_datasets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_datasets IS '副本数据集与原子切换；新初始化代次先导入及追平，核对后在事务内切换公司 active_dataset_id。；公司指针与 active 状态同事务切换；读请求只读取该公司当前 active_dataset_id。；旧数据集保留至回退、导出和执行回执引用结束；清理不得破坏历史引用。';


--
-- Name: COLUMN hz_fop_datasets.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_datasets.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_datasets.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_datasets.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_datasets.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_datasets.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_datasets.previous_dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_datasets.previous_dataset_id IS '前一在线数据集；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_datasets.snapshot_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_datasets.snapshot_id IS '源快照标识；来源：初始化契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_datasets.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_datasets.state IS '数据集状态；来源：本地设计；选项：building, replaying, validating, active, retired, failed；证据：本地设计';


--
-- Name: COLUMN hz_fop_datasets.start_watermarks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_datasets.start_watermarks IS '快照前增量起点 C0；来源：初始化契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_datasets.applied_watermarks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_datasets.applied_watermarks IS '已连续应用的源进度；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_datasets.schema_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_datasets.schema_version IS '模型版本；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_datasets.validated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_datasets.validated_at IS '核对完成；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_datasets.activated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_datasets.activated_at IS '切换在线时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_datasets.retired_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_datasets.retired_at IS '停用时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_datasets.purge_after; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_datasets.purge_after IS '经批准的最早清理时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_datasets.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_datasets.created_at IS '本地首次登记；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_datasets.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_datasets.updated_at IS '本地最近更新；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: hz_fop_delivery_notices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_delivery_notices (
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) DEFAULT 'hzkj_deliver_order'::character varying NOT NULL,
    warehouse_id character varying(128),
    customer_id character varying(128),
    raw_order_status character varying(64),
    raw_wms_status character varying(64),
    logistics_bill_number character varying(200),
    wms_created_at timestamp with time zone,
    business_at timestamp with time zone,
    CONSTRAINT ck_hz_fop_delivery_notices_entity_code CHECK (((entity_code)::text = 'hzkj_deliver_order'::text))
);


--
-- Name: TABLE hz_fop_delivery_notices; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_delivery_notices IS '发货通知单；保存 发货通知单 的必要真实业务事实。；仅接收 entity_code=hzkj_deliver_order 的来源登记；同一源单快照、分录及关系在同一事务应用。';


--
-- Name: COLUMN hz_fop_delivery_notices.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_delivery_notices.document_id IS '来源登记主键；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_delivery_notices.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_delivery_notices.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_delivery_notices.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_delivery_notices.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_delivery_notices.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_delivery_notices.entity_code IS '固定来源实体；来源：本地设计；CHECK entity_code = hzkj_deliver_order；证据：本地设计';


--
-- Name: COLUMN hz_fop_delivery_notices.warehouse_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_delivery_notices.warehouse_id IS '发货仓库；来源：仓库；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_delivery_notices.customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_delivery_notices.customer_id IS '客户；来源：客户；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_delivery_notices.raw_order_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_delivery_notices.raw_order_status IS '发货状态；来源：hzkj_order_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_delivery_notices.raw_wms_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_delivery_notices.raw_wms_status IS '出库委托状态；来源：hzkj_receiptnotice_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_delivery_notices.logistics_bill_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_delivery_notices.logistics_bill_number IS 'WMS／物流单号；来源：hzkj_logsi_billno；证据：源码元数据';


--
-- Name: COLUMN hz_fop_delivery_notices.wms_created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_delivery_notices.wms_created_at IS 'WMS 委托成功时间；来源：hzkj_bill_create_time；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_delivery_notices.business_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_delivery_notices.business_at IS '发货业务日期；来源：hzkj_bizdate；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: hz_fop_dispatches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_dispatches (
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) DEFAULT 'hzkj_deliver_bill'::character varying NOT NULL,
    customer_id character varying(128),
    owner_employee_id character varying(128),
    warehouse_id character varying(128),
    provider_id character varying(128),
    actual_channel_id character varying(128),
    source_package character varying(128),
    raw_fulfillment_status character varying(64),
    raw_delivery_status character varying(64),
    raw_shopify_sync_status character varying(64),
    shopify_synced_at timestamp with time zone,
    delivery_notice_pushed_at timestamp with time zone,
    CONSTRAINT ck_hz_fop_dispatches_entity_code CHECK (((entity_code)::text = 'hzkj_deliver_bill'::text))
);


--
-- Name: TABLE hz_fop_dispatches; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_dispatches IS '发运单；保存 发运单 的必要真实业务事实。；仅接收 entity_code=hzkj_deliver_bill 的来源登记；同一源单快照、分录及关系在同一事务应用。；发运审核、Shopify 同步、发货通知推送、实物出库为不同事实。；跟踪号码类型及 Shopify 已选号码逐条保存，不能从候选号码推选。';


--
-- Name: COLUMN hz_fop_dispatches.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_dispatches.document_id IS '来源登记主键；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_dispatches.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_dispatches.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_dispatches.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_dispatches.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_dispatches.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_dispatches.entity_code IS '固定来源实体；来源：本地设计；CHECK entity_code = hzkj_deliver_bill；证据：本地设计';


--
-- Name: COLUMN hz_fop_dispatches.customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_dispatches.customer_id IS '客户；来源：hzkj_customer.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_dispatches.owner_employee_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_dispatches.owner_employee_id IS '业务员；来源：hzkj_bizoperator.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_dispatches.warehouse_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_dispatches.warehouse_id IS '仓库；来源：hzkj_basedatafield.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_dispatches.provider_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_dispatches.provider_id IS '物流服务商；来源：hzkj_logistics_providers.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_dispatches.actual_channel_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_dispatches.actual_channel_id IS '实际物流渠道；来源：hzkj_logistics_channel1.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_dispatches.source_package; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_dispatches.source_package IS '源包裹标识；来源：hzkj_src_package；证据：接口文档';


--
-- Name: COLUMN hz_fop_dispatches.raw_fulfillment_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_dispatches.raw_fulfillment_status IS '源单发货状态；来源：hzkj_fulfillment_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_dispatches.raw_delivery_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_dispatches.raw_delivery_status IS '物流交付状态；来源：hzkj_delivery_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_dispatches.raw_shopify_sync_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_dispatches.raw_shopify_sync_status IS 'Shopify 同步状态；来源：独立同步结果；证据：映射待确认';


--
-- Name: COLUMN hz_fop_dispatches.shopify_synced_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_dispatches.shopify_synced_at IS 'Shopify 同步成功时间；来源：独立同步成功时间；存 UTC；业务日期按 UTC+8 解释；证据：映射待确认';


--
-- Name: COLUMN hz_fop_dispatches.delivery_notice_pushed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_dispatches.delivery_notice_pushed_at IS '推送发货通知时间；来源：hzkj_push_time；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: hz_fop_document_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_document_packages (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    order_document_id uuid NOT NULL,
    package_id uuid NOT NULL,
    document_id uuid NOT NULL,
    relation_role character varying(40) NOT NULL,
    source_link_id character varying(128),
    source_version numeric(30,0),
    removed_at timestamp with time zone,
    CONSTRAINT ck_hz_fop_document_packages_relation_role CHECK (((relation_role)::text = ANY ((ARRAY['allocation'::character varying, 'dispatch'::character varying, 'delivery_notice'::character varying, 'outbound'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_document_packages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_document_packages IS '业务单据与稳定包裹关联；显式承载一包裹多业务单及一业务单多包裹；不能用显示包裹号猜测永久身份。；复合 FK 将 package_id 限定到同一 order_document_id；业务单与包裹的有效关系允许多对多，当前配货建单约束在事务内按 FOP 真实规则校验。；源需提供不可变包裹键及单据到包裹的关联；当前 hzkj_pkg_no／hzkj_src_package 仅作候选证据。无法证实时不落可靠关联，不据此认定整单完成。；取消、拆包、重建按显式失效和新稳定键同步，不因序号相同继承旧包裹身份。';


--
-- Name: COLUMN hz_fop_document_packages.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_packages.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_packages.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_packages.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_packages.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_packages.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_packages.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_packages.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_packages.order_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_packages.order_document_id IS '包裹所属履约订单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_packages.package_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_packages.package_id IS '稳定包裹；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_packages.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_packages.document_id IS '配货／发运／通知／出库单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_packages.relation_role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_packages.relation_role IS '关联业务角色；来源：本地设计；allocation,dispatch,delivery_notice,outbound；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_packages.source_link_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_packages.source_link_id IS '源关联稳定 ID；来源：待补包裹关联API；FOP ID／外部编号按字符串保存，不能转 JS number；证据：待补契约';


--
-- Name: COLUMN hz_fop_document_packages.source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_packages.source_version IS '关联持有方版本；来源：待补包裹关联API；证据：待补契约';


--
-- Name: COLUMN hz_fop_document_packages.removed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_packages.removed_at IS '关联失效；来源：完整关系替换；存 UTC；业务日期按 UTC+8 解释；证据：契约／规则待逐项核验';


--
-- Name: hz_fop_document_relations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_document_relations (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    from_document_id uuid NOT NULL,
    from_line_id uuid,
    to_document_id uuid NOT NULL,
    to_line_id uuid,
    relation_type character varying(64) NOT NULL,
    source_relation_id character varying(128),
    allocated_quantity numeric(24,8),
    allocated_amount numeric(28,8),
    currency_code character varying(3),
    source_version numeric(30,0),
    holder_document_id uuid NOT NULL,
    resolution_state character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    removed_at timestamp with time zone,
    relation_grain character varying(40) NOT NULL,
    CONSTRAINT ck_hz_fop_document_relations_grain_endpoints CHECK (((((relation_grain)::text = 'document'::text) AND (from_line_id IS NULL) AND (to_line_id IS NULL)) OR (((relation_grain)::text = 'document_line'::text) AND (from_line_id IS NULL) AND (to_line_id IS NOT NULL)) OR (((relation_grain)::text = 'line_document'::text) AND (from_line_id IS NOT NULL) AND (to_line_id IS NULL)) OR (((relation_grain)::text = 'line_line'::text) AND (from_line_id IS NOT NULL) AND (to_line_id IS NOT NULL)))),
    CONSTRAINT ck_hz_fop_document_relations_relation_grain CHECK (((relation_grain)::text = ANY ((ARRAY['document'::character varying, 'document_line'::character varying, 'line_document'::character varying, 'line_line'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_document_relations_relation_type CHECK (((relation_type)::text = ANY ((ARRAY['demand_purchase'::character varying, 'purchase_receipt'::character varying, 'inbound'::character varying, 'outbound'::character varying, 'allocation'::character varying, 'dispatch'::character varying, 'delivery_notice'::character varying, 'receipt'::character varying, 'payment'::character varying, 'rma'::character varying, 'purchase_return'::character varying, 'adjustment'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_document_relations_resolution_state CHECK (((resolution_state)::text = ANY ((ARRAY['pending'::character varying, 'resolved'::character varying, 'conflict'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_document_relations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_document_relations IS '单据／分录来源关系；承载一单多采购、多单合并采购、资金、售后及退货的真实关系；反向定位受影响订单。；上下游 doc／line 的 company_id 复合 FK；分录必须属于指定端点单据。；乱序先暂存待解析证据，源端点齐全后建可发布关系；不以相同 SKU 或单号模糊匹配代替来源。；关系数量与金额非必然都有；未知保留 NULL，禁止无分摊依据复制整单采购数量／金额。；上下游端点限定同 company_id、dataset_id；源关系 ID 缺失时仅使用已确认的规范端点键，不能把未证实关联强行合并。；实际提供分录来源时必须落line_line及真实分摊；只有单据来源则按document保存引用，不推导SKU级数量／金额或采购完成。缺少所需源行／分摊时登记issues并由FOP补齐。';


--
-- Name: COLUMN hz_fop_document_relations.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_relations.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_relations.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_relations.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_relations.from_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.from_document_id IS '上游单据；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_relations.from_line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.from_line_id IS '上游分录；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_relations.to_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.to_document_id IS '下游单据；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_relations.to_line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.to_line_id IS '下游分录；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_relations.relation_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.relation_type IS '关系语义；来源：本地设计；demand_purchase,purchase_receipt,inbound,outbound,allocation,dispatch,delivery_notice,receipt,payment,rma,purchase_return,adjustment；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_relations.source_relation_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.source_relation_id IS '源关系／BOTP ID；来源：真实来源关系；FOP ID／外部编号按字符串保存，不能转 JS number；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_document_relations.allocated_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.allocated_quantity IS '归属分摊数量；来源：真实来源分摊；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_document_relations.allocated_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.allocated_amount IS '归属分摊金额；来源：真实来源分摊；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_document_relations.currency_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.currency_code IS '分摊币种；来源：明确分摊币种；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_document_relations.source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.source_version IS '关系持有方版本；来源：待新增关系版本契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_document_relations.holder_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.holder_document_id IS '负责发布该关系的源单据；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_relations.resolution_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.resolution_state IS '解析状态；来源：本地设计；选项：pending, resolved, conflict；证据：本地设计';


--
-- Name: COLUMN hz_fop_document_relations.removed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.removed_at IS '关系失效时间；来源：完整来源关系替换；存 UTC；业务日期按 UTC+8 解释；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_document_relations.relation_grain; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_document_relations.relation_grain IS '真实关联粒度；来源：本地设计；选项：document, document_line, line_document, line_line；分别对应两端分录均空、仅下游有分录、仅上游有分录、两端均有分录；CHECK与端点空值组合一致；证据：本地设计';


--
-- Name: hz_fop_employee_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_employee_bindings (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    local_account_id uuid NOT NULL,
    person_record_id character varying(128),
    employee_master_id character varying(128),
    employee_number character varying(128),
    username character varying(160),
    auth_user_id character varying(128),
    display_name character varying(160),
    state character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    enabled boolean,
    directory_verified_at timestamp with time zone,
    identity_verified_at timestamp with time zone,
    last_checked_at timestamp with time zone,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hz_fop_employee_bindings_evidence_shape CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT ck_hz_fop_employee_bindings_state CHECK (((state)::text = ANY ((ARRAY['pending'::character varying, 'directory_verified'::character varying, 'identity_verified'::character varying, 'disabled'::character varying, 'conflict'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_employee_bindings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_employee_bindings IS '账号与 FOP 业务员映射；逐步接替 users 的混合身份字段，明确区分人员 ID、业务员 masterId 与认证主体。；FK local_account_id→users.id；迁移期间双读校验，未验证映射不伪造 verifiedAt。；admin→Ethan；不与本地 Ethan 账号重复绑定；不覆盖本地部门、角色及个人／部门偏好。';


--
-- Name: COLUMN hz_fop_employee_bindings.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_employee_bindings.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_employee_bindings.local_account_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.local_account_id IS '本地账号；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_employee_bindings.person_record_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.person_record_id IS 'FOP 人员记录 ID；来源：directory/page；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_employee_bindings.employee_master_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.employee_master_id IS '业务归属 masterId；来源：已验证人员／订单事实；FOP ID／外部编号按字符串保存，不能转 JS number；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_employee_bindings.employee_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.employee_number IS '工号；来源：directory/page.number；证据：接口文档';


--
-- Name: COLUMN hz_fop_employee_bindings.username; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.username IS 'FOP 用户名；来源：directory/page；证据：接口文档';


--
-- Name: COLUMN hz_fop_employee_bindings.auth_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.auth_user_id IS '已核验认证主体；来源：本人身份验证；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_employee_bindings.display_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.display_name IS '人员姓名；来源：directory/page；证据：接口文档';


--
-- Name: COLUMN hz_fop_employee_bindings.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.state IS '映射状态；来源：本地设计；选项：pending, directory_verified, identity_verified, disabled, conflict；证据：本地设计';


--
-- Name: COLUMN hz_fop_employee_bindings.enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.enabled IS '源人员是否启用；来源：directory/accountStates；证据：接口文档';


--
-- Name: COLUMN hz_fop_employee_bindings.directory_verified_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.directory_verified_at IS '目录验证时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_employee_bindings.identity_verified_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.identity_verified_at IS '本人身份验证时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_employee_bindings.last_checked_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.last_checked_at IS '最近人员状态核验；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_employee_bindings.evidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.evidence IS '非敏感绑定证据；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_employee_bindings.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.created_at IS '本地首次登记；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_employee_bindings.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_employee_bindings.updated_at IS '本地最近更新；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: hz_fop_exception_dirty; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_exception_dirty (
    batch_id uuid NOT NULL,
    document_kind text NOT NULL,
    source_id text NOT NULL,
    dispatch_changed boolean DEFAULT false NOT NULL,
    transaction_id bigint DEFAULT txid_current() NOT NULL,
    CONSTRAINT hz_fop_exception_dirty_document_kind_check CHECK ((document_kind = ANY (ARRAY['order'::text, 'stock'::text, 'revision'::text])))
);


--
-- Name: hz_fop_exception_marks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_exception_marks (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    order_document_id uuid NOT NULL,
    source_mark_key character varying(160) NOT NULL,
    type character varying(40) NOT NULL,
    reason text,
    active boolean,
    occurred_at timestamp with time zone,
    resolved_at timestamp with time zone,
    source_version numeric(30,0),
    CONSTRAINT ck_hz_fop_exception_marks_type CHECK (((type)::text = ANY ((ARRAY['procurement_exception'::character varying, 'dispatch_exception'::character varying, 'allocation_exception'::character varying, 'logistics_exception'::character varying, 'outbound_exception'::character varying, 'delivery_exception'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_exception_marks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_exception_marks IS '履约异常标记；异常分类与原因分开，和正常采购／配货／完成阶段可并存。；标签中文依次为采购退货、订单取消、配货超时、物流异常、妥投异常；不能据标签推断已取消或实际退货。';


--
-- Name: COLUMN hz_fop_exception_marks.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_exception_marks.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_exception_marks.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_exception_marks.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_exception_marks.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_exception_marks.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_exception_marks.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_exception_marks.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_exception_marks.order_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_exception_marks.order_document_id IS '履约单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_exception_marks.source_mark_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_exception_marks.source_mark_key IS '源异常稳定标识；来源：待补API；证据：待补契约';


--
-- Name: COLUMN hz_fop_exception_marks.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_exception_marks.type IS '异常类型；来源：现行类型契约；选项：procurement_exception, dispatch_exception, allocation_exception, logistics_exception, delivery_exception；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_exception_marks.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_exception_marks.reason IS '具体异常原因；来源：FOP 原因文本；证据：映射待确认';


--
-- Name: COLUMN hz_fop_exception_marks.active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_exception_marks.active IS '是否仍有效；来源：明确异常事实；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_exception_marks.occurred_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_exception_marks.occurred_at IS '异常开始；来源：明确异常事实；存 UTC；业务日期按 UTC+8 解释；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_exception_marks.resolved_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_exception_marks.resolved_at IS '解除时间；来源：明确解除事实；存 UTC；业务日期按 UTC+8 解释；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_exception_marks.source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_exception_marks.source_version IS '异常版本；来源：待新增增量契约；证据：待补契约';


--
-- Name: hz_fop_exception_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_exception_versions (
    batch_id uuid NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    transaction_id bigint
);


--
-- Name: hz_fop_export_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_export_items (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    export_job_id uuid NOT NULL,
    order_document_id uuid NOT NULL,
    sequence integer NOT NULL,
    projection_revision bigint NOT NULL,
    source_versions jsonb DEFAULT '{}'::jsonb NOT NULL,
    snapshot_payload jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_hz_fop_export_items_source_versions_shape CHECK ((jsonb_typeof(source_versions) = 'object'::text))
);


--
-- Name: TABLE hz_fop_export_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_export_items IS '导出一致快照明细；在短的一致数据库快照事务中固化导出数据，后续文件生成不占用长事务。；只保存该账号当次获权字段；下载前再核验当前归属与授权。；清理与任务文件同时过期；不保存全公司原始源载荷。';


--
-- Name: COLUMN hz_fop_export_items.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_items.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_items.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_items.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_items.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_items.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_items.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_items.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_items.export_job_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_items.export_job_id IS '导出任务；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_items.order_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_items.order_document_id IS '获权订单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_items.sequence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_items.sequence IS '最终导出排序；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_items.projection_revision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_items.projection_revision IS '快照投影修订；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_items.source_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_items.source_versions IS '来源依赖版本；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_items.snapshot_payload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_items.snapshot_payload IS '获权整单及关联导出数据；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_items.expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_items.expires_at IS '清理截止；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: hz_fop_export_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_export_jobs (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    actor_account_id uuid NOT NULL,
    queue_code character varying(64) NOT NULL,
    mode character varying(40) NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_version character varying(160) NOT NULL,
    source_watermarks jsonb DEFAULT '{}'::jsonb NOT NULL,
    state character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    row_count bigint,
    file_key text,
    snapshot_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    failure_code character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    delivery_authorized_at timestamp with time zone,
    delivery_authorization_proof jsonb,
    CONSTRAINT ck_hz_fop_export_jobs_filters_shape CHECK ((jsonb_typeof(filters) = 'object'::text)),
    CONSTRAINT ck_hz_fop_export_jobs_mode CHECK (((mode)::text = ANY ((ARRAY['filtered'::character varying, 'selected'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_export_jobs_source_watermarks_shape CHECK ((jsonb_typeof(source_watermarks) = 'object'::text)),
    CONSTRAINT ck_hz_fop_export_jobs_state CHECK (((state)::text = ANY ((ARRAY['pending'::character varying, 'snapshotting'::character varying, 'generating'::character varying, 'ready'::character varying, 'failed'::character varying, 'expired'::character varying, 'revoked'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_export_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_export_jobs IS '导出任务与授权快照；默认全部筛选结果或选中订单整单导出；重型导出异步执行。；开始、取快照及交付时复验权限；失效拒绝／作废，不静默输出部分无权数据。；限量沿用当前各清单上限；阶段二压测再调整，不能默默截断。';


--
-- Name: COLUMN hz_fop_export_jobs.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.actor_account_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.actor_account_id IS '导出账号；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.queue_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.queue_code IS '清单编码；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.mode IS '范围；来源：本地设计；选项：filtered, selected；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.filters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.filters IS '规范化查询条件；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.authorization_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.authorization_version IS '导出权限版本；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.source_watermarks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.source_watermarks IS '数据截至向量；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.state IS '任务状态；来源：本地设计；选项：pending, snapshotting, generating, ready, failed, expired, revoked；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.row_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.row_count IS '获权订单数量；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.file_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.file_key IS '受控文件引用；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.snapshot_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.snapshot_at IS '一致快照时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.expires_at IS '副本及文件过期；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.failure_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.failure_code IS '失败码；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.created_at IS '本地首次登记；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.updated_at IS '本地最近更新；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.delivery_authorized_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.delivery_authorized_at IS '交付前实时授权核验；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_export_jobs.delivery_authorization_proof; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_export_jobs.delivery_authorization_proof IS '回源范围及归属核验凭据；来源：待补实时批量授权契约；证据：待补契约';


--
-- Name: hz_fop_financial_line_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_financial_line_details (
    line_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    source_document_type character varying(128),
    source_document_number character varying(160),
    order_amount numeric(28,8),
    received_amount numeric(28,8),
    refund_amount numeric(28,8),
    fee_amount numeric(28,8),
    product_amount numeric(28,8),
    freight_amount numeric(28,8),
    tax_amount numeric(28,8),
    adjust_amount numeric(28,8),
    currency_code character varying(3)
);


--
-- Name: TABLE hz_fop_financial_line_details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_financial_line_details IS '资金分录扩展；来源分录的领域字段扩展；适用 收款、付款、调整；通过 source_lines.document_id 追溯类型头表；公司和实体类型必须匹配。；保留正负方向和真实语义；头／行金额不互相替代；财务分析不在当前建设范围。';


--
-- Name: COLUMN hz_fop_financial_line_details.line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_financial_line_details.line_id IS '分录登记主键；来源：本地设计；PK／FK→source_lines.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_financial_line_details.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_financial_line_details.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_financial_line_details.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_financial_line_details.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_financial_line_details.source_document_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_financial_line_details.source_document_type IS '源单类型；来源：hzkj_entry_src_type；证据：映射待确认';


--
-- Name: COLUMN hz_fop_financial_line_details.source_document_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_financial_line_details.source_document_number IS '源单号；来源：hzkj_src_order；证据：映射待确认';


--
-- Name: COLUMN hz_fop_financial_line_details.order_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_financial_line_details.order_amount IS '来源应收／订单额；来源：hzkj_samount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_financial_line_details.received_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_financial_line_details.received_amount IS '分录实收；来源：hzkj_real_receive_amt；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_financial_line_details.refund_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_financial_line_details.refund_amount IS '分录退款；来源：hzkj_ramount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_financial_line_details.fee_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_financial_line_details.fee_amount IS '分录手续费；来源：hzkj_handle_fee；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_financial_line_details.product_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_financial_line_details.product_amount IS '分录产品额；来源：hzkj_amountfield；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_financial_line_details.freight_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_financial_line_details.freight_amount IS '分录运费；来源：hzkj_freight；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_financial_line_details.tax_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_financial_line_details.tax_amount IS '分录固定税费；来源：hzkj_fixed_tax_fee；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_financial_line_details.adjust_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_financial_line_details.adjust_amount IS '分录调整额；来源：hzkj_adjust_amount1；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_financial_line_details.currency_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_financial_line_details.currency_code IS '本行明确币种；来源：源资金币种；证据：契约／规则待逐项核验';


--
-- Name: hz_fop_fulfillment_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_fulfillment_orders (
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) DEFAULT 'hzkj_orders'::character varying NOT NULL,
    customer_id character varying(128),
    paying_customer_id character varying(128),
    receiving_customer_id character varying(128),
    owner_employee_id character varying(128),
    store_id character varying(128),
    warehouse_id character varying(128),
    raw_order_status character varying(64),
    raw_payment_status character varying(64),
    customer_paid_at timestamp with time zone,
    settlement_currency character varying(3),
    raw_purchase_status character varying(64),
    shopify_order_number character varying(160),
    shopify_order_id character varying(128),
    consumer_paid_at timestamp with time zone,
    product_amount numeric(28,8),
    freight_amount numeric(28,8),
    tax_amount numeric(28,8),
    discount_amount numeric(28,8),
    total_amount numeric(28,8),
    raw_stock_usage character varying(64),
    raw_delivery_status character varying(64),
    outbound_at timestamp with time zone,
    raw_refund_status character varying(64),
    raw_address_check character varying(64),
    recipient_name text,
    recipient_phone character varying(80),
    recipient_email character varying(254),
    country_code character varying(2),
    state_name text,
    city_name text,
    postal_code character varying(40),
    address_line1 text,
    address_line2 text,
    custom_channel_id character varying(128),
    custom_channel_name text,
    CONSTRAINT ck_hz_fop_fulfillment_orders_entity_code CHECK (((entity_code)::text = 'hzkj_orders'::text))
);


--
-- Name: TABLE hz_fop_fulfillment_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_fulfillment_orders IS '履约订单；保存 履约订单 的必要真实业务事实。；仅接收 entity_code=hzkj_orders 的来源登记；同一源单快照、分录及关系在同一事务应用。；customer_paid_at 与 consumer_paid_at 分开；工作台相对时间使用前者，缺失不兜底。；订单产品额、总额、实收额分别保存；全款备货的产品免付事实不再次补回金额。；收件字段精确映射以现有 detail 适配器为准；不同字段不按名称猜测，详见缺口清单。';


--
-- Name: COLUMN hz_fop_fulfillment_orders.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.document_id IS '来源登记主键；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_fulfillment_orders.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_fulfillment_orders.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_fulfillment_orders.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.entity_code IS '固定来源实体；来源：本地设计；CHECK entity_code = hzkj_orders；证据：本地设计';


--
-- Name: COLUMN hz_fop_fulfillment_orders.customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.customer_id IS '订货客户；来源：hzkj_customer.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.paying_customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.paying_customer_id IS '付款客户；来源：hzkj_payingcustomer.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_fulfillment_orders.receiving_customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.receiving_customer_id IS '收货客户；来源：hzkj_reccustomer.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_fulfillment_orders.owner_employee_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.owner_employee_id IS '源业务员；来源：hzkj_operator.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.store_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.store_id IS '店铺；来源：hzkj_shop.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_fulfillment_orders.warehouse_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.warehouse_id IS '发／收货仓库；来源：hzkj_dst_warehouse.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_fulfillment_orders.raw_order_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.raw_order_status IS '原生订单状态；来源：hzkj_orderstatus；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.raw_payment_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.raw_payment_status IS '原生收款状态；来源：hzkj_receipt_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.customer_paid_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.customer_paid_at IS '客户向 FOP 付款时间；来源：hzkj_receipt_date；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.settlement_currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.settlement_currency IS '结算币种；来源：hzkj_settlecurrency.number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_fulfillment_orders.raw_purchase_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.raw_purchase_status IS '原生采购状态；来源：hzkj_purchase_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.shopify_order_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.shopify_order_number IS 'Shopify 源单号；来源：hzkj_source_number；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.shopify_order_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.shopify_order_id IS 'Shopify 源单 ID；来源：hzkj_sourceid；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.consumer_paid_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.consumer_paid_at IS 'C 端买家向店铺付款；来源：hzkj_datetimefield；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.product_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.product_amount IS '产品金额；来源：hzkj_order_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.freight_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.freight_amount IS '报价运费；来源：hzkj_fre_quo_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：源码元数据';


--
-- Name: COLUMN hz_fop_fulfillment_orders.tax_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.tax_amount IS '税费；来源：hzkj_fixed_tax_fee；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：源码元数据';


--
-- Name: COLUMN hz_fop_fulfillment_orders.discount_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.discount_amount IS '优惠金额；来源：hzkj_discount_cost；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：源码元数据';


--
-- Name: COLUMN hz_fop_fulfillment_orders.total_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.total_amount IS '履约订单总金额；来源：hzkj_total_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：源码元数据';


--
-- Name: COLUMN hz_fop_fulfillment_orders.raw_stock_usage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.raw_stock_usage IS '全款备货使用方式；来源：备货使用字段；证据：映射待确认';


--
-- Name: COLUMN hz_fop_fulfillment_orders.raw_delivery_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.raw_delivery_status IS '整单出库原始状态；来源：hzkj_delivery_status；证据：源码元数据';


--
-- Name: COLUMN hz_fop_fulfillment_orders.outbound_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.outbound_at IS '实际出库时间；来源：hzkj_outbound_time；存 UTC；业务日期按 UTC+8 解释；证据：源码元数据';


--
-- Name: COLUMN hz_fop_fulfillment_orders.raw_refund_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.raw_refund_status IS '原生退款状态；来源：hzkj_refund_status；证据：源码元数据';


--
-- Name: COLUMN hz_fop_fulfillment_orders.raw_address_check; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.raw_address_check IS '地址校验状态；来源：hzkj_addr_check_status；证据：源码元数据';


--
-- Name: COLUMN hz_fop_fulfillment_orders.recipient_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.recipient_name IS 'C 端收件人；来源：hzkj_customer_first_name + hzkj_customer_last_name；证据：映射待确认';


--
-- Name: COLUMN hz_fop_fulfillment_orders.recipient_phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.recipient_phone IS '收件电话；来源：hzkj_phone；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.recipient_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.recipient_email IS '收件邮箱；来源：hzkj_email；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.country_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.country_code IS '订单目的国；来源：hzkj_country_twocountrycode；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.state_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.state_name IS '州／省；来源：hzkj_state（元数据有，当前API未提供）；证据：映射待确认';


--
-- Name: COLUMN hz_fop_fulfillment_orders.city_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.city_name IS '城市；来源：hzkj_city；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.postal_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.postal_code IS '邮编；来源：hzkj_post_code；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.address_line1; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.address_line1 IS '详细地址第一段；来源：hzkj_address1；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.address_line2; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.address_line2 IS '详细地址补充；来源：hzkj_address2；证据：接口文档';


--
-- Name: COLUMN hz_fop_fulfillment_orders.custom_channel_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.custom_channel_id IS '履约订单物流决策 hzkj_customer_channel.id；不使用实际渠道替代';


--
-- Name: COLUMN hz_fop_fulfillment_orders.custom_channel_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_fulfillment_orders.custom_channel_name IS '履约订单物流决策 hzkj_customer_channel.name';


--
-- Name: hz_fop_inbound_bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_inbound_bills (
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) DEFAULT 'im_purinbill'::character varying NOT NULL,
    warehouse_id character varying(128),
    supplier_id character varying(128),
    business_at timestamp with time zone,
    raw_cancel_status character varying(64),
    CONSTRAINT ck_hz_fop_inbound_bills_entity_code CHECK (((entity_code)::text = 'im_purinbill'::text))
);


--
-- Name: TABLE hz_fop_inbound_bills; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_inbound_bills IS '入库单；保存 入库单 的必要真实业务事实。；仅接收 entity_code=im_purinbill 的来源登记；同一源单快照、分录及关系在同一事务应用。；平台继承实体元数据不完整，以 queryInbound 响应及平台标准字段核验；审核不直接等同全部相关需求已入库。';


--
-- Name: COLUMN hz_fop_inbound_bills.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inbound_bills.document_id IS '来源登记主键；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_inbound_bills.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inbound_bills.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_inbound_bills.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inbound_bills.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_inbound_bills.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inbound_bills.entity_code IS '固定来源实体；来源：本地设计；CHECK entity_code = im_purinbill；证据：本地设计';


--
-- Name: COLUMN hz_fop_inbound_bills.warehouse_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inbound_bills.warehouse_id IS '实际入库仓库；来源：warehouse.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_inbound_bills.supplier_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inbound_bills.supplier_id IS '供应商；来源：supplier.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_inbound_bills.business_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inbound_bills.business_at IS '入库业务日期；来源：biztime；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_inbound_bills.raw_cancel_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inbound_bills.raw_cancel_status IS '作废状态；来源：cancelstatus；证据：映射待确认';


--
-- Name: hz_fop_inventory_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_inventory_balances (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    warehouse_id character varying(128) NOT NULL,
    customer_id character varying(128),
    sku_id character varying(128) NOT NULL,
    pool_type character varying(40) NOT NULL,
    owner_key character varying(160) NOT NULL,
    on_hand_quantity numeric(24,8),
    reserved_quantity numeric(24,8),
    available_quantity numeric(24,8),
    unit_code character varying(64),
    source_version numeric(30,0),
    source_as_of timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    CONSTRAINT ck_hz_fop_inventory_balances_pool_type CHECK (((pool_type)::text = ANY ((ARRAY['customer_full'::character varying, 'customer_deposit'::character varying, 'customer_other'::character varying, 'common'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_inventory_balances_state CHECK (((state)::text = ANY ((ARRAY['unknown'::character varying, 'verified'::character varying, 'expired'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_inventory_balances; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_inventory_balances IS '库存池余额；客户权益库存与公共库存分池；查询副本不承担库存扣减／预占。；库存时效独立于订单同步；审核／配货预检需要实时 FOP；不能用订单缓存量充当即时库存。';


--
-- Name: COLUMN hz_fop_inventory_balances.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_inventory_balances.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_inventory_balances.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_inventory_balances.warehouse_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.warehouse_id IS '仓库；来源：库存接口；FOP ID／外部编号按字符串保存，不能转 JS number；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_inventory_balances.customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.customer_id IS '库存客户／货主；来源：库存接口；FOP ID／外部编号按字符串保存，不能转 JS number；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_inventory_balances.sku_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.sku_id IS 'SKU；来源：库存接口；FOP ID／外部编号按字符串保存，不能转 JS number；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_inventory_balances.pool_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.pool_type IS '库存池；来源：库存接口；customer_full,customer_deposit,customer_other,common,unknown；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_inventory_balances.owner_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.owner_key IS 'NULL 安全货主键；来源：本地规范键；明确公共池用 common；客户池使用客户 ID；未知不能入可用库存；证据：本地设计';


--
-- Name: COLUMN hz_fop_inventory_balances.on_hand_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.on_hand_quantity IS '即时在库；来源：库存接口；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_inventory_balances.reserved_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.reserved_quantity IS '已占用；来源：库存接口；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_inventory_balances.available_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.available_quantity IS '可用；来源：库存接口；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_inventory_balances.unit_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.unit_code IS '单位；来源：库存接口；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_inventory_balances.source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.source_version IS '库存资源版本；来源：待补库存增量契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_inventory_balances.source_as_of; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.source_as_of IS '源库存截至；来源：库存接口；存 UTC；业务日期按 UTC+8 解释；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_inventory_balances.synced_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.synced_at IS '接收时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_inventory_balances.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_balances.state IS '库存有效性；来源：本地设计；选项：unknown, verified, expired；证据：本地设计';


--
-- Name: hz_fop_inventory_line_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_inventory_line_details (
    line_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    warehouse_id character varying(128),
    stock_owner_id character varying(128),
    lot_number character varying(160),
    base_quantity numeric(24,8),
    base_unit_code character varying(64),
    direction character varying(40),
    raw_line_status character varying(64)
);


--
-- Name: TABLE hz_fop_inventory_line_details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_inventory_line_details IS '出入库分录扩展；来源分录的领域字段扩展；适用 入库单、出库单；通过 source_lines.document_id 追溯类型头表；公司和实体类型必须匹配。；仓库、货主、用途及单位必须明确；销售出库、采购退回、冲销不可混算。';


--
-- Name: COLUMN hz_fop_inventory_line_details.line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_line_details.line_id IS '分录登记主键；来源：本地设计；PK／FK→source_lines.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_inventory_line_details.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_line_details.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_inventory_line_details.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_line_details.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_inventory_line_details.warehouse_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_line_details.warehouse_id IS '实际仓库；来源：仓库；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_inventory_line_details.stock_owner_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_line_details.stock_owner_id IS '库存货主；来源：库存货主；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_inventory_line_details.lot_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_line_details.lot_number IS '批次；来源：批次；证据：映射待确认';


--
-- Name: COLUMN hz_fop_inventory_line_details.base_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_line_details.base_quantity IS '基本单位数量；来源：基本数量；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_inventory_line_details.base_unit_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_line_details.base_unit_code IS '基本单位；来源：基本单位；证据：映射待确认';


--
-- Name: COLUMN hz_fop_inventory_line_details.direction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_line_details.direction IS '库存方向；来源：入库／出库实际类型；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_inventory_line_details.raw_line_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_inventory_line_details.raw_line_status IS '实际执行状态；来源：分录状态；证据：映射待确认';


--
-- Name: hz_fop_order_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_order_flags (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    order_document_id uuid NOT NULL,
    flag_type character varying(40) NOT NULL,
    raw_value character varying(100),
    normalized_value character varying(40),
    source_document_id uuid,
    occurred_at timestamp with time zone,
    source_version numeric(30,0),
    CONSTRAINT ck_hz_fop_order_flags_flag_type CHECK (((flag_type)::text = ANY ((ARRAY['interception'::character varying, 'cancellation'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_order_flags_normalized_value CHECK (((((flag_type)::text = 'interception'::text) AND ((normalized_value)::text = ANY ((ARRAY['intercepted'::character varying, 'released'::character varying, 'unknown'::character varying])::text[]))) OR (((flag_type)::text = 'cancellation'::text) AND ((normalized_value)::text = ANY ((ARRAY['requested'::character varying, 'cancelled'::character varying, 'none'::character varying, 'unknown'::character varying])::text[])))))
);


--
-- Name: TABLE hz_fop_order_flags; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_order_flags IS '订单取消／拦截事实；保存明确取消与拦截结果，供待出库排除拦截及红绿标签使用。；所有 RMA 建单应触发拦截是 FOP 流程要求；缺少实际结果时保持 unknown，不能在本地假装已执行。';


--
-- Name: COLUMN hz_fop_order_flags.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_flags.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_order_flags.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_flags.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_order_flags.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_flags.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_order_flags.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_flags.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_order_flags.order_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_flags.order_document_id IS '履约单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_order_flags.flag_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_flags.flag_type IS '标记类别；来源：本地设计；interception,cancellation；证据：本地设计';


--
-- Name: COLUMN hz_fop_order_flags.raw_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_flags.raw_value IS '源标记原值；来源：待补API；证据：待补契约';


--
-- Name: COLUMN hz_fop_order_flags.normalized_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_flags.normalized_value IS '规范结果；来源：明确映射；interception: intercepted,released,unknown；cancellation: requested,cancelled,none,unknown；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_order_flags.source_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_flags.source_document_id IS '来源 RMA／拦截载体；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_order_flags.occurred_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_flags.occurred_at IS '实际发生时间；来源：明确事件；存 UTC；业务日期按 UTC+8 解释；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_order_flags.source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_flags.source_version IS '事实版本；来源：待新增增量契约；证据：待补契约';


--
-- Name: hz_fop_order_line_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_order_line_details (
    line_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    source_quantity numeric(24,8),
    stock_consumed_quantity numeric(24,8),
    purchased_quantity numeric(24,8),
    inbound_quantity numeric(24,8),
    discount_amount numeric(28,8),
    tax_amount numeric(28,8),
    gross_amount numeric(28,8),
    raw_purchase_status character varying(64),
    shopify_line_id character varying(160)
);


--
-- Name: TABLE hz_fop_order_line_details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_order_line_details IS '履约／备货商品扩展；来源分录的领域字段扩展；适用 hzkj_orders、hzkj_stock_order_new；通过 source_lines.document_id 追溯类型头表；公司和实体类型必须匹配。；BOM 父行与子行保留 row_type，统计件数与金额使用明确角色，不能父子重复计数。';


--
-- Name: COLUMN hz_fop_order_line_details.line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_line_details.line_id IS '分录登记主键；来源：本地设计；PK／FK→source_lines.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_order_line_details.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_line_details.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_order_line_details.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_line_details.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_order_line_details.source_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_line_details.source_quantity IS 'Shopify 源数量；来源：hzkj_src_qty；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_order_line_details.stock_consumed_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_line_details.stock_consumed_quantity IS '耗用备货数量；来源：hzkj_consume_stock；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_order_line_details.purchased_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_line_details.purchased_quantity IS '采购数量；来源：hzkj_purcqty；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_order_line_details.inbound_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_line_details.inbound_quantity IS '已入库数量；来源：hzkj_instock_qty；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_order_line_details.discount_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_line_details.discount_amount IS '商品优惠金额；来源：hzkj_entry_disc_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_order_line_details.tax_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_line_details.tax_amount IS '商品税费；来源：hzkj_taxamount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_order_line_details.gross_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_line_details.gross_amount IS '商品价税合计；来源：hzkj_amountandtax；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_order_line_details.raw_purchase_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_line_details.raw_purchase_status IS '行采购状态；来源：hzkj_entrypurc_status；证据：映射待确认';


--
-- Name: COLUMN hz_fop_order_line_details.shopify_line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_line_details.shopify_line_id IS 'Shopify 商品行 ID；来源：hzkj_shopify_itemid；证据：映射待确认';


--
-- Name: hz_fop_order_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_order_packages (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    order_document_id uuid NOT NULL,
    source_package_key character varying(160) NOT NULL,
    package_number character varying(128),
    warehouse_id character varying(128),
    provider_id character varying(128),
    channel_id character varying(128),
    expected_active boolean,
    source_version numeric(30,0),
    removed_at timestamp with time zone,
    tracking_number text
);


--
-- Name: TABLE hz_fop_order_packages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_order_packages IS '履约包裹；保存同单多个应履约包裹，避免已有一张发运单掩盖缺失包裹。；稳定包裹键需 API 返回；不能只凭显示序号认定永久身份。';


--
-- Name: COLUMN hz_fop_order_packages.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_packages.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_order_packages.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_packages.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_order_packages.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_packages.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_order_packages.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_packages.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_order_packages.order_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_packages.order_document_id IS '来源履约单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_order_packages.source_package_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_packages.source_package_key IS '源包裹稳定键；来源：包裹原生键；证据：映射待确认';


--
-- Name: COLUMN hz_fop_order_packages.package_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_packages.package_number IS '包裹号；来源：hzkj_combofield／hzkj_pkg_no；证据：映射待确认';


--
-- Name: COLUMN hz_fop_order_packages.warehouse_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_packages.warehouse_id IS '路由仓库；来源：包裹／配货仓库；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_order_packages.provider_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_packages.provider_id IS '物流商；来源：包裹物流商；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_order_packages.channel_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_packages.channel_id IS '实际物流渠道；来源：包裹渠道；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_order_packages.expected_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_packages.expected_active IS '应参与履约的有效包裹；来源：源包裹有效事实；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_order_packages.source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_packages.source_version IS '来源订单版本；来源：待新增增量契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_order_packages.removed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_packages.removed_at IS '包裹取消／移除；来源：原生有效性；存 UTC；业务日期按 UTC+8 解释；证据：映射待确认';


--
-- Name: COLUMN hz_fop_order_packages.tracking_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_order_packages.tracking_number IS '履约订单包裹 hzkj_tracking_number 回写镜像；制作发运单时取号，删除发运单清空，重建更新；待审核只展示自定义与实际渠道，不读取此号码';


--
-- Name: hz_fop_order_relation_paths; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_order_relation_paths (
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    order_document_id uuid NOT NULL,
    relation_id uuid NOT NULL,
    basis text NOT NULL
);


--
-- Name: TABLE hz_fop_order_relation_paths; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_order_relation_paths IS '已验证来源关系的履约/备货根单索引；不固化用户权限';


--
-- Name: hz_fop_outbound_bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_outbound_bills (
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) DEFAULT 'im_saloutbill'::character varying NOT NULL,
    warehouse_id character varying(128),
    customer_id character varying(128),
    business_at timestamp with time zone,
    raw_cancel_status character varying(64),
    movement_kind character varying(64),
    CONSTRAINT ck_hz_fop_outbound_bills_entity_code CHECK (((entity_code)::text = 'im_saloutbill'::text))
);


--
-- Name: TABLE hz_fop_outbound_bills; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_outbound_bills IS '出库单；保存 出库单 的必要真实业务事实。；仅接收 entity_code=im_saloutbill 的来源登记；同一源单快照、分录及关系在同一事务应用。；原始多单／多行事实保留；工作台按履约整单规则判断完成，不提供部分出库业务选项。；采购退货出库与销售出库不能混为同一完成事实。';


--
-- Name: COLUMN hz_fop_outbound_bills.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_outbound_bills.document_id IS '来源登记主键；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_outbound_bills.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_outbound_bills.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_outbound_bills.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_outbound_bills.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_outbound_bills.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_outbound_bills.entity_code IS '固定来源实体；来源：本地设计；CHECK entity_code = im_saloutbill；证据：本地设计';


--
-- Name: COLUMN hz_fop_outbound_bills.warehouse_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_outbound_bills.warehouse_id IS '实际出库仓库；来源：warehouse.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_outbound_bills.customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_outbound_bills.customer_id IS '客户；来源：customer.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_outbound_bills.business_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_outbound_bills.business_at IS '出库业务日期；来源：biztime；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_outbound_bills.raw_cancel_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_outbound_bills.raw_cancel_status IS '作废状态；来源：cancelstatus；证据：映射待确认';


--
-- Name: COLUMN hz_fop_outbound_bills.movement_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_outbound_bills.movement_kind IS '出库用途；来源：源单类型／业务类型；证据：契约／规则待逐项核验';


--
-- Name: hz_fop_package_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_package_lines (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    order_document_id uuid NOT NULL,
    package_id uuid NOT NULL,
    order_line_id uuid NOT NULL,
    quantity numeric(24,8),
    source_version numeric(30,0),
    removed_at timestamp with time zone
);


--
-- Name: TABLE hz_fop_package_lines; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_package_lines IS '包裹商品分配；记录包裹与商品行多对多及数量。；同公司、同履约单校验；合计不得无依据复制完整商品数量到每个包裹。';


--
-- Name: COLUMN hz_fop_package_lines.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_package_lines.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_package_lines.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_package_lines.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_package_lines.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_package_lines.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_package_lines.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_package_lines.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_package_lines.order_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_package_lines.order_document_id IS '所属履约订单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_package_lines.package_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_package_lines.package_id IS '包裹；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_package_lines.order_line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_package_lines.order_line_id IS '履约来源分录；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_package_lines.quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_package_lines.quantity IS '分配数量；来源：包裹真实归包数量；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_package_lines.source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_package_lines.source_version IS '归包版本；来源：待新增增量契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_package_lines.removed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_package_lines.removed_at IS '关系解除；来源：完整归包事实；存 UTC；业务日期按 UTC+8 解释；证据：契约／规则待逐项核验';


--
-- Name: hz_fop_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_payments (
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) DEFAULT 'hzkj_pay_cost_bill'::character varying NOT NULL,
    purchase_source_id character varying(128),
    purchase_number character varying(160),
    platform_order_number character varying(200),
    amount numeric(28,8),
    due_amount numeric(28,8),
    refund_amount numeric(28,8),
    currency_code character varying(3),
    raw_payment_status character varying(64),
    paid_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    CONSTRAINT ck_hz_fop_payments_entity_code CHECK (((entity_code)::text = 'hzkj_pay_cost_bill'::text))
);


--
-- Name: TABLE hz_fop_payments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_payments IS '付款单；保存 付款单 的必要真实业务事实。；仅接收 entity_code=hzkj_pay_cost_bill 的来源登记；同一源单快照、分录及关系在同一事务应用。；供应商待发货计时仅使用明确真实采购付款时间，不使用客户付款、建单或审核日期。';


--
-- Name: COLUMN hz_fop_payments.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_payments.document_id IS '来源登记主键；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_payments.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_payments.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_payments.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_payments.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_payments.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_payments.entity_code IS '固定来源实体；来源：本地设计；CHECK entity_code = hzkj_pay_cost_bill；证据：本地设计';


--
-- Name: COLUMN hz_fop_payments.purchase_source_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_payments.purchase_source_id IS '采购订单来源 ID；来源：hzkj_purchase_id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_payments.purchase_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_payments.purchase_number IS '采购单号；来源：hzkj_purorder_no；证据：接口文档';


--
-- Name: COLUMN hz_fop_payments.platform_order_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_payments.platform_order_number IS '1688 订单号；来源：hzkj_1688_order_id；证据：接口文档';


--
-- Name: COLUMN hz_fop_payments.amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_payments.amount IS '实际付款金额；来源：hzkj_actpayamt；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_payments.due_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_payments.due_amount IS '应付金额；来源：hzkj_due_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_payments.refund_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_payments.refund_amount IS '累计退款金额；来源：hzkj_refund_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_payments.currency_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_payments.currency_code IS '付款币种；来源：hzkj_currency.number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_payments.raw_payment_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_payments.raw_payment_status IS '付款状态；来源：hzkj_pay_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_payments.paid_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_payments.paid_at IS '供应商实际付款时间；来源：hzkj_paydate；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_payments.confirmed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_payments.confirmed_at IS '付款确认时间；来源：hzkj_confirm_time；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: hz_fop_platform_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_platform_orders (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    purchase_document_id uuid NOT NULL,
    platform_code character varying(64),
    purchasing_account_id character varying(160),
    external_order_id character varying(200) NOT NULL,
    external_suborder_id character varying(200),
    raw_status character varying(64),
    paid_at timestamp with time zone,
    shipped_at timestamp with time zone,
    paid_amount numeric(28,8),
    currency_code character varying(3),
    removed_at timestamp with time zone
);


--
-- Name: TABLE hz_fop_platform_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_platform_orders IS '采购平台订单映射；一采购单可关联多条平台记录，保持1688长编号精度。；此表保存采购单提供的平台关联快照；平台业务号可被多采购单引用，不将本地行数当独立付款次数。按平台、已验证采购账号、主／子交易及资金事件键识别同一义务，禁止重复加总；账号、子单或分摊缺失时金额覆盖为 unknown。';


--
-- Name: COLUMN hz_fop_platform_orders.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_platform_orders.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_platform_orders.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_platform_orders.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_platform_orders.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_platform_orders.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_platform_orders.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_platform_orders.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_platform_orders.purchase_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_platform_orders.purchase_document_id IS '采购单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_platform_orders.platform_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_platform_orders.platform_code IS '平台编码；来源：采购类型；证据：映射待确认';


--
-- Name: COLUMN hz_fop_platform_orders.purchasing_account_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_platform_orders.purchasing_account_id IS '采购账号；来源：平台采购账号；证据：映射待确认';


--
-- Name: COLUMN hz_fop_platform_orders.external_order_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_platform_orders.external_order_id IS '平台主订单号；来源：hzkj_1688_order_n；证据：映射待确认';


--
-- Name: COLUMN hz_fop_platform_orders.external_suborder_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_platform_orders.external_suborder_id IS '平台子单号；来源：平台子订单号；证据：映射待确认';


--
-- Name: COLUMN hz_fop_platform_orders.raw_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_platform_orders.raw_status IS '平台交易状态；来源：hzkj_pay_status；证据：映射待确认';


--
-- Name: COLUMN hz_fop_platform_orders.paid_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_platform_orders.paid_at IS '平台实际付款时间；来源：平台付款结果；存 UTC；业务日期按 UTC+8 解释；证据：映射待确认';


--
-- Name: COLUMN hz_fop_platform_orders.shipped_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_platform_orders.shipped_at IS '平台发货时间；来源：hzkj_shipping_tim；存 UTC；业务日期按 UTC+8 解释；证据：映射待确认';


--
-- Name: COLUMN hz_fop_platform_orders.paid_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_platform_orders.paid_amount IS '平台已付金额；来源：hzkj_actual_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_platform_orders.currency_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_platform_orders.currency_code IS '付款币种；来源：明确平台币种；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_platform_orders.removed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_platform_orders.removed_at IS '关系解除；来源：平台关联有效性；存 UTC；业务日期按 UTC+8 解释；证据：映射待确认';


--
-- Name: hz_fop_procurement_line_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_procurement_line_details (
    line_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    supplier_id character varying(128),
    ordered_quantity numeric(24,8),
    supplier_shipped_quantity numeric(24,8),
    received_quantity numeric(24,8),
    inbound_quantity numeric(24,8),
    cancelled_quantity numeric(24,8),
    raw_close_status character varying(64),
    raw_platform_status character varying(64),
    sales_order_number character varying(200)
);


--
-- Name: TABLE hz_fop_procurement_line_details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_procurement_line_details IS '采购分录扩展；来源分录的领域字段扩展；适用 采购申请、采购订单、收货通知；通过 source_lines.document_id 追溯类型头表；公司和实体类型必须匹配。；各数量仅保留明确原生事实，未知不保存为零；已取消义务与已退款分开。';


--
-- Name: COLUMN hz_fop_procurement_line_details.line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_procurement_line_details.line_id IS '分录登记主键；来源：本地设计；PK／FK→source_lines.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_procurement_line_details.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_procurement_line_details.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_procurement_line_details.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_procurement_line_details.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_procurement_line_details.supplier_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_procurement_line_details.supplier_id IS '供应商；来源：采购来源；FOP ID／外部编号按字符串保存，不能转 JS number；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_procurement_line_details.ordered_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_procurement_line_details.ordered_quantity IS '已采购数量；来源：实际采购量；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_procurement_line_details.supplier_shipped_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_procurement_line_details.supplier_shipped_quantity IS '供应商已发数量；来源：实际发货量；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_procurement_line_details.received_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_procurement_line_details.received_quantity IS '已收货数量；来源：实际收货量；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_procurement_line_details.inbound_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_procurement_line_details.inbound_quantity IS '已入库数量；来源：实际入库量；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_procurement_line_details.cancelled_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_procurement_line_details.cancelled_quantity IS '已取消义务数量；来源：取消事实；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_procurement_line_details.raw_close_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_procurement_line_details.raw_close_status IS '行关闭状态；来源：hzkj_rowclosestatus；证据：映射待确认';


--
-- Name: COLUMN hz_fop_procurement_line_details.raw_platform_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_procurement_line_details.raw_platform_status IS '行平台状态；来源：平台行状态；证据：映射待确认';


--
-- Name: COLUMN hz_fop_procurement_line_details.sales_order_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_procurement_line_details.sales_order_number IS '采购分录销售订单编号：hzkj_purorderbill.hzkj_billentry.hzkj_salbillnumber；整单履约笔数按去除首尾空白后的非空编号去重；NULL表示未同步，禁止用履约ID或分摊行数替代';


--
-- Name: hz_fop_projection_dependencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_projection_dependencies (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    order_document_id uuid NOT NULL,
    source_document_id uuid NOT NULL,
    source_version numeric(30,0),
    relation_revision bigint NOT NULL,
    projection_revision bigint NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE hz_fop_projection_dependencies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_projection_dependencies IS '投影来源依赖；采购／资金／配货等变化按反向关系仅重算旧／新受影响订单。；另包含库存／授权等非单据依赖于 dependency_vector；不能只盯履约单更新时间。';


--
-- Name: COLUMN hz_fop_projection_dependencies.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_projection_dependencies.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_projection_dependencies.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_projection_dependencies.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_projection_dependencies.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_projection_dependencies.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_projection_dependencies.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_projection_dependencies.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_projection_dependencies.order_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_projection_dependencies.order_document_id IS '投影订单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_projection_dependencies.source_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_projection_dependencies.source_document_id IS '依赖源单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_projection_dependencies.source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_projection_dependencies.source_version IS '参与计算源版本；来源：可靠版本；证据：映射待确认';


--
-- Name: COLUMN hz_fop_projection_dependencies.relation_revision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_projection_dependencies.relation_revision IS '来源关系本地修订；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_projection_dependencies.projection_revision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_projection_dependencies.projection_revision IS '结果修订；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_projection_dependencies.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_projection_dependencies.updated_at IS '最近重算；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: hz_fop_purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_purchase_orders (
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) DEFAULT 'hzkj_purorderbill'::character varying NOT NULL,
    supplier_id character varying(128),
    buyer_id character varying(128),
    purchasing_account_id character varying(128),
    purchase_type character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    platform_code character varying(64),
    total_amount numeric(28,8),
    settlement_currency character varying(3),
    paid_amount numeric(28,8),
    unpaid_amount numeric(28,8),
    raw_trade_status character varying(64),
    raw_platform_status character varying(64),
    raw_cancel_status character varying(64),
    business_at timestamp with time zone,
    paid_at timestamp with time zone,
    CONSTRAINT ck_hz_fop_purchase_orders_entity_code CHECK (((entity_code)::text = 'hzkj_purorderbill'::text)),
    CONSTRAINT ck_hz_fop_purchase_orders_purchase_type CHECK (((purchase_type)::text = ANY ((ARRAY['online'::character varying, 'offline'::character varying, 'unknown'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_purchase_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_purchase_orders IS '采购订单；保存 采购订单 的必要真实业务事实。；仅接收 entity_code=hzkj_purorderbill 的来源登记；同一源单快照、分录及关系在同一事务应用。；一张采购单一个供应商；平台订单可有多条映射，不将1688编号存为整数。；待创建采购单是查询分组，没有真实采购单时不建虚拟来源单。';


--
-- Name: COLUMN hz_fop_purchase_orders.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.document_id IS '来源登记主键；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_purchase_orders.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_purchase_orders.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_purchase_orders.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.entity_code IS '固定来源实体；来源：本地设计；CHECK entity_code = hzkj_purorderbill；证据：本地设计';


--
-- Name: COLUMN hz_fop_purchase_orders.supplier_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.supplier_id IS '唯一供应商；来源：hzkj_supplier.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_purchase_orders.buyer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.buyer_id IS '采购员；来源：hzkj_operator.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_purchase_orders.purchasing_account_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.purchasing_account_id IS '平台采购账号；来源：采购账号；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_purchase_orders.purchase_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.purchase_type IS '采购类型；来源：采购类型映射；选项：online, offline, unknown；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_purchase_orders.platform_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.platform_code IS '线上平台；来源：1688／其他平台字段；证据：映射待确认';


--
-- Name: COLUMN hz_fop_purchase_orders.total_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.total_amount IS '采购结算金额；来源：hzkj_totalallamount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_purchase_orders.settlement_currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.settlement_currency IS '采购结算币种；来源：hzkj_settlecurrency.number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_purchase_orders.paid_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.paid_amount IS '供应商已付金额；来源：hzkj_paidallamount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_purchase_orders.unpaid_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.unpaid_amount IS '供应商未付金额；来源：hzkj_unpaidallamount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_purchase_orders.raw_trade_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.raw_trade_status IS '采购／平台交易状态；来源：hzkj_tradestatus；证据：接口文档';


--
-- Name: COLUMN hz_fop_purchase_orders.raw_platform_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.raw_platform_status IS '1688 状态；来源：hzkj_pay_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_purchase_orders.raw_cancel_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.raw_cancel_status IS '取消／作废原始状态；来源：hzkj_cancelstatus；证据：接口文档';


--
-- Name: COLUMN hz_fop_purchase_orders.business_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.business_at IS '采购日期；来源：hzkj_biztime；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_purchase_orders.paid_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_orders.paid_at IS '采购订单付款时间；具体FOP字段待确认，禁止创建时间兜底';


--
-- Name: hz_fop_purchase_requisitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_purchase_requisitions (
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) DEFAULT 'hzkj_purapplybill'::character varying NOT NULL,
    requesting_org_id character varying(128),
    business_at timestamp with time zone,
    raw_procurement_status character varying(64),
    raw_close_status character varying(64),
    raw_cancel_status character varying(64),
    CONSTRAINT ck_hz_fop_purchase_requisitions_entity_code CHECK (((entity_code)::text = 'hzkj_purapplybill'::text))
);


--
-- Name: TABLE hz_fop_purchase_requisitions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_purchase_requisitions IS '采购申请单；保存 采购申请单 的必要真实业务事实。；仅接收 entity_code=hzkj_purapplybill 的来源登记；同一源单快照、分录及关系在同一事务应用。';


--
-- Name: COLUMN hz_fop_purchase_requisitions.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_requisitions.document_id IS '来源登记主键；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_purchase_requisitions.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_requisitions.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_purchase_requisitions.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_requisitions.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_purchase_requisitions.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_requisitions.entity_code IS '固定来源实体；来源：本地设计；CHECK entity_code = hzkj_purapplybill；证据：本地设计';


--
-- Name: COLUMN hz_fop_purchase_requisitions.requesting_org_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_requisitions.requesting_org_id IS '申请组织；来源：申请组织；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_purchase_requisitions.business_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_requisitions.business_at IS '申请日期；来源：hzkj_biztime；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_purchase_requisitions.raw_procurement_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_requisitions.raw_procurement_status IS '采购状态；来源：hzkj_procurement_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_purchase_requisitions.raw_close_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_requisitions.raw_close_status IS '关闭状态；来源：hzkj_closestatus；证据：接口文档';


--
-- Name: COLUMN hz_fop_purchase_requisitions.raw_cancel_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_requisitions.raw_cancel_status IS '作废状态；来源：hzkj_cancelstatus；证据：接口文档';


--
-- Name: hz_fop_purchase_returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_purchase_returns (
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) DEFAULT 'hzkj_purrefundapplybill'::character varying NOT NULL,
    supplier_id character varying(128),
    purchase_source_id character varying(128),
    return_kind character varying(64),
    raw_flow_status character varying(64),
    physical_route character varying(64),
    reason text,
    requested_amount numeric(28,8),
    request_currency character varying(3),
    platform_refund_amount numeric(28,8),
    platform_refund_id character varying(200),
    raw_physical_status character varying(64),
    raw_financial_status character varying(64),
    CONSTRAINT ck_hz_fop_purchase_returns_entity_code CHECK (((entity_code)::text = 'hzkj_purrefundapplybill'::text))
);


--
-- Name: TABLE hz_fop_purchase_returns; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_purchase_returns IS '采购退货单；保存 采购退货单 的必要真实业务事实。；仅接收 entity_code=hzkj_purrefundapplybill 的来源登记；同一源单快照、分录及关系在同一事务应用。；实体已存在不代表完整流程／API 已发布；首期结构预留，字段及查询能力逐项确认。；工作台只展示实物退回；事实层保留仅退款供正确关联。履约／RMA／全款备货来源不重复发起规则由 FOP 执行业务保障。';


--
-- Name: COLUMN hz_fop_purchase_returns.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.document_id IS '来源登记主键；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_purchase_returns.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_purchase_returns.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_purchase_returns.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.entity_code IS '固定来源实体；来源：本地设计；CHECK entity_code = hzkj_purrefundapplybill；证据：本地设计';


--
-- Name: COLUMN hz_fop_purchase_returns.supplier_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.supplier_id IS '供应商；来源：供应商；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_purchase_returns.purchase_source_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.purchase_source_id IS '原采购单 ID；来源：真实来源关联；FOP ID／外部编号按字符串保存，不能转 JS number；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_purchase_returns.return_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.return_kind IS '退货／仅退款种类；来源：采购退货策略；证据：映射待确认';


--
-- Name: COLUMN hz_fop_purchase_returns.raw_flow_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.raw_flow_status IS '原始处理状态；来源：原生处理状态；证据：映射待确认';


--
-- Name: COLUMN hz_fop_purchase_returns.physical_route; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.physical_route IS '实物路线；来源：未发货／在途／已入库路线；证据：映射待确认';


--
-- Name: COLUMN hz_fop_purchase_returns.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.reason IS '采购退货原因；来源：原始原因；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_purchase_returns.requested_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.requested_amount IS '申请退款金额；来源：申请金额；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_purchase_returns.request_currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.request_currency IS '申请币种；来源：hzkj_settlecurrency.number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_purchase_returns.platform_refund_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.platform_refund_amount IS '平台已核实退款；来源：1688 实际退款；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_purchase_returns.platform_refund_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.platform_refund_id IS '平台退款业务号；来源：1688退款号；证据：映射待确认';


--
-- Name: COLUMN hz_fop_purchase_returns.raw_physical_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.raw_physical_status IS '实物退回状态；来源：退回事实；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_purchase_returns.raw_financial_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_purchase_returns.raw_financial_status IS '退款核对状态；来源：采购退款收款核对；证据：映射待确认';


--
-- Name: hz_fop_receipt_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_receipt_adjustments (
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) DEFAULT 'hzkj_adjust_bill'::character varying NOT NULL,
    customer_id character varying(128),
    owner_employee_id character varying(128),
    currency_code character varying(3),
    adjust_amount numeric(28,8),
    fee_amount numeric(28,8),
    reason text,
    CONSTRAINT ck_hz_fop_receipt_adjustments_entity_code CHECK (((entity_code)::text = 'hzkj_adjust_bill'::text))
);


--
-- Name: TABLE hz_fop_receipt_adjustments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_receipt_adjustments IS '收款调整单；保存 收款调整单 的必要真实业务事实。；仅接收 entity_code=hzkj_adjust_bill 的来源登记；同一源单快照、分录及关系在同一事务应用。；RMA 客户侧退款与供应商退款分别关联，不合并为同一资金事件。';


--
-- Name: COLUMN hz_fop_receipt_adjustments.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_adjustments.document_id IS '来源登记主键；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_receipt_adjustments.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_adjustments.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_receipt_adjustments.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_adjustments.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_receipt_adjustments.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_adjustments.entity_code IS '固定来源实体；来源：本地设计；CHECK entity_code = hzkj_adjust_bill；证据：本地设计';


--
-- Name: COLUMN hz_fop_receipt_adjustments.customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_adjustments.customer_id IS '客户；来源：客户；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_receipt_adjustments.owner_employee_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_adjustments.owner_employee_id IS '业务员；来源：hzkj_user.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_receipt_adjustments.currency_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_adjustments.currency_code IS '调整结算币种；来源：hzkj_currency.number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_receipt_adjustments.adjust_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_adjustments.adjust_amount IS '调整金额；来源：hzkj_adjust_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_receipt_adjustments.fee_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_adjustments.fee_amount IS '手续费金额；来源：hzkj_fee_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_receipt_adjustments.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_adjustments.reason IS '调整原因；来源：调整原因；证据：映射待确认';


--
-- Name: hz_fop_receipt_notices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_receipt_notices (
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) DEFAULT 'hzkj_receiptnotice'::character varying NOT NULL,
    supplier_id character varying(128),
    warehouse_id character varying(128),
    business_at timestamp with time zone,
    supplier_shipped_at timestamp with time zone,
    tracking_number character varying(200),
    raw_wms_status character varying(64),
    raw_shipping_status character varying(64),
    CONSTRAINT ck_hz_fop_receipt_notices_entity_code CHECK (((entity_code)::text = 'hzkj_receiptnotice'::text))
);


--
-- Name: TABLE hz_fop_receipt_notices; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_receipt_notices IS '收货通知单；保存 收货通知单 的必要真实业务事实。；仅接收 entity_code=hzkj_receiptnotice 的来源登记；同一源单快照、分录及关系在同一事务应用。';


--
-- Name: COLUMN hz_fop_receipt_notices.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_notices.document_id IS '来源登记主键；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_receipt_notices.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_notices.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_receipt_notices.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_notices.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_receipt_notices.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_notices.entity_code IS '固定来源实体；来源：本地设计；CHECK entity_code = hzkj_receiptnotice；证据：本地设计';


--
-- Name: COLUMN hz_fop_receipt_notices.supplier_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_notices.supplier_id IS '供应商；来源：供应商；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_receipt_notices.warehouse_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_notices.warehouse_id IS '收货仓库；来源：仓库；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_receipt_notices.business_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_notices.business_at IS '通知日期；来源：hzkj_biztime；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_receipt_notices.supplier_shipped_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_notices.supplier_shipped_at IS '供应商发货时间；来源：hzkj_shipping_time；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_receipt_notices.tracking_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_notices.tracking_number IS '供应商运单号；来源：hzkj_waybill_number；证据：接口文档';


--
-- Name: COLUMN hz_fop_receipt_notices.raw_wms_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_notices.raw_wms_status IS '入库委托状态；来源：hzkj_receiptnotice_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_receipt_notices.raw_shipping_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipt_notices.raw_shipping_status IS '供应商物流状态；来源：hzkj_status_changed；证据：接口文档';


--
-- Name: hz_fop_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_receipts (
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) DEFAULT 'hzkj_receive_bill'::character varying NOT NULL,
    paying_customer_id character varying(128),
    owner_employee_id character varying(128),
    receipt_type character varying(64),
    raw_receive_status character varying(64),
    raw_arrival_status character varying(64),
    received_at timestamp with time zone,
    received_amount numeric(28,8),
    order_amount numeric(28,8),
    currency_code character varying(3),
    external_transaction_id character varying(200),
    CONSTRAINT ck_hz_fop_receipts_entity_code CHECK (((entity_code)::text = 'hzkj_receive_bill'::text))
);


--
-- Name: TABLE hz_fop_receipts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_receipts IS '收款单；保存 收款单 的必要真实业务事实。；仅接收 entity_code=hzkj_receive_bill 的来源登记；同一源单快照、分录及关系在同一事务应用。；供应商采购退款类型收款与客户收款分别保存；不把查询副本变为新的收款业务账本。；表头实收不复制到每条来源分录；本单收款日期筛选不依赖每次扫描该表。';


--
-- Name: COLUMN hz_fop_receipts.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipts.document_id IS '来源登记主键；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_receipts.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipts.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_receipts.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipts.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_receipts.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipts.entity_code IS '固定来源实体；来源：本地设计；CHECK entity_code = hzkj_receive_bill；证据：本地设计';


--
-- Name: COLUMN hz_fop_receipts.paying_customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipts.paying_customer_id IS '付款客户；来源：hzkj_pay_customer.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_receipts.owner_employee_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipts.owner_employee_id IS '收款业务员；来源：hzkj_bizperson.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_receipts.receipt_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipts.receipt_type IS '收款业务类型；来源：hzkj_type；证据：映射待确认';


--
-- Name: COLUMN hz_fop_receipts.raw_receive_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipts.raw_receive_status IS '收款状态；来源：hzkj_receive_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_receipts.raw_arrival_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipts.raw_arrival_status IS '到账状态；来源：hzkj_receipt_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_receipts.received_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipts.received_at IS '成功收款时间；来源：hzkj_receive_time；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_receipts.received_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipts.received_amount IS '表头实收金额；来源：hzkj_rec_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_receipts.order_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipts.order_amount IS '收款对应订单额；来源：hzkj_receive_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_receipts.currency_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipts.currency_code IS '实收币种；来源：hzkj_receive_currency.number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_receipts.external_transaction_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_receipts.external_transaction_id IS '支付／退款业务号；来源：支付平台业务号；证据：映射待确认';


--
-- Name: hz_fop_reconciliation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_reconciliation_runs (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) NOT NULL,
    segment_start character varying(160),
    segment_end character varying(160),
    source_scope_version character varying(160),
    source_count bigint,
    local_count bigint,
    difference_count bigint,
    state character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hz_fop_reconciliation_runs_result_shape CHECK ((jsonb_typeof(result) = 'object'::text)),
    CONSTRAINT ck_hz_fop_reconciliation_runs_state CHECK (((state)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'matched'::character varying, 'different'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_reconciliation_runs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_reconciliation_runs IS '源端核对任务；按 ID、版本及来源关系核对，不只比较条数或近期付款订单。';


--
-- Name: COLUMN hz_fop_reconciliation_runs.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_reconciliation_runs.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_reconciliation_runs.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_reconciliation_runs.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_reconciliation_runs.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.entity_code IS '核对实体；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_reconciliation_runs.segment_start; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.segment_start IS '稳定分段起点；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_reconciliation_runs.segment_end; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.segment_end IS '稳定分段终点；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_reconciliation_runs.source_scope_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.source_scope_version IS '核对范围版本；来源：核对契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_reconciliation_runs.source_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.source_count IS '源记录数；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_reconciliation_runs.local_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.local_count IS '本地记录数；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_reconciliation_runs.difference_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.difference_count IS 'ID／版本／关系差异数；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_reconciliation_runs.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.state IS '状态；来源：本地设计；选项：pending, running, matched, different, failed；证据：本地设计';


--
-- Name: COLUMN hz_fop_reconciliation_runs.started_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.started_at IS '开始；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_reconciliation_runs.finished_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.finished_at IS '结束；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_reconciliation_runs.result; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.result IS '差异摘要；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_reconciliation_runs.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.created_at IS '本地首次登记；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_reconciliation_runs.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reconciliation_runs.updated_at IS '本地最近更新；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: hz_fop_reference_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_reference_items (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    resource_type character varying(64) NOT NULL,
    source_id character varying(128) NOT NULL,
    master_id character varying(128),
    code character varying(160),
    name text,
    parent_source_id character varying(128),
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_version numeric(30,0),
    source_modified_at timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ck_hz_fop_reference_items_attributes_shape CHECK ((jsonb_typeof(attributes) = 'object'::text)),
    CONSTRAINT ck_hz_fop_reference_items_resource_type CHECK (((resource_type)::text = ANY ((ARRAY['customer'::character varying, 'supplier'::character varying, 'sku'::character varying, 'store'::character varying, 'warehouse'::character varying, 'logistics_provider'::character varying, 'actual_channel'::character varying, 'currency'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_reference_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_reference_items IS '来源基础资料索引；缓存必要资料及实际物流渠道搜索，不复制 FOP 组织为本地组织。；渠道搜索按服务商、编码、名称；中文包含搜索按实测评估 pg_trgm，首期不假设扩展已安装。；联系人、地址等只同步获批必要内容；历史单据快照与当前资料分开。';


--
-- Name: COLUMN hz_fop_reference_items.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reference_items.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_reference_items.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reference_items.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_reference_items.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reference_items.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_reference_items.resource_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reference_items.resource_type IS '资料种类；来源：本地设计；customer,supplier,sku,store,warehouse,logistics_provider,actual_channel,currency；证据：本地设计';


--
-- Name: COLUMN hz_fop_reference_items.source_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reference_items.source_id IS '资料内码；来源：目录／业务引用；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_reference_items.master_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reference_items.master_id IS '主数据内码；来源：目录／业务引用；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_reference_items.code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reference_items.code IS '编码；来源：number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_reference_items.name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reference_items.name IS '名称；来源：name；证据：映射待确认';


--
-- Name: COLUMN hz_fop_reference_items.parent_source_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reference_items.parent_source_id IS '所属服务商／父项；来源：资料目录；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_reference_items.attributes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reference_items.attributes IS '已确认资料属性；来源：目录／业务引用；；仅保留版本化字段白名单内的必要补充证据，不整包存储API原文、不复制未使用FOP字段、不重复存已规范化列；禁止密钥与Token；证据：映射待确认';


--
-- Name: COLUMN hz_fop_reference_items.source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reference_items.source_version IS '资料可靠版本；来源：待新增增量契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_reference_items.source_modified_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reference_items.source_modified_at IS '源修改时间；来源：modifytime；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_reference_items.synced_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reference_items.synced_at IS '最近接收时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_reference_items.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_reference_items.deleted_at IS '删除标记；来源：待新增删除契约；存 UTC；业务日期按 UTC+8 解释；证据：待补契约';


--
-- Name: hz_fop_refresh_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_refresh_requests (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    actor_account_id uuid NOT NULL,
    sync_run_id uuid,
    request_key character varying(160) NOT NULL,
    requested_scope jsonb DEFAULT '{}'::jsonb NOT NULL,
    target_watermarks jsonb DEFAULT '{}'::jsonb NOT NULL,
    state character varying(40) DEFAULT 'pending_barrier'::character varying NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    error_code character varying(100),
    barrier_id uuid,
    CONSTRAINT ck_hz_fop_refresh_requests_requested_scope_shape CHECK ((jsonb_typeof(requested_scope) = 'object'::text)),
    CONSTRAINT ck_hz_fop_refresh_requests_state CHECK (((state)::text = ANY ((ARRAY['pending_barrier'::character varying, 'syncing'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'scope_changed'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_refresh_requests_target_watermarks_shape CHECK ((jsonb_typeof(target_watermarks) = 'object'::text))
);


--
-- Name: TABLE hz_fop_refresh_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_refresh_requests IS '用户刷新请求与目标；合并同步任务但保留各请求自己的提交屏障和授权范围。；成功要求本请求全部来源采集覆盖、发布及应用达标；旧流头不算本次追平。；结果返回及页面重查时复验当前权限，不将同步日志暴露为全公司明细。；手工同步覆盖新增、修改、删除、状态退回、关联解除及归属变化；重算旧/新受影响订单，包含移出当前清单或失去当前账号权限的记录。不能只回读当前页或当前订单ID集合；返回结果按最新权限复验。';


--
-- Name: COLUMN hz_fop_refresh_requests.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_refresh_requests.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_refresh_requests.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_refresh_requests.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_refresh_requests.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_refresh_requests.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_refresh_requests.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_refresh_requests.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_refresh_requests.actor_account_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_refresh_requests.actor_account_id IS '请求账号；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_refresh_requests.sync_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_refresh_requests.sync_run_id IS '合并到执行批次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_refresh_requests.request_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_refresh_requests.request_key IS '请求幂等键；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_refresh_requests.requested_scope; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_refresh_requests.requested_scope IS '请求范围与权限版本；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_refresh_requests.target_watermarks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_refresh_requests.target_watermarks IS '本请求源提交屏障目标；来源：屏障契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_refresh_requests.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_refresh_requests.state IS '刷新状态；来源：本地设计；选项：pending_barrier, syncing, succeeded, failed, scope_changed, cancelled；证据：本地设计';


--
-- Name: COLUMN hz_fop_refresh_requests.requested_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_refresh_requests.requested_at IS '请求时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_refresh_requests.finished_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_refresh_requests.finished_at IS '结束时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_refresh_requests.error_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_refresh_requests.error_code IS '结果码；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_refresh_requests.barrier_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_refresh_requests.barrier_id IS '本请求源屏障；来源：本地设计；证据：本地设计';


--
-- Name: hz_fop_relation_dirty_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_relation_dirty_sources (
    batch_id uuid NOT NULL,
    entity_code text NOT NULL,
    source_id text NOT NULL
);


--
-- Name: hz_fop_relation_refresh; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_relation_refresh (
    batch_id uuid NOT NULL,
    root_kind text NOT NULL,
    root_id text NOT NULL,
    root_number text NOT NULL,
    requested_version bigint DEFAULT 1 NOT NULL,
    published_version bigint DEFAULT 0 NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    checked_at timestamp with time zone,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hz_fop_relation_refresh_root_kind_check CHECK ((root_kind = ANY (ARRAY['fulfillment'::text, 'stock'::text])))
);


--
-- Name: hz_fop_resource_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_resource_grants (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    resource_type character varying(64) NOT NULL,
    target_key character varying(160) NOT NULL,
    decision character varying(40) DEFAULT 'deny'::character varying NOT NULL,
    grant_version character varying(160),
    verified_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_as_of timestamp with time zone,
    CONSTRAINT ck_hz_fop_resource_grants_decision CHECK (((decision)::text = ANY ((ARRAY['allow'::character varying, 'deny'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_resource_grants_evidence_shape CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT ck_hz_fop_resource_grants_resource_type CHECK (((resource_type)::text = ANY ((ARRAY['orders'::character varying, 'stock_orders'::character varying, 'purchases'::character varying, 'rma'::character varying, 'purchase_returns'::character varying, 'stock_inventory'::character varying, 'allocation_inventory'::character varying, 'contacts'::character varying, 'channels'::character varying, 'receipt_notices'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_resource_grants; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_resource_grants IS '集成账号资源授权快照；保存服务集成身份的独立公司／资源边界；员工范围仍按本地当前组织计算。；缺少／拒绝／过期均不授权；RMA、库存、退货及联系人不从订单可见性推导。；不复制 FOP 全员权限体系；本地角色及停用每次请求重新读取。；普通读取采用至多60秒的授权／归属核验窗口（设计目标）；若采集覆盖或核验无法证明该窗口，阻断相关资源。导出交付、审核及联系人敏感操作须实时回源证明。；对象明确 deny 优先于资源 * allow；对象无独立记录时才继承已验证且未过期的 * 授权。任何适用 deny 或范围版本失效均拒绝，不用其他资源的 allow 兜底。';


--
-- Name: COLUMN hz_fop_resource_grants.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_resource_grants.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_resource_grants.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_resource_grants.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_resource_grants.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_resource_grants.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_resource_grants.resource_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_resource_grants.resource_type IS '资源类型；来源：本地设计；orders,stock_orders,purchases,rma,purchase_returns,stock_inventory,allocation_inventory,contacts,channels；证据：本地设计';


--
-- Name: COLUMN hz_fop_resource_grants.target_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_resource_grants.target_key IS '源对象 ID 或 *；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_resource_grants.decision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_resource_grants.decision IS '授权结果；来源：本地设计；选项：allow, deny；证据：本地设计';


--
-- Name: COLUMN hz_fop_resource_grants.grant_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_resource_grants.grant_version IS '源授权版本；来源：授权契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_resource_grants.verified_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_resource_grants.verified_at IS '最近实时核验；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_resource_grants.expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_resource_grants.expires_at IS '有效截止；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_resource_grants.evidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_resource_grants.evidence IS '授权依据；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_resource_grants.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_resource_grants.created_at IS '本地首次登记；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_resource_grants.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_resource_grants.updated_at IS '本地最近更新；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_resource_grants.source_as_of; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_resource_grants.source_as_of IS '授权证明源端截至；来源：授权契约；存 UTC；业务日期按 UTC+8 解释；证据：契约／规则待逐项核验';


--
-- Name: hz_fop_return_line_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_return_line_details (
    line_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    source_order_entry_id character varying(128),
    purchase_entry_id character varying(128),
    requested_quantity numeric(24,8),
    returned_quantity numeric(24,8),
    requested_amount numeric(28,8),
    refunded_amount numeric(28,8),
    currency_code character varying(3)
);


--
-- Name: TABLE hz_fop_return_line_details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_return_line_details IS '售后／采购退货分录扩展；来源分录的领域字段扩展；适用 RMA、采购退货；通过 source_lines.document_id 追溯类型头表；公司和实体类型必须匹配。；客户整单售后与采购订单部分退货分别建模；不能把客户退款金额当供应商退款。';


--
-- Name: COLUMN hz_fop_return_line_details.line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_return_line_details.line_id IS '分录登记主键；来源：本地设计；PK／FK→source_lines.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_return_line_details.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_return_line_details.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_return_line_details.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_return_line_details.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_return_line_details.source_order_entry_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_return_line_details.source_order_entry_id IS '业务来源行 ID；来源：hzkj_srcbillentryid；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_return_line_details.purchase_entry_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_return_line_details.purchase_entry_id IS '采购来源行 ID；来源：实际来源行；FOP ID／外部编号按字符串保存，不能转 JS number；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_return_line_details.requested_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_return_line_details.requested_quantity IS '申请数量；来源：申请数量；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_return_line_details.returned_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_return_line_details.returned_quantity IS '已实物退回数量；来源：实物退回事实；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_return_line_details.requested_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_return_line_details.requested_amount IS '申请退款；来源：申请行金额；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_return_line_details.refunded_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_return_line_details.refunded_amount IS '已退款；来源：实际行退款；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_return_line_details.currency_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_return_line_details.currency_code IS '退款币种；来源：明确退款币种；证据：契约／规则待逐项核验';


--
-- Name: hz_fop_rma_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_rma_orders (
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) DEFAULT 'hzkj_after_sale_orders'::character varying NOT NULL,
    source_document_number character varying(160),
    after_sale_type character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    raw_flow_status character varying(64),
    is_open boolean,
    reason text,
    requested_amount numeric(28,8),
    requested_currency character varying(3),
    refund_amount numeric(28,8),
    refund_currency character varying(3),
    customer_id character varying(128),
    store_id character varying(128),
    CONSTRAINT ck_hz_fop_rma_orders_after_sale_type CHECK (((after_sale_type)::text = ANY ((ARRAY['refund'::character varying, 'return_refund'::character varying, 'reshipment'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_rma_orders_entity_code CHECK (((entity_code)::text = 'hzkj_after_sale_orders'::text))
);


--
-- Name: TABLE hz_fop_rma_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_rma_orders IS 'RMA 售后单；保存 RMA 售后单 的必要真实业务事实。；仅接收 entity_code=hzkj_after_sale_orders 的来源登记；同一源单快照、分录及关系在同一事务应用。；映射 A=退货退款、B=仅退款、C=补发货；1/2 进行中，0/3/4/5/6 已结束；历史空状态保留未知。；当前 API 的状态描述与源码冲突，以已核对映射为准；缺少退款币种不从订单或本位币兜底。；不对同一履约订单设唯一 RMA；保留多单、历史及部分退款。进行中仅退款与退货退款／补发货互斥由事务内规则检查，不能普通 CHECK 跨表实现。';


--
-- Name: COLUMN hz_fop_rma_orders.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_rma_orders.document_id IS '来源登记主键；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_rma_orders.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_rma_orders.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_rma_orders.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_rma_orders.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_rma_orders.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_rma_orders.entity_code IS '固定来源实体；来源：本地设计；CHECK entity_code = hzkj_after_sale_orders；证据：本地设计';


--
-- Name: COLUMN hz_fop_rma_orders.source_document_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_rma_orders.source_document_number IS '原履约／备货单号；来源：hzkj_srcnumber；证据：接口文档';


--
-- Name: COLUMN hz_fop_rma_orders.after_sale_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_rma_orders.after_sale_type IS '售后类型；来源：hzkj_sales_type；选项：refund, return_refund, reshipment, unknown；证据：接口文档';


--
-- Name: COLUMN hz_fop_rma_orders.raw_flow_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_rma_orders.raw_flow_status IS '原始售后流程状态；来源：hzkj_orderstatus；证据：接口文档';


--
-- Name: COLUMN hz_fop_rma_orders.is_open; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_rma_orders.is_open IS '流程是否进行中；来源：原生状态映射；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_rma_orders.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_rma_orders.reason IS '售后原因；来源：hzkj_resason1；证据：接口文档';


--
-- Name: COLUMN hz_fop_rma_orders.requested_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_rma_orders.requested_amount IS '申请金额；来源：实际申请金额字段；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_rma_orders.requested_currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_rma_orders.requested_currency IS '申请币种；来源：明确申请币种；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_rma_orders.refund_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_rma_orders.refund_amount IS '实际返回退款金额；来源：hzkj_refund_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_rma_orders.refund_currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_rma_orders.refund_currency IS '退款结算币种；来源：hzkj_tocurr.number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_rma_orders.customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_rma_orders.customer_id IS '客户；来源：客户；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_rma_orders.store_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_rma_orders.store_id IS '店铺；来源：hzkj_shop.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: hz_fop_source_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_source_documents (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) NOT NULL,
    source_id character varying(128) NOT NULL,
    document_number character varying(160),
    source_version numeric(30,0),
    raw_bill_status character varying(64),
    source_created_at timestamp with time zone,
    source_modified_at timestamp with time zone,
    source_audited_at timestamp with time zone,
    source_committed_at timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    validation_state character varying(40) DEFAULT 'unverified'::character varying NOT NULL,
    payload_hash character varying(64),
    payload jsonb,
    mapping_version integer DEFAULT 1 NOT NULL,
    relation_revision bigint DEFAULT 0 NOT NULL,
    CONSTRAINT ck_hz_fop_source_documents_validation_state CHECK (((validation_state)::text = ANY ((ARRAY['unverified'::character varying, 'incomplete'::character varying, 'verified'::character varying, 'deleted'::character varying, 'conflict'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_source_documents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_source_documents IS '来源单据身份与版本登记；各类单据共用唯一身份及版本，类型头表以 document_id 扩展；解决跨单据外键、删除和溯源。；typed header 的 company_id＋document_id＋固定实体编码与此表复合关联；不把单号当唯一主键。；可靠增量发布必须有已验证 source_version；无版本的现有 API 仅进入 unverified 初始事实，不能冒充可靠增量。；删除为 tombstone，保留版本及旧关系至恢复窗口结束；禁止从最大本地序列推源端水位。';


--
-- Name: COLUMN hz_fop_source_documents.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_documents.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_documents.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_documents.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_documents.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.entity_code IS 'FOP 实体编码；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_documents.source_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.source_id IS '源单内部 ID；来源：id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_source_documents.document_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.document_number IS '真实单号；来源：billno；证据：接口文档';


--
-- Name: COLUMN hz_fop_source_documents.source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.source_version IS '可靠单据版本；来源：待新增增量契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_source_documents.raw_bill_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.raw_bill_status IS '原生单据状态；来源：billstatus；证据：接口文档';


--
-- Name: COLUMN hz_fop_source_documents.source_created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.source_created_at IS '源创建时间；来源：createtime；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_source_documents.source_modified_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.source_modified_at IS '源修改时间；来源：modifytime；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_source_documents.source_audited_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.source_audited_at IS '源审核时间；来源：auditdate；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_source_documents.source_committed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.source_committed_at IS '源提交时间；来源：待新增增量契约；存 UTC；业务日期按 UTC+8 解释；证据：待补契约';


--
-- Name: COLUMN hz_fop_source_documents.synced_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.synced_at IS '完整快照接收时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_documents.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.deleted_at IS '源物理删除时间；来源：待新增删除契约；存 UTC；业务日期按 UTC+8 解释；证据：待补契约';


--
-- Name: COLUMN hz_fop_source_documents.validation_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.validation_state IS '事实完整性；来源：本地设计；选项：unverified, incomplete, verified, deleted, conflict；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_documents.payload_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.payload_hash IS '规范载荷摘要；来源：本地设计；仅检测重复／核对；不能替代 FOP 审核版本；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_documents.payload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.payload IS '必要原始快照；来源：原始 API；；仅保留版本化字段白名单内的必要补充证据，不整包存储API原文、不复制未使用FOP字段、不重复存已规范化列；禁止密钥与Token；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_source_documents.mapping_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.mapping_version IS '字段映射版本；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_documents.relation_revision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_documents.relation_revision IS '本单完整关系快照修订；来源：本地设计；在事实应用事务中锁单据后递增；记录旧／新关系集变化供投影依赖验证；证据：本地设计';


--
-- Name: hz_fop_source_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_source_lines (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    document_id uuid NOT NULL,
    entry_entity character varying(128) NOT NULL,
    source_entry_id character varying(128) NOT NULL,
    parent_line_id uuid,
    sequence integer,
    row_type character varying(64),
    sku_source_id character varying(128),
    sku_master_id character varying(128),
    sku_code character varying(160),
    product_name text,
    variant text,
    image_url text,
    quantity numeric(24,8),
    unit_code character varying(64),
    unit_price numeric(28,8),
    line_amount numeric(28,8),
    currency_code character varying(3),
    raw_status character varying(64),
    source_version numeric(30,0),
    removed_at timestamp with time zone,
    payload jsonb
);


--
-- Name: TABLE hz_fop_source_lines; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_source_lines IS '来源完整分录登记；统一分录身份，保留 BOM 父子、源行及所有商品；领域分录表补充特有业务字段。；复合 FK(company_id,document_id)→source_documents；父行 FK(document_id,parent_line_id) 限同单据并可延迟校验。；缺真实分录 ID 时保留为待补原始快照，不用行号、SKU 或数组下标伪造稳定身份。；完整快照缺失旧行时标记 removed_at，同事务失效旧来源关系；不直接抹掉核对证据。；完整商品分录指该来源单据全部有效商品行（含一单多品、BOM父子及必要归包信息），不是仅命中搜索SKU的行，也不是复制FOP所有物理分录列。按实体、document_id、entry_entity、source_entry_id定位，六类领域扩展不混用来源语义。';


--
-- Name: COLUMN hz_fop_source_lines.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_lines.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_lines.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_lines.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_lines.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.document_id IS '所属来源单据；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_lines.entry_entity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.entry_entity IS '分录实体编码；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_lines.source_entry_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.source_entry_id IS '源分录 ID；来源：分录.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_source_lines.parent_line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.parent_line_id IS '父／组合商品分录；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_source_lines.sequence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.sequence IS '源行序号；来源：seq；证据：映射待确认';


--
-- Name: COLUMN hz_fop_source_lines.row_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.row_type IS '原生父子行类型；来源：rowtype；证据：映射待确认';


--
-- Name: COLUMN hz_fop_source_lines.sku_source_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.sku_source_id IS 'SKU 内码；来源：SKU.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_source_lines.sku_master_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.sku_master_id IS 'SKU 主数据内码；来源：SKU.masterid；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_source_lines.sku_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.sku_code IS 'SKU 编码；来源：SKU.number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_source_lines.product_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.product_name IS '商品名称；来源：SKU.name；证据：映射待确认';


--
-- Name: COLUMN hz_fop_source_lines.variant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.variant IS '规格属性；来源：SKU属性；证据：映射待确认';


--
-- Name: COLUMN hz_fop_source_lines.image_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.image_url IS '商品图片引用；来源：SKU图片字段；证据：映射待确认';


--
-- Name: COLUMN hz_fop_source_lines.quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.quantity IS '原生行数量；来源：数量；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_source_lines.unit_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.unit_code IS '原单位；来源：单位；证据：映射待确认';


--
-- Name: COLUMN hz_fop_source_lines.unit_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.unit_price IS '原生单价；来源：单价；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_source_lines.line_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.line_amount IS '原生分录金额；来源：分录金额；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：映射待确认';


--
-- Name: COLUMN hz_fop_source_lines.currency_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.currency_code IS '已核实结算币种；来源：币种映射；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_source_lines.raw_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.raw_status IS '原生行状态；来源：分录状态；证据：映射待确认';


--
-- Name: COLUMN hz_fop_source_lines.source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.source_version IS '所属单据版本；来源：待新增增量契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_source_lines.removed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.removed_at IS '分录从完整快照移除；来源：完整分录替换；存 UTC；业务日期按 UTC+8 解释；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_source_lines.payload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_source_lines.payload IS '必要原始分录；来源：原始 API；；仅保留版本化字段白名单内的必要补充证据，不整包存储API原文、不复制未使用FOP字段、不重复存已规范化列；禁止密钥与Token；证据：契约／规则待逐项核验';


--
-- Name: hz_fop_stock_consumptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_stock_consumptions (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    stock_document_id uuid NOT NULL,
    stock_line_id uuid NOT NULL,
    order_document_id uuid NOT NULL,
    order_line_id uuid NOT NULL,
    source_consumption_id character varying(128) NOT NULL,
    quantity numeric(24,8),
    used_at timestamp with time zone,
    raw_status character varying(64),
    source_version numeric(30,0),
    removed_at timestamp with time zone
);


--
-- Name: TABLE hz_fop_stock_consumptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_stock_consumptions IS '全款／押金备货耗用；区分备货库存权益及履约免付产品款，支持撤销耗用同步。';


--
-- Name: COLUMN hz_fop_stock_consumptions.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_consumptions.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_stock_consumptions.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_consumptions.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_stock_consumptions.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_consumptions.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_stock_consumptions.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_consumptions.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_stock_consumptions.stock_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_consumptions.stock_document_id IS '备货单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_stock_consumptions.stock_line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_consumptions.stock_line_id IS '备货分录；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_stock_consumptions.order_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_consumptions.order_document_id IS '履约单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_stock_consumptions.order_line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_consumptions.order_line_id IS '履约商品行；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_stock_consumptions.source_consumption_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_consumptions.source_consumption_id IS '源耗用记录 ID；来源：hzkj_sale_order_use.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_stock_consumptions.quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_consumptions.quantity IS '耗用数量；来源：实际耗用数量；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_stock_consumptions.used_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_consumptions.used_at IS '耗用时间；来源：hzkj_use_time；存 UTC；业务日期按 UTC+8 解释；证据：映射待确认';


--
-- Name: COLUMN hz_fop_stock_consumptions.raw_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_consumptions.raw_status IS '耗用状态；来源：hzkj_use_status；证据：映射待确认';


--
-- Name: COLUMN hz_fop_stock_consumptions.source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_consumptions.source_version IS '耗用持有方版本；来源：待新增增量契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_stock_consumptions.removed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_consumptions.removed_at IS '取消／回退；来源：实际耗用解除；存 UTC；业务日期按 UTC+8 解释；证据：契约／规则待逐项核验';


--
-- Name: hz_fop_stock_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_stock_orders (
    document_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    entity_code character varying(128) DEFAULT 'hzkj_stock_order_new'::character varying NOT NULL,
    customer_id character varying(128),
    paying_customer_id character varying(128),
    receiving_customer_id character varying(128),
    owner_employee_id character varying(128),
    store_id character varying(128),
    raw_order_status character varying(64),
    raw_payment_status character varying(64),
    customer_paid_at timestamp with time zone,
    settlement_currency character varying(3),
    raw_purchase_status character varying(64),
    warehouse_id character varying(128),
    stock_type character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    business_created_at timestamp with time zone,
    total_amount numeric(28,8),
    receivable_amount numeric(28,8),
    received_amount numeric(28,8),
    deposit_amount numeric(28,8),
    raw_refund_status character varying(64),
    procurement_paid_at timestamp with time zone,
    CONSTRAINT ck_hz_fop_stock_orders_entity_code CHECK (((entity_code)::text = 'hzkj_stock_order_new'::text)),
    CONSTRAINT ck_hz_fop_stock_orders_stock_type CHECK (((stock_type)::text = ANY ((ARRAY['full_payment'::character varying, 'deposit'::character varying, 'unknown'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_stock_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_stock_orders IS '备货订单；保存 备货订单 的必要真实业务事实。；仅接收 entity_code=hzkj_stock_order_new 的来源登记；同一源单快照、分录及关系在同一事务应用。；不因列表去掉店铺列而删除真实来源店铺；前端展示与事实存储分开。；备货默认创建时间倒序；时间范围按本单客户付款日期；待支付使用全部范围时可见。';


--
-- Name: COLUMN hz_fop_stock_orders.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.document_id IS '来源登记主键；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_stock_orders.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_stock_orders.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_stock_orders.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.entity_code IS '固定来源实体；来源：本地设计；CHECK entity_code = hzkj_stock_order_new；证据：本地设计';


--
-- Name: COLUMN hz_fop_stock_orders.customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.customer_id IS '订货客户；来源：hzkj_customer.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_stock_orders.paying_customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.paying_customer_id IS '付款客户；来源：hzkj_payingcustomer.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_stock_orders.receiving_customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.receiving_customer_id IS '收货客户；来源：hzkj_reccustomer.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_stock_orders.owner_employee_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.owner_employee_id IS '源业务员；来源：hzkj_operator.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_stock_orders.store_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.store_id IS '店铺；来源：hzkj_shop.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_stock_orders.raw_order_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.raw_order_status IS '原生订单状态；来源：hzkj_orderstatus；证据：接口文档';


--
-- Name: COLUMN hz_fop_stock_orders.raw_payment_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.raw_payment_status IS '原生收款状态；来源：hzkj_receipt_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_stock_orders.customer_paid_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.customer_paid_at IS '客户向 FOP 付款时间；来源：hzkj_receipt_date；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_stock_orders.settlement_currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.settlement_currency IS '结算币种；来源：hzkj_settlecurrency.number；证据：源码元数据';


--
-- Name: COLUMN hz_fop_stock_orders.raw_purchase_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.raw_purchase_status IS '原生采购状态；来源：hzkj_purchase_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_stock_orders.warehouse_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.warehouse_id IS '备货收货仓库；来源：hzkj_warehouse.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：接口文档';


--
-- Name: COLUMN hz_fop_stock_orders.stock_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.stock_type IS '备货类型；来源：已核实类型映射；选项：full_payment, deposit, unknown；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_stock_orders.business_created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.business_created_at IS '备货创建日期；来源：hzkj_bizdate；存 UTC；业务日期按 UTC+8 解释；证据：接口文档';


--
-- Name: COLUMN hz_fop_stock_orders.total_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.total_amount IS '备货订单金额；来源：hzkj_order_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_stock_orders.receivable_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.receivable_amount IS '应收金额；来源：hzkj_vable_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_stock_orders.received_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.received_amount IS '已收金额；来源：hzkj_receive_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_stock_orders.deposit_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.deposit_amount IS '押金金额；来源：hzkj_margin_amount；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：接口文档';


--
-- Name: COLUMN hz_fop_stock_orders.raw_refund_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.raw_refund_status IS '退款状态；来源：hzkj_refund_status；证据：接口文档';


--
-- Name: COLUMN hz_fop_stock_orders.procurement_paid_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_stock_orders.procurement_paid_at IS '备货订单采购付款时间，供明确使用该库存的履约订单引用；具体源字段待确认';


--
-- Name: hz_fop_sync_barriers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_sync_barriers (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    sync_run_id uuid,
    source_barrier_id character varying(128) NOT NULL,
    purpose character varying(40) NOT NULL,
    scope_version character varying(160) NOT NULL,
    target_vector jsonb DEFAULT '{}'::jsonb NOT NULL,
    capture_proof jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_as_of timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    state character varying(40) DEFAULT 'issued'::character varying NOT NULL,
    satisfied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hz_fop_sync_barriers_capture_proof_shape CHECK ((jsonb_typeof(capture_proof) = 'object'::text)),
    CONSTRAINT ck_hz_fop_sync_barriers_purpose CHECK (((purpose)::text = ANY ((ARRAY['bootstrap_start'::character varying, 'bootstrap_cutover'::character varying, 'manual_refresh'::character varying, 'authorization'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_sync_barriers_state CHECK (((state)::text = ANY ((ARRAY['issued'::character varying, 'catching_up'::character varying, 'satisfied'::character varying, 'expired'::character varying, 'invalid'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_sync_barriers_target_vector_shape CHECK ((jsonb_typeof(target_vector) = 'object'::text))
);


--
-- Name: TABLE hz_fop_sync_barriers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_sync_barriers IS '源同步屏障与覆盖证明；持久保存初始化及每次手工刷新目标；不能用本地旧流头替代本次源采集覆盖。；公司业务流屏障必须落在完整提交组边界；独立库存／授权流分别证明采集与应用覆盖。；初始化全量与C0需源一致快照，或可证明同等一致性的版本化分页及回放协议；普通可变分页不能提供该保证。';


--
-- Name: COLUMN hz_fop_sync_barriers.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_barriers.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_barriers.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_barriers.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_barriers.sync_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.sync_run_id IS '相关执行批次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_barriers.source_barrier_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.source_barrier_id IS '源屏障 ID；来源：待新增屏障契约；FOP ID／外部编号按字符串保存，不能转 JS number；证据：待补契约';


--
-- Name: COLUMN hz_fop_sync_barriers.purpose; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.purpose IS '用途；来源：本地设计；选项：bootstrap_start, bootstrap_cutover, manual_refresh, authorization；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_barriers.scope_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.scope_version IS '源范围版本；来源：待新增屏障契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_sync_barriers.target_vector; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.target_vector IS '各流需覆盖的结束边界；来源：待新增屏障契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_sync_barriers.capture_proof; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.capture_proof IS '采集已覆盖事务提交的证明；来源：待新增屏障契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_sync_barriers.source_as_of; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.source_as_of IS '源端屏障截至时间；来源：待新增屏障契约；存 UTC；业务日期按 UTC+8 解释；证据：待补契约';


--
-- Name: COLUMN hz_fop_sync_barriers.expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.expires_at IS '证明及续传保留截止；来源：待新增屏障契约；存 UTC；业务日期按 UTC+8 解释；证据：待补契约';


--
-- Name: COLUMN hz_fop_sync_barriers.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.state IS '屏障状态；来源：本地设计；选项：issued, catching_up, satisfied, expired, invalid；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_barriers.satisfied_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.satisfied_at IS '所有要求应用完成；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_barriers.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.created_at IS '本地首次登记；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_barriers.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_barriers.updated_at IS '本地最近更新；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: hz_fop_sync_commit_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_sync_commit_groups (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    stream_id uuid NOT NULL,
    source_group_key character varying(160) NOT NULL,
    expected_event_count integer NOT NULL,
    member_manifest jsonb DEFAULT '[]'::jsonb NOT NULL,
    manifest_hash character varying(64) NOT NULL,
    end_cursor text NOT NULL,
    state character varying(40) DEFAULT 'receiving'::character varying NOT NULL,
    source_committed_at timestamp with time zone NOT NULL,
    applied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hz_fop_sync_commit_groups_member_manifest_shape CHECK ((jsonb_typeof(member_manifest) = 'array'::text)),
    CONSTRAINT ck_hz_fop_sync_commit_groups_state CHECK (((state)::text = ANY ((ARRAY['receiving'::character varying, 'complete'::character varying, 'applying'::character varying, 'waiting_projection'::character varying, 'applied'::character varying, 'conflict'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_sync_commit_groups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_sync_commit_groups IS '源事务提交组；V1 采用每公司一个有序业务提交流；同一事务所有单据事件完整成组，禁止跨业务流拆组。；组清单、数量、摘要和结束边界匹配后才应用；头、分录、关系及完成义务同事务写入。成员丢失或同键不同清单阻塞水位。；库存和授权可有独立资源流，使用各自屏障及版本，不宣称与公司业务流具备跨流原子快照；未来跨业务流事务需升级协议后才能接入。';


--
-- Name: COLUMN hz_fop_sync_commit_groups.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_commit_groups.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_commit_groups.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_commit_groups.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_commit_groups.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_commit_groups.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_commit_groups.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_commit_groups.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_commit_groups.stream_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_commit_groups.stream_id IS '公司业务提交流；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_commit_groups.source_group_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_commit_groups.source_group_key IS '不可变源事务组键；来源：待新增提交组契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_sync_commit_groups.expected_event_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_commit_groups.expected_event_count IS '完整成员数量；来源：待新增提交组契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_sync_commit_groups.member_manifest; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_commit_groups.member_manifest IS '完整事件ID与单据版本清单；来源：待新增提交组契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_sync_commit_groups.manifest_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_commit_groups.manifest_hash IS '清单摘要；来源：待新增提交组契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_sync_commit_groups.end_cursor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_commit_groups.end_cursor IS '事务组结束游标；来源：待新增提交组契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_sync_commit_groups.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_commit_groups.state IS '组状态；来源：本地设计；选项：receiving, complete, applying, waiting_projection, applied, conflict, failed；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_commit_groups.source_committed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_commit_groups.source_committed_at IS '源事务提交；来源：待新增提交组契约；存 UTC；业务日期按 UTC+8 解释；证据：待补契约';


--
-- Name: COLUMN hz_fop_sync_commit_groups.applied_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_commit_groups.applied_at IS '全组应用完成；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_commit_groups.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_commit_groups.created_at IS '本地首次登记；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_commit_groups.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_commit_groups.updated_at IS '本地最近更新；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: hz_fop_sync_event_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_sync_event_requirements (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    event_id uuid NOT NULL,
    task_id uuid,
    order_document_id uuid,
    target_kind character varying(40) NOT NULL,
    target_key character varying(240) NOT NULL,
    required_versions jsonb DEFAULT '{}'::jsonb NOT NULL,
    state character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    satisfied_revision bigint,
    satisfied_at timestamp with time zone,
    reason_code character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hz_fop_sync_event_requirements_required_versions_shape CHECK ((jsonb_typeof(required_versions) = 'object'::text)),
    CONSTRAINT ck_hz_fop_sync_event_requirements_state CHECK (((state)::text = ANY ((ARRAY['pending'::character varying, 'satisfied'::character varying, 'blocked'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_sync_event_requirements_target_kind CHECK (((target_kind)::text = ANY ((ARRAY['fact'::character varying, 'order_projection'::character varying, 'resource_scope'::character varying, 'inventory'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_sync_event_requirements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_sync_event_requirements IS '事件应用与投影完成义务；事件到全部受影响目标的持久边；任务合并不丢各事件的完成条件。；替换关系前取得旧受影响订单，与新关系集合取并集；事实、旧／新关系、全部 requirements 和任务唤醒在同一数据库事务提交，失败整体回滚。；投影发布与对应义务 satisfied 同事务；每个事件全部义务满足、全组全部事件完成才可推进连续 applied_cursor。；删除后原订单仍以 tombstone 身份完成移出队列义务；非订单目标 order_document_id 可空。多源版本用受验证向量比较，不能只比较某一个采购单版本。';


--
-- Name: COLUMN hz_fop_sync_event_requirements.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_event_requirements.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_event_requirements.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_event_requirements.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_event_requirements.event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.event_id IS '触发事件；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_event_requirements.task_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.task_id IS '可合并执行任务；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_event_requirements.order_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.order_document_id IS '受影响订单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_event_requirements.target_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.target_kind IS '完成目标类型；来源：本地设计；fact,order_projection,resource_scope,inventory；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_event_requirements.target_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.target_key IS '目标稳定来源键；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_event_requirements.required_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.required_versions IS '必须覆盖的来源版本与关系修订；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_event_requirements.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.state IS '完成义务状态；来源：本地设计；选项：pending, satisfied, blocked；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_event_requirements.satisfied_revision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.satisfied_revision IS '满足要求的投影修订；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_event_requirements.satisfied_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.satisfied_at IS '满足时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_event_requirements.reason_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.reason_code IS '阻塞原因；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_event_requirements.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.created_at IS '本地首次登记；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_event_requirements.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_event_requirements.updated_at IS '本地最近更新；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: hz_fop_sync_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_sync_events (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    stream_id uuid NOT NULL,
    commit_group_id uuid,
    source_event_id character varying(128) NOT NULL,
    source_cursor text NOT NULL,
    stream_position bigint NOT NULL,
    entity_code character varying(128) NOT NULL,
    source_document_id character varying(128) NOT NULL,
    source_version numeric(30,0) NOT NULL,
    operation character varying(40) NOT NULL,
    change_group_key character varying(160),
    group_end boolean,
    source_committed_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    state character varying(40) DEFAULT 'received'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone,
    payload jsonb,
    last_error_code character varying(100),
    applied_at timestamp with time zone,
    CONSTRAINT ck_hz_fop_sync_events_operation CHECK (((operation)::text = ANY ((ARRAY['upsert'::character varying, 'delete'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_sync_events_state CHECK (((state)::text = ANY ((ARRAY['received'::character varying, 'fetching'::character varying, 'waiting_dependency'::character varying, 'waiting_projection'::character varying, 'applied'::character varying, 'failed'::character varying, 'quarantined'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_sync_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_sync_events IS '持久化事件收件箱；源事件至少一次投递，本地唯一键去重；无可靠必填字段的响应进问题表，不能推进游标。；整页事件写入与 received_cursor 同事务；applied_cursor 连续推进。；同 ID 不同载荷进入 conflict，不默认为重复成功；未完成变更组禁止发布完成结论。；公司业务流必须有关联 commit_group_id；独立库存／授权资源流可无业务组但必须有自身完整事件边界，不以逐行事件假装跨单事务完整。';


--
-- Name: COLUMN hz_fop_sync_events.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_events.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_events.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_events.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_events.stream_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.stream_id IS '所属同步流；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_events.commit_group_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.commit_group_id IS '源事务提交组；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_events.source_event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.source_event_id IS '源唯一事件 ID；来源：增量契约；FOP ID／外部编号按字符串保存，不能转 JS number；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_events.source_cursor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.source_cursor IS '源续传位置；来源：增量契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_events.stream_position; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.stream_position IS '本地本流接收顺序；来源：本地设计；锁住 stream 后按接收页连续分配；不是源最大 ID；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_events.entity_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.entity_code IS '变化实体；来源：增量契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_events.source_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.source_document_id IS '变化单据 ID；来源：增量契约；FOP ID／外部编号按字符串保存，不能转 JS number；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_events.source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.source_version IS '变化版本；来源：增量契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_events.operation; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.operation IS '操作；来源：增量契约；选项：upsert, delete；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_events.change_group_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.change_group_key IS '同源事务组；来源：变更组契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_events.group_end; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.group_end IS '组结束边界；来源：变更组契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_events.source_committed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.source_committed_at IS '源提交时间；来源：增量契约；存 UTC；业务日期按 UTC+8 解释；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_events.received_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.received_at IS '本地接收；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_events.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.state IS '应用状态；来源：本地设计；选项：received, fetching, waiting_dependency, waiting_projection, applied, failed, quarantined；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_events.attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.attempts IS '处理次数；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_events.next_attempt_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.next_attempt_at IS '下次重试；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_events.payload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.payload IS '必要事件载荷；来源：增量契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_events.last_error_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.last_error_code IS '最近错误码；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_events.applied_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_events.applied_at IS '应用完成；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: hz_fop_sync_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_sync_issues (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    event_id uuid,
    document_id uuid,
    category character varying(64) NOT NULL,
    field_path text,
    error_code character varying(100) NOT NULL,
    message text NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    state character varying(40) DEFAULT 'open'::character varying NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT ck_hz_fop_sync_issues_category CHECK (((category)::text = ANY ((ARRAY['missing_field'::character varying, 'missing_relation'::character varying, 'invalid_version'::character varying, 'conflict'::character varying, 'authorization'::character varying, 'reconciliation'::character varying, 'source_error'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_sync_issues_evidence_shape CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT ck_hz_fop_sync_issues_state CHECK (((state)::text = ANY ((ARRAY['open'::character varying, 'retrying'::character varying, 'resolved'::character varying, 'accepted_gap'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_sync_issues; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_sync_issues IS '同步缺口与差异；字段、关系、权限、版本缺口明确可追踪；不将 accepted_gap 等同事实已完整。';


--
-- Name: COLUMN hz_fop_sync_issues.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_issues.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_issues.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_issues.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_issues.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_issues.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_issues.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_issues.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_issues.event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_issues.event_id IS '相关收件事件；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_issues.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_issues.document_id IS '相关源单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_issues.category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_issues.category IS '问题类别；来源：本地设计；missing_field,missing_relation,invalid_version,conflict,authorization,reconciliation,source_error；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_issues.field_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_issues.field_path IS '缺口字段路径；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_issues.error_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_issues.error_code IS '稳定错误码；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_issues.message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_issues.message IS '简明原因；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_issues.evidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_issues.evidence IS '脱敏技术证据；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_issues.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_issues.state IS '问题状态；来源：本地设计；选项：open, retrying, resolved, accepted_gap；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_issues.first_seen_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_issues.first_seen_at IS '首次发现；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_issues.last_seen_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_issues.last_seen_at IS '最近出现；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_issues.resolved_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_issues.resolved_at IS '解决时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: hz_fop_sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_sync_runs (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    trigger_type character varying(40) NOT NULL,
    state character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    target_watermarks jsonb DEFAULT '{}'::jsonb NOT NULL,
    achieved_watermarks jsonb DEFAULT '{}'::jsonb NOT NULL,
    event_count bigint DEFAULT 0 NOT NULL,
    document_count bigint DEFAULT 0 NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    last_error_code character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    scheduled_for timestamp with time zone,
    CONSTRAINT ck_hz_fop_sync_runs_achieved_watermarks_shape CHECK ((jsonb_typeof(achieved_watermarks) = 'object'::text)),
    CONSTRAINT ck_hz_fop_sync_runs_state CHECK (((state)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'succeeded'::character varying, 'partial'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_sync_runs_target_watermarks_shape CHECK ((jsonb_typeof(target_watermarks) = 'object'::text)),
    CONSTRAINT ck_hz_fop_sync_runs_trigger_type CHECK (((trigger_type)::text = ANY ((ARRAY['bootstrap'::character varying, 'scheduled_morning'::character varying, 'scheduled_business'::character varying, 'scheduled_off_hours'::character varying, 'manual'::character varying, 'navigation'::character varying, 'notification'::character varying, 'reconcile'::character varying, 'post_action'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_sync_runs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_sync_runs IS '同步执行批次；记录多人共用的同步执行，不等同每位用户的刷新结果。；scheduled_for以北京时间计划点转换UTC保存；多实例同一公司/代次/计划点只建一个执行批次。手工请求可合并，保留各自屏障；失败从持久进度继续。';


--
-- Name: COLUMN hz_fop_sync_runs.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_runs.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_runs.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_runs.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_runs.trigger_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.trigger_type IS '触发来源；来源：本地设计；选项：bootstrap, scheduled_morning, scheduled_business, scheduled_off_hours, manual, notification, reconcile, post_action；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_runs.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.state IS '执行状态；来源：本地设计；选项：pending, running, succeeded, partial, failed, cancelled；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_runs.target_watermarks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.target_watermarks IS '各来源目标水位；来源：提交屏障契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_runs.achieved_watermarks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.achieved_watermarks IS '实际应用进度；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_runs.event_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.event_count IS '本次事件数；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_runs.document_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.document_count IS '本次完整单据数；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_runs.started_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.started_at IS '开始时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_runs.finished_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.finished_at IS '结束时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_runs.last_error_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.last_error_code IS '错误码；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_runs.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.created_at IS '本地首次登记；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_runs.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.updated_at IS '本地最近更新；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_runs.scheduled_for; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_runs.scheduled_for IS '本次计划触发时点；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: hz_fop_sync_streams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_sync_streams (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    stream_key character varying(128) NOT NULL,
    mode character varying(40) DEFAULT 'snapshot'::character varying NOT NULL,
    source_scope_version character varying(160),
    schema_version integer DEFAULT 1 NOT NULL,
    received_cursor text,
    applied_cursor text,
    published_head text,
    capture_barrier text,
    retention_floor text,
    last_source_healthy_at timestamp with time zone,
    last_received_at timestamp with time zone,
    last_applied_at timestamp with time zone,
    state character varying(40) DEFAULT 'initializing'::character varying NOT NULL,
    lease_owner character varying(160),
    lease_expires_at timestamp with time zone,
    lease_token bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hz_fop_sync_streams_mode CHECK (((mode)::text = ANY ((ARRAY['snapshot'::character varying, 'incremental'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_sync_streams_state CHECK (((state)::text = ANY ((ARRAY['initializing'::character varying, 'ready'::character varying, 'catching_up'::character varying, 'delayed'::character varying, 'failed'::character varying, 'rebootstrap_required'::character varying, 'disabled'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_sync_streams; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_sync_streams IS '增量流与连续水位；区分采集、接收、应用，防止失败事件被假跳过；定时器不承担可靠状态。；cursor 是不透明字符串，不做大小／字典序比较；源需提供提交顺序与边界。；各进程更新核验租约 token；全局应用水位不越过未完成事件。；调度读取connection.sync_schedule；触发后连续分页追平本次屏障，不在每页之间等待下一调度周期。暂停配置优先，方案配置不表示已启用FOP访问。';


--
-- Name: COLUMN hz_fop_sync_streams.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_streams.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_streams.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_streams.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_streams.stream_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.stream_key IS '源资源流；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_streams.mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.mode IS '同步模式；来源：本地设计；选项：snapshot, incremental；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_streams.source_scope_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.source_scope_version IS '源范围版本；来源：增量契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_streams.schema_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.schema_version IS '源契约版本；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_streams.received_cursor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.received_cursor IS '可靠接收游标；来源：增量契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_streams.applied_cursor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.applied_cursor IS '连续应用游标；来源：增量契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_streams.published_head; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.published_head IS '源发布流头；来源：增量契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_streams.capture_barrier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.capture_barrier IS '采集提交覆盖进度；来源：增量契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_streams.retention_floor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.retention_floor IS '最早续传边界；来源：增量契约；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_streams.last_source_healthy_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.last_source_healthy_at IS '源采集健康核验；来源：增量健康契约；存 UTC；业务日期按 UTC+8 解释；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_streams.last_received_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.last_received_at IS '最近接收；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_streams.last_applied_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.last_applied_at IS '最近连续应用；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_streams.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.state IS '流状态；来源：本地设计；选项：initializing, ready, catching_up, delayed, failed, rebootstrap_required, disabled；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_streams.lease_owner; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.lease_owner IS '当前进程租约；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_streams.lease_expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.lease_expires_at IS '租约到期；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_streams.lease_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.lease_token IS '防旧实例写入代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_streams.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.created_at IS '本地首次登记；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_streams.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_streams.updated_at IS '本地最近更新；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: hz_fop_sync_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_sync_tasks (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    task_type character varying(40) NOT NULL,
    target_key character varying(240) NOT NULL,
    document_id uuid,
    requested_version numeric(30,0),
    processing_version numeric(30,0),
    state character varying(40) DEFAULT 'pending'::character varying NOT NULL,
    priority smallint DEFAULT 50 NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone,
    lease_owner character varying(160),
    lease_expires_at timestamp with time zone,
    lease_token bigint DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_error_code character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    requested_revision bigint DEFAULT 1 NOT NULL,
    processing_revision bigint,
    requested_versions jsonb DEFAULT '{}'::jsonb NOT NULL,
    processing_versions jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT ck_hz_fop_sync_tasks_payload_shape CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT ck_hz_fop_sync_tasks_processing_versions_shape CHECK ((jsonb_typeof(processing_versions) = 'object'::text)),
    CONSTRAINT ck_hz_fop_sync_tasks_requested_versions_shape CHECK ((jsonb_typeof(requested_versions) = 'object'::text)),
    CONSTRAINT ck_hz_fop_sync_tasks_state CHECK (((state)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'retry'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'blocked'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_sync_tasks_task_type CHECK (((task_type)::text = ANY ((ARRAY['fetch_document'::character varying, 'apply_document'::character varying, 'rebuild_order'::character varying, 'verify_reference'::character varying, 'repair_relation'::character varying, 'reconcile'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_sync_tasks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_sync_tasks IS '持久化取数／重算任务；断电可续传；新变更合并提升 requested_version，不覆盖当前领取版本。；领取及完成使用锁／token；完成旧版本时若 requested_version 已提升则重新 pending，防丢失唤醒。；fetch_document 只比较同一源单的 source_version；多源 rebuild_order 采用行锁递增 requested_revision 和受验证版本向量，不比较不同单据的版本数值。领取后仍有新唤醒则再执行，不能直接标全部完成。';


--
-- Name: COLUMN hz_fop_sync_tasks.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.task_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.task_type IS '任务类型；来源：本地设计；选项：fetch_document, apply_document, rebuild_order, verify_reference, repair_relation, reconcile；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.target_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.target_key IS '稳定任务目标；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.document_id IS '本地目标单据；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.requested_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.requested_version IS '最新要求版本；来源：可靠源版本；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_tasks.processing_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.processing_version IS '本次领取版本；来源：可靠源版本；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_sync_tasks.state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.state IS '任务状态；来源：本地设计；选项：pending, running, retry, succeeded, failed, blocked；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.priority; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.priority IS '优先级；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.attempts IS '次数；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.next_attempt_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.next_attempt_at IS '计划时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.lease_owner; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.lease_owner IS '领取进程；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.lease_expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.lease_expires_at IS '领取到期；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.lease_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.lease_token IS '领取代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.payload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.payload IS '非敏感任务参数；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.last_error_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.last_error_code IS '错误码；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.created_at IS '本地首次登记；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.updated_at IS '本地最近更新；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.requested_revision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.requested_revision IS '本任务累计唤醒代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.processing_revision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.processing_revision IS '本次领取唤醒代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.requested_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.requested_versions IS '要求覆盖的来源版本向量；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_sync_tasks.processing_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_sync_tasks.processing_versions IS '本次领取版本向量；来源：本地设计；证据：本地设计';


--
-- Name: hz_fop_timestamp_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_timestamp_documents (
    batch_id uuid NOT NULL,
    entity_code text NOT NULL,
    source_id text NOT NULL,
    company_id text NOT NULL,
    created_at text,
    modified_at text,
    raw jsonb NOT NULL,
    payload_hash text NOT NULL,
    removed boolean DEFAULT false NOT NULL,
    last_run_id uuid NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hz_fop_timestamp_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_timestamp_pages (
    run_id uuid NOT NULL,
    page_index integer NOT NULL,
    query jsonb NOT NULL,
    documents jsonb NOT NULL,
    payload_hash text NOT NULL
);


--
-- Name: hz_fop_timestamp_projection_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_timestamp_projection_tasks (
    batch_id uuid NOT NULL,
    entity_code text NOT NULL,
    source_id text NOT NULL,
    run_id uuid NOT NULL,
    state text NOT NULL,
    reason text,
    previous_raw jsonb,
    current_raw jsonb,
    removed boolean NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hz_fop_timestamp_projection_tasks_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'applied'::text])))
);


--
-- Name: hz_fop_timestamp_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_timestamp_runs (
    id uuid NOT NULL,
    batch_id uuid NOT NULL,
    entity_code text NOT NULL,
    mode text NOT NULL,
    state text NOT NULL,
    lower_bound text,
    upper_bound text,
    error_code text,
    page_count integer DEFAULT 0 NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT hz_fop_timestamp_runs_mode_check CHECK ((mode = ANY (ARRAY['initialize'::text, 'incremental'::text, 'reconcile'::text]))),
    CONSTRAINT hz_fop_timestamp_runs_state_check CHECK ((state = ANY (ARRAY['running'::text, 'applied'::text, 'projection_pending'::text, 'failed'::text])))
);


--
-- Name: hz_fop_timestamp_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_timestamp_state (
    batch_id uuid NOT NULL,
    entity_code text NOT NULL,
    watermark text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE hz_fop_timestamp_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_timestamp_state IS '时间增量采集水位；不代表事务屏障或工作台全部投影完成。原始时间字符串保留源精度。';


--
-- Name: hz_fop_tracking_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_tracking_events (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    dispatch_document_id uuid NOT NULL,
    source_event_id character varying(128) NOT NULL,
    occurred_at timestamp with time zone,
    source_timezone character varying(64),
    node_code character varying(100),
    content text,
    location text,
    pod_url text,
    source_version numeric(30,0)
);


--
-- Name: TABLE hz_fop_tracking_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_tracking_events IS '物流轨迹节点；仅为物流异常／妥投核对保留必要轨迹；非本轮数据分析仓库。';


--
-- Name: COLUMN hz_fop_tracking_events.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_events.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_tracking_events.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_events.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_tracking_events.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_events.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_tracking_events.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_events.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_tracking_events.dispatch_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_events.dispatch_document_id IS '发运单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_tracking_events.source_event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_events.source_event_id IS '原轨迹行 ID；来源：hzkj_logisticstrackentry.id；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_tracking_events.occurred_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_events.occurred_at IS '轨迹 UTC 时间；来源：hzkj_process_utc_time；存 UTC；业务日期按 UTC+8 解释；证据：映射待确认';


--
-- Name: COLUMN hz_fop_tracking_events.source_timezone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_events.source_timezone IS '源时区；来源：hzkj_track_time_zone；证据：映射待确认';


--
-- Name: COLUMN hz_fop_tracking_events.node_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_events.node_code IS '节点编码；来源：hzkj_track_node_code；证据：映射待确认';


--
-- Name: COLUMN hz_fop_tracking_events.content; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_events.content IS '轨迹内容；来源：hzkj_process_content；证据：映射待确认';


--
-- Name: COLUMN hz_fop_tracking_events.location; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_events.location IS '地点；来源：hzkj_process_location；证据：映射待确认';


--
-- Name: COLUMN hz_fop_tracking_events.pod_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_events.pod_url IS '签收凭证引用；来源：hzkj_pod_url；证据：映射待确认';


--
-- Name: COLUMN hz_fop_tracking_events.source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_events.source_version IS '轨迹版本；来源：待新增增量契约；证据：待补契约';


--
-- Name: hz_fop_tracking_numbers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_tracking_numbers (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    dispatch_document_id uuid NOT NULL,
    package_id uuid,
    tracking_type character varying(32) NOT NULL,
    number character varying(200) NOT NULL,
    provider_id character varying(128),
    shopify_selected boolean,
    source_version numeric(30,0),
    removed_at timestamp with time zone,
    CONSTRAINT ck_hz_fop_tracking_numbers_tracking_type CHECK (((tracking_type)::text = ANY ((ARRAY['first_mile'::character varying, 'last_mile'::character varying, 'full'::character varying, 'unknown'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_tracking_numbers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_tracking_numbers IS '物流跟踪号码；保留多个号码及明确选定信息。；NULL 不等于未选定；没有选定事实不自行挑号码。';


--
-- Name: COLUMN hz_fop_tracking_numbers.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_numbers.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_tracking_numbers.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_numbers.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_tracking_numbers.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_numbers.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_tracking_numbers.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_numbers.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_tracking_numbers.dispatch_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_numbers.dispatch_document_id IS '发运单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_tracking_numbers.package_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_numbers.package_id IS '包裹；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_tracking_numbers.tracking_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_numbers.tracking_type IS '号码类型；来源：TC／WC／QC；first_mile,last_mile,full,unknown；证据：映射待确认';


--
-- Name: COLUMN hz_fop_tracking_numbers.number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_numbers.number IS '跟踪号码；来源：真实物流号；证据：映射待确认';


--
-- Name: COLUMN hz_fop_tracking_numbers.provider_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_numbers.provider_id IS '物流商；来源：物流商；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_tracking_numbers.shopify_selected; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_numbers.shopify_selected IS '是否 FOP 明确选给 Shopify；来源：FOP 明确选定事实；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_tracking_numbers.source_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_numbers.source_version IS '发运版本；来源：待新增增量契约；证据：待补契约';


--
-- Name: COLUMN hz_fop_tracking_numbers.removed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_tracking_numbers.removed_at IS '号码失效；来源：真实替换事实；存 UTC；业务日期按 UTC+8 解释；证据：契约／规则待逐项核验';


--
-- Name: hz_fop_workbench_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_workbench_memberships (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    order_document_id uuid NOT NULL,
    queue_code character varying(64) NOT NULL,
    classification_state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    projection_revision bigint NOT NULL,
    phase_completed_at timestamp with time zone,
    reason_codes jsonb DEFAULT '[]'::jsonb NOT NULL,
    rule_version integer NOT NULL,
    published_at timestamp with time zone NOT NULL,
    unknown_reason_code character varying(100),
    CONSTRAINT ck_hz_fop_workbench_memberships_classification_state CHECK (((classification_state)::text = ANY ((ARRAY['member'::character varying, 'non_member'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_memberships_queue_code CHECK (((queue_code)::text = ANY ((ARRAY['unpaid'::character varying, 'review'::character varying, 'stock'::character varying, 'rma'::character varying, 'exceptions'::character varying, 'sales_completed'::character varying, 'dispatch'::character varying, 'dispatch_completed'::character varying, 'procurement'::character varying, 'procurement_shipping'::character varying, 'stock_procurement'::character varying, 'procurement_completed'::character varying, 'allocation'::character varying, 'allocation_review'::character varying, 'allocation_completed'::character varying, 'shipping'::character varying, 'warehouse_completed'::character varying, 'purchase_returns'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_memberships_reason_codes_shape CHECK ((jsonb_typeof(reason_codes) = 'array'::text))
);


--
-- Name: TABLE hz_fop_workbench_memberships; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_workbench_memberships IS '待办／完成分类结果；同一订单可同时属于正常流程、异常、RMA 及阶段完成；五块待办卡片复用该范围。；不是一个互斥全流程状态字段；销售完成仅 billstatus=C，不以已发货／取消排除。；完成时间仅独立展示；相对时间筛选使用客户付款日期；备货创建排序独立。；保存适用清单的明确不属于及未知结果；未知不等于 non_member。获权候选存在影响全集的 unknown 时 queueState=incomplete、total=null，不能静默当0或完整集合。';


--
-- Name: COLUMN hz_fop_workbench_memberships.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_memberships.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_memberships.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_memberships.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_memberships.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_memberships.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_memberships.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_memberships.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_memberships.order_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_memberships.order_document_id IS '投影订单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_memberships.queue_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_memberships.queue_code IS '清单编码；来源：本地设计；unpaid,review,stock,rma,exceptions,sales_completed,dispatch,dispatch_completed,procurement,procurement_shipping,stock_procurement,procurement_completed,allocation,allocation_review,allocation_completed,shipping,warehouse_completed,purchase_returns；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_memberships.classification_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_memberships.classification_state IS '本清单分类结果；来源：本地设计；选项：member, non_member, unknown；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_memberships.projection_revision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_memberships.projection_revision IS '所属投影修订；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_memberships.phase_completed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_memberships.phase_completed_at IS '阶段完成时间；来源：明确阶段事实；存 UTC；业务日期按 UTC+8 解释；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_memberships.reason_codes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_memberships.reason_codes IS '入列依据；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_memberships.rule_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_memberships.rule_version IS '规则版本；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_memberships.published_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_memberships.published_at IS '发布时刻；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_memberships.unknown_reason_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_memberships.unknown_reason_code IS '未能分类原因；来源：本地设计；证据：本地设计';


--
-- Name: hz_fop_workbench_order_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_workbench_order_lines (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    order_document_id uuid NOT NULL,
    source_line_id uuid NOT NULL,
    sku_code character varying(160) NOT NULL,
    product_name text,
    variant text,
    image_url text,
    quantity numeric(24,8),
    display_role character varying(32),
    sequence integer,
    projection_revision bigint NOT NULL
);


--
-- Name: TABLE hz_fop_workbench_order_lines; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_workbench_order_lines IS '完整订单展示商品；同一发布事务复制完整展示商品；页面不将新原始分录拼到旧投影头上。；FK→workbench_orders；重算时按订单整体替换，头、行、队列成员同事务发布。；SKU 搜索先 EXISTS 命中订单，再返回该订单全部商品；导出同规则。';


--
-- Name: COLUMN hz_fop_workbench_order_lines.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_order_lines.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_order_lines.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_order_lines.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_order_lines.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_order_lines.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_order_lines.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_order_lines.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_order_lines.order_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_order_lines.order_document_id IS '投影订单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_order_lines.source_line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_order_lines.source_line_id IS '来源商品行；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_order_lines.sku_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_order_lines.sku_code IS 'SKU 编码；来源：来源商品；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_order_lines.product_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_order_lines.product_name IS '商品名称；来源：来源商品；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_order_lines.variant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_order_lines.variant IS '属性；来源：来源商品；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_order_lines.image_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_order_lines.image_url IS '商品图片；来源：来源商品；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_order_lines.quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_order_lines.quantity IS '展示数量；来源：明确商品层级规则；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_order_lines.display_role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_order_lines.display_role IS '父子行展示角色；来源：BOM 映射；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_order_lines.sequence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_order_lines.sequence IS '展示顺序；来源：源行序；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_order_lines.projection_revision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_order_lines.projection_revision IS '所属投影修订；来源：本地设计；证据：本地设计';


--
-- Name: hz_fop_workbench_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_workbench_orders (
    document_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    order_kind character varying(40) NOT NULL,
    order_number character varying(160) NOT NULL,
    shopify_order_number character varying(160),
    customer_id character varying(128),
    customer_name text,
    current_customer_owner_id character varying(128),
    owner_employee_id character varying(128),
    warehouse_id character varying(128),
    warehouse_name text,
    store_name text,
    country_code character varying(2),
    customer_paid_at timestamp with time zone,
    consumer_paid_at timestamp with time zone,
    business_created_at timestamp with time zone,
    total_amount numeric(28,8),
    product_amount numeric(28,8),
    freight_amount numeric(28,8),
    tax_amount numeric(28,8),
    discount_amount numeric(28,8),
    currency_code character varying(3),
    item_count integer,
    total_quantity numeric(24,8),
    stage_evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    recipient_snapshot jsonb,
    stock_type character varying(40),
    stock_lifecycle character varying(40),
    intercept_status character varying(40),
    cancelled boolean,
    projection_revision bigint NOT NULL,
    mapping_version integer DEFAULT 1 NOT NULL,
    rule_version integer DEFAULT 1 NOT NULL,
    dependency_vector jsonb DEFAULT '{}'::jsonb NOT NULL,
    readiness character varying(40) DEFAULT 'incomplete'::character varying NOT NULL,
    published_at timestamp with time zone,
    ownership_verified_at timestamp with time zone,
    ownership_version character varying(160),
    customer_payment_state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    order_review_state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    purchase_application_state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    purchase_coverage_state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    platform_order_state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    supplier_payment_state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    supplier_shipment_state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    procurement_stage character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    stock_readiness_state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    allocation_review_state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    shopify_sync_state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    dispatch_task_state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    outbound_state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    allocation_created boolean,
    CONSTRAINT ck_hz_fop_workbench_orders_allocation_review_state CHECK (((allocation_review_state)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_orders_customer_payment_state CHECK (((customer_payment_state)::text = ANY ((ARRAY['unpaid'::character varying, 'paid'::character varying, 'refunded'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_orders_dependency_vector_shape CHECK ((jsonb_typeof(dependency_vector) = 'object'::text)),
    CONSTRAINT ck_hz_fop_workbench_orders_dispatch_task_state CHECK (((dispatch_task_state)::text = ANY ((ARRAY['dispatch_missing'::character varying, 'dispatch_draft'::character varying, 'dispatch_submitted'::character varying, 'dispatch_approved'::character varying, 'dispatch_synced'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_orders_order_kind CHECK (((order_kind)::text = ANY ((ARRAY['fulfillment'::character varying, 'stock'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_orders_order_review_state CHECK (((order_review_state)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_orders_outbound_state CHECK (((outbound_state)::text = ANY ((ARRAY['pending'::character varying, 'completed'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_orders_platform_order_state CHECK (((platform_order_state)::text = ANY ((ARRAY['not_pushed'::character varying, 'partial'::character varying, 'pushed'::character varying, 'not_required'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_orders_procurement_stage CHECK (((procurement_stage)::text = ANY ((ARRAY['application_pending'::character varying, 'purchase_order_pending'::character varying, 'alibaba_pending'::character varying, 'payment_pending'::character varying, 'refund_pending'::character varying, 'supplier_pending'::character varying, 'supplier_partial'::character varying, 'shipped'::character varying, 'cancelled'::character varying, 'not_required'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_orders_purchase_application_state CHECK (((purchase_application_state)::text = ANY ((ARRAY['not_created'::character varying, 'partial'::character varying, 'created'::character varying, 'not_required'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_orders_purchase_coverage_state CHECK (((purchase_coverage_state)::text = ANY ((ARRAY['not_ordered'::character varying, 'partial'::character varying, 'ordered'::character varying, 'cancelled'::character varying, 'not_required'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_orders_readiness CHECK (((readiness)::text = ANY ((ARRAY['incomplete'::character varying, 'ready'::character varying, 'conflict'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_orders_shopify_sync_state CHECK (((shopify_sync_state)::text = ANY ((ARRAY['pending'::character varying, 'synced'::character varying, 'not_required'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_orders_stage_evidence_shape CHECK ((jsonb_typeof(stage_evidence) = 'object'::text)),
    CONSTRAINT ck_hz_fop_workbench_orders_stock_readiness_state CHECK (((stock_readiness_state)::text = ANY ((ARRAY['incomplete'::character varying, 'ready'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_orders_supplier_payment_state CHECK (((supplier_payment_state)::text = ANY ((ARRAY['unpaid'::character varying, 'partial'::character varying, 'paid'::character varying, 'refunded'::character varying, 'not_required'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_hz_fop_workbench_orders_supplier_shipment_state CHECK (((supplier_shipment_state)::text = ANY ((ARRAY['pending'::character varying, 'partial'::character varying, 'shipped'::character varying, 'not_required'::character varying, 'unknown'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_workbench_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_workbench_orders IS '工作台订单查询投影；五工作台共用同一订单基础，避免复制五套订单；原始事实与派生分类分开。；查询按当前组织／角色、独立资源授权、业务条件过滤后合计排序分页；不永久物化每个用户的获权结果。；当前客户归属与订单归属各自保存；备货库存按客户当前归属，不能一概复用订单历史业务员。；同事务读取 active_dataset_id；事实、展示分录、成员和依赖必须同代次。首次未初始化返回明确未就绪。；readiness 仅表达基础快照结构完整；具体清单资格由 memberships.classification_state 三值判断，不因采购等未接通而伪造已完成或无待办。；五工作台共享本表固定阶段列和同一rule_version；不创建销售／采购／发运／配货／仓库各自的订单或阶段副本。异常、RMA、取消及拦截保持独立事实，不覆盖主流程阶段。；共享投影不保存viewer_account_id、allowed_user_ids或按用户展开的可见结果；当前角色、部门、成员及资源范围在查询时应用。导出授权快照属于有期限的任务，不是永久用户投影。';


--
-- Name: COLUMN hz_fop_workbench_orders.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.document_id IS '履约／备货源单；来源：本地设计；PK／FK→source_documents.id；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.order_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.order_kind IS '订单类型；来源：本地设计；选项：fulfillment, stock；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.order_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.order_number IS '订单编号；来源：来源事实；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.shopify_order_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.shopify_order_number IS 'Shopify 单号；来源：履约事实；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_orders.customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.customer_id IS '订货客户；来源：来源事实；FOP ID／外部编号按字符串保存，不能转 JS number；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.customer_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.customer_name IS '客户显示名；来源：来源事实；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.current_customer_owner_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.current_customer_owner_id IS '客户当前归属业务员；来源：当前归属核验；FOP ID／外部编号按字符串保存，不能转 JS number；证据：映射待确认';


--
-- Name: COLUMN hz_fop_workbench_orders.owner_employee_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.owner_employee_id IS '订单当前业务员；来源：来源事实；FOP ID／外部编号按字符串保存，不能转 JS number；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.warehouse_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.warehouse_id IS '主展示仓库；来源：来源事实；FOP ID／外部编号按字符串保存，不能转 JS number；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.warehouse_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.warehouse_name IS '仓库显示名；来源：来源事实；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.store_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.store_name IS '店铺名；来源：来源事实；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.country_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.country_code IS '发货国家；来源：履约收件事实；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_orders.customer_paid_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.customer_paid_at IS '时间筛选及履约默认排序；来源：来源事实；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.consumer_paid_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.consumer_paid_at IS '独立 C 端付款时间；来源：来源事实；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.business_created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.business_created_at IS '备货默认排序；来源：来源事实；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.total_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.total_amount IS '订单金额；来源：来源事实；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.product_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.product_amount IS '产品金额；来源：来源事实；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.freight_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.freight_amount IS '运费；来源：来源事实；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.tax_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.tax_amount IS '税费；来源：来源事实；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.discount_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.discount_amount IS '优惠；来源：来源事实；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.currency_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.currency_code IS '明确结算币种；来源：来源事实；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.item_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.item_count IS '商品款数；来源：计数规则；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.total_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.total_quantity IS '商品总件数；来源：计数规则；按源单位保存；换算及分摊须有明确依据；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.stage_evidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.stage_evidence IS '共享阶段计算的必要证据；来源：已确认后端组合规则；只存阶段依据、未知原因及源引用；阶段值以本表固定列为准，不在JSON另维护第二套状态；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.recipient_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.recipient_snapshot IS '统一收件人展示快照；来源：已核实订单收件；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_orders.stock_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.stock_type IS '备货类型；来源：备货事实；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_orders.stock_lifecycle; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.stock_lifecycle IS '备货阶段；来源：unpaid,pending_procurement,received,unknown；证据：映射待确认';


--
-- Name: COLUMN hz_fop_workbench_orders.intercept_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.intercept_status IS '拦截状态；来源：明确拦截事实；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_orders.cancelled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.cancelled IS '源订单已取消；来源：明确取消事实；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_orders.projection_revision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.projection_revision IS '本地投影修订号；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.mapping_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.mapping_version IS '事实映射版本；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.rule_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.rule_version IS '分类规则版本；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.dependency_vector; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.dependency_vector IS '所依据来源版本向量；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.readiness; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.readiness IS '投影完整性；来源：本地设计；选项：incomplete, ready, conflict；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.published_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.published_at IS '完整投影发布时间；来源：本地设计；存 UTC；业务日期按 UTC+8 解释；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.ownership_verified_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.ownership_verified_at IS '来源归属最近可靠核验；来源：归属变更或实时核验；存 UTC；业务日期按 UTC+8 解释；证据：映射待确认';


--
-- Name: COLUMN hz_fop_workbench_orders.ownership_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.ownership_version IS '归属核验版本；来源：归属权限契约；证据：映射待确认';


--
-- Name: COLUMN hz_fop_workbench_orders.customer_payment_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.customer_payment_state IS '客户支付状态；来源：已确认后端组合规则；选项：unpaid, paid, refunded, unknown；paymentStatus；未提供保持unknown；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.order_review_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.order_review_state IS '履约审核状态；来源：已确认后端组合规则；选项：pending, approved, unknown；reviewStatus；来源单据已审核不因后续发货而清除；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.purchase_application_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.purchase_application_state IS '采购申请覆盖；来源：已确认后端组合规则；选项：not_created, partial, created, not_required, unknown；procurementProgress.purchaseApplication；partial仅保存已确认覆盖事实；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.purchase_coverage_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.purchase_coverage_state IS '采购订单覆盖；来源：已确认后端组合规则；选项：not_ordered, partial, ordered, cancelled, not_required, unknown；procurementProgress.purchaseOrder；按唯一需求与有效来源分摊计算；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.platform_order_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.platform_order_state IS '平台下单状态；来源：已确认后端组合规则；选项：not_pushed, partial, pushed, not_required, unknown；procurementProgress.alibabaOrder；仅明确无需平台时才not_required；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.supplier_payment_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.supplier_payment_state IS '供应商付款状态；来源：已确认后端组合规则；选项：unpaid, partial, paid, refunded, not_required, unknown；procurementProgress.supplierPayment；付款与客户支付、供应商退款分开；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.supplier_shipment_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.supplier_shipment_state IS '供应商发货状态；来源：已确认后端组合规则；选项：pending, partial, shipped, not_required, unknown；fulfillmentProgress.supplierShipment；按实际来源分摊聚合；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.procurement_stage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.procurement_stage IS '采购展示进度；来源：已确认后端组合规则；选项：application_pending, purchase_order_pending, alibaba_pending, payment_pending, refund_pending, supplier_pending, supplier_partial, shipped, cancelled, not_required, unknown；复用getProcurementStage优先级；application_pending保留内部兼容，当前待采购筛选仅purchase_order_pending/alibaba_pending/payment_pending/refund_pending；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.stock_readiness_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.stock_readiness_state IS '配货齐套状态；来源：已确认后端组合规则；选项：incomplete, ready, unknown；fulfillmentProgress.stockReadiness；核对全部有效应履约包裹及商品；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.allocation_review_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.allocation_review_state IS '配货审核状态；来源：已确认后端组合规则；选项：pending, approved, unknown；fulfillmentProgress.allocationReview；按全部有效配货范围聚合；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.shopify_sync_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.shopify_sync_state IS 'Shopify同步状态；来源：已确认后端组合规则；选项：pending, synced, not_required, unknown；fulfillmentProgress.shopifySync；发运审核或出库不替代同步成功；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.dispatch_task_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.dispatch_task_state IS '发运任务状态；来源：已确认后端组合规则；选项：dispatch_missing, dispatch_draft, dispatch_submitted, dispatch_approved, dispatch_synced, unknown；dispatchTaskStatus；按全部有效应履约包裹聚合，不只看已有发运单；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.outbound_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.outbound_state IS '整单出库状态；来源：已确认后端组合规则；选项：pending, completed, unknown；fulfillmentProgress.outbound；原生partial仅保留来源事实，整单查询归pending，不增加部分出库业务选项；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_orders.allocation_created; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_orders.allocation_created IS '有效配货单是否已创建；来源：已确认后端组合规则；仅明确有效单据集合可赋true/false；未知为NULL，不由履约审核反推；证据：本地设计';


--
-- Name: hz_fop_workbench_procurement_demands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_workbench_procurement_demands (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    order_document_id uuid NOT NULL,
    order_line_id uuid NOT NULL,
    effective_order_quantity numeric(24,8),
    stock_covered_quantity numeric(24,8),
    required_quantity numeric(24,8),
    allocated_quantity numeric(24,8),
    unassigned_quantity numeric(24,8),
    unit_code character varying(64),
    calculation_state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    reason_code character varying(100),
    projection_revision bigint NOT NULL,
    CONSTRAINT ck_hz_fop_workbench_procurement_demands_calculation_state CHECK (((calculation_state)::text = ANY ((ARRAY['known'::character varying, 'unknown'::character varying, 'conflict'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_workbench_procurement_demands; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_workbench_procurement_demands IS '订单商品唯一采购需求；净需求只在每条订单商品保存一次；采购分摊表仅存分给某采购行的份额。；订单商品需求10、P1覆盖6、P2覆盖4：本表 required_quantity=10，分摊表分别6和4；禁止把10重复存入每个采购配对再求和。；仅明确生效的取消减少需求；申请退款、已退款、RMA建单或退货并不自动减少有效履约需求。供应商确认取消使原采购分配失效；退回后是否补采依据 FOP 明确的剩余供货义务。；有效分配在统一单位下与净需求核对；未知覆盖、取消效果或超额分配进入 unknown／conflict，不用 max(0,…) 隐藏差异。';


--
-- Name: COLUMN hz_fop_workbench_procurement_demands.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_procurement_demands.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_procurement_demands.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_procurement_demands.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_procurement_demands.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_procurement_demands.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_procurement_demands.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_procurement_demands.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_procurement_demands.order_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_procurement_demands.order_document_id IS '履约／备货投影；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_procurement_demands.order_line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_procurement_demands.order_line_id IS '业务商品行；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_procurement_demands.effective_order_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_procurement_demands.effective_order_quantity IS '明确有效履约数量；来源：当前有效商品需求；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_workbench_procurement_demands.stock_covered_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_procurement_demands.stock_covered_quantity IS '明确备货／库存覆盖；来源：真实覆盖关系；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_workbench_procurement_demands.required_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_procurement_demands.required_quantity IS '净采购需求；来源：需求减已确认库存覆盖；按源单位保存；换算及分摊须有明确依据；证据：映射待确认';


--
-- Name: COLUMN hz_fop_workbench_procurement_demands.allocated_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_procurement_demands.allocated_quantity IS '有效采购分配合计；来源：有效采购来源分摊；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_procurement_demands.unassigned_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_procurement_demands.unassigned_quantity IS '待创建采购需求；来源：明确净需求减有效分配；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_procurement_demands.unit_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_procurement_demands.unit_code IS '统一比较单位；来源：已核实换算；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_procurement_demands.calculation_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_procurement_demands.calculation_state IS '需求计算结果；来源：本地设计；选项：known, unknown, conflict；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_procurement_demands.reason_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_procurement_demands.reason_code IS '无法确定／守恒冲突原因；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_procurement_demands.projection_revision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_procurement_demands.projection_revision IS '同批投影修订；来源：本地设计；证据：本地设计';


--
-- Name: hz_fop_workbench_purchase_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_workbench_purchase_allocations (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    order_document_id uuid NOT NULL,
    order_line_id uuid NOT NULL,
    purchase_document_id uuid NOT NULL,
    purchase_line_id uuid NOT NULL,
    allocated_requirement_quantity numeric(24,8),
    purchased_quantity numeric(24,8),
    supplier_shipped_quantity numeric(24,8),
    inbound_quantity numeric(24,8),
    allocated_amount numeric(28,8),
    currency_code character varying(3),
    projection_revision bigint NOT NULL,
    cancelled_quantity numeric(24,8),
    returned_quantity numeric(24,8),
    remaining_supply_quantity numeric(24,8),
    allocation_state character varying(40) DEFAULT 'unknown'::character varying NOT NULL,
    CONSTRAINT ck_hz_fop_workbench_purchase_allocations_allocation_state CHECK (((allocation_state)::text = ANY ((ARRAY['known'::character varying, 'unknown'::character varying, 'conflict'::character varying])::text[])))
);


--
-- Name: TABLE hz_fop_workbench_purchase_allocations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.hz_fop_workbench_purchase_allocations IS '采购单到业务来源的查询分摊；按采购单分组查询时先限获权订单，再合计分摊数量；整单供应商元信息与授权数量分开。；采购单付款／平台下单等整单事实不复制成多个独立采购义务；金额合计以来源和币种去重。；未建单需求从订单需求缺口计算，不建立假的采购单或供应商。；净采购需求只从 workbench_procurement_demands 按 order_line_id 汇总一次；本表不得重复计算需求分母。；采购行合并多个业务来源时，已发、已入库、取消、退回、金额均须真实来源分摊；不得按比例、先进先出或复制整行状态自动摊派。；付款及平台下单依据明确关联资金／平台义务去重判断；部分付款或多平台义务未获精确来源覆盖时，受影响采购完成为 unknown。';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.id IS '本地主键；来源：本地设计；PK；应用生成 UUID；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.connection_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.connection_id IS '集成连接；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.company_id IS '来源公司；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.dataset_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.dataset_id IS '副本数据集代次；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.order_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.order_document_id IS '履约或备货投影；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.order_line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.order_line_id IS '业务来源商品行；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.purchase_document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.purchase_document_id IS '真实采购单；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.purchase_line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.purchase_line_id IS '真实采购分录；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.allocated_requirement_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.allocated_requirement_quantity IS '分配给该采购行的需求份额；来源：明确来源分摊；不是订单商品总需求；示例10分为6与4，本行分别保存6或4；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.purchased_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.purchased_quantity IS '本来源采购覆盖；来源：明确来源分摊；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.supplier_shipped_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.supplier_shipped_quantity IS '本来源已发；来源：明确发货分摊；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.inbound_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.inbound_quantity IS '本来源已入库；来源：明确入库分摊；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.allocated_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.allocated_amount IS '本来源采购额；来源：明确金额分摊；API 传精确十进制字符串；币种未知不汇总，不用其他金额兜底；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.currency_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.currency_code IS '分摊币种；来源：明确采购币种；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.projection_revision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.projection_revision IS '发布修订；来源：本地设计；证据：本地设计';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.cancelled_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.cancelled_quantity IS '本来源实际取消分配量；来源：明确来源取消分摊；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.returned_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.returned_quantity IS '本来源实物退回量；来源：明确退货分摊；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.remaining_supply_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.remaining_supply_quantity IS '本来源剩余供货义务；来源：FOP明确剩余供货义务；按源单位保存；换算及分摊须有明确依据；证据：契约／规则待逐项核验';


--
-- Name: COLUMN hz_fop_workbench_purchase_allocations.allocation_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.hz_fop_workbench_purchase_allocations.allocation_state IS '分摊可用性；来源：本地设计；选项：known, unknown, conflict；证据：本地设计';


--
-- Name: hz_fop_workbench_receipt_notices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hz_fop_workbench_receipt_notices (
    document_id uuid NOT NULL,
    source_version numeric(30,0) NOT NULL,
    owner_employee_ids text[] NOT NULL,
    ownership_verified_at timestamp with time zone NOT NULL,
    shipment_state text NOT NULL,
    carrier_name text,
    quantity numeric(24,8) NOT NULL,
    inbound_quantity numeric(24,8) NOT NULL,
    lines jsonb NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hz_fop_workbench_receipt_notices_check CHECK (((inbound_quantity >= (0)::numeric) AND (inbound_quantity <= quantity))),
    CONSTRAINT hz_fop_workbench_receipt_notices_lines_check CHECK (((jsonb_typeof(lines) = 'array'::text) AND (jsonb_array_length(lines) > 0))),
    CONSTRAINT hz_fop_workbench_receipt_notices_owner_employee_ids_check CHECK ((cardinality(owner_employee_ids) > 0)),
    CONSTRAINT hz_fop_workbench_receipt_notices_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT hz_fop_workbench_receipt_notices_shipment_state_check CHECK ((shipment_state = ANY (ARRAY['pending'::text, 'shipped'::text, 'unknown'::text])))
);


--
-- Name: lead_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_contacts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    lead_id uuid NOT NULL,
    type public.autoflow_lead_contact_type_enum NOT NULL,
    value character varying(500) NOT NULL,
    label character varying(80),
    verified boolean DEFAULT false NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_url character varying(1000),
    source_type character varying(80) DEFAULT 'manual'::character varying NOT NULL,
    verification_status character varying(24) DEFAULT 'unverified'::character varying NOT NULL,
    confidence integer DEFAULT 0 NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT chk_lead_contacts_confidence CHECK (((confidence >= 0) AND (confidence <= 100)))
);


--
-- Name: lead_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_scores (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    lead_id uuid NOT NULL,
    workflow_run_id uuid,
    owner_user_id uuid NOT NULL,
    team_id uuid,
    shopify_confidence double precision DEFAULT 0 NOT NULL,
    ad_activity_score double precision DEFAULT 0 NOT NULL,
    traffic_score double precision DEFAULT 0 NOT NULL,
    contact_score double precision DEFAULT 0 NOT NULL,
    category_fit_score double precision DEFAULT 0 NOT NULL,
    dropshipping_fit_score double precision DEFAULT 0 NOT NULL,
    risk_score double precision DEFAULT 0 NOT NULL,
    total_score double precision DEFAULT 0 NOT NULL,
    grade character varying(16) DEFAULT 'unrated'::character varying NOT NULL,
    model_version character varying(40) DEFAULT 'rules-v1'::character varying NOT NULL,
    reasons jsonb,
    calculated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_lead_scores_dimensions CHECK ((((shopify_confidence >= (0)::double precision) AND (shopify_confidence <= (100)::double precision)) AND ((ad_activity_score >= (0)::double precision) AND (ad_activity_score <= (100)::double precision)) AND ((traffic_score >= (0)::double precision) AND (traffic_score <= (100)::double precision)) AND ((contact_score >= (0)::double precision) AND (contact_score <= (100)::double precision)) AND ((category_fit_score >= (0)::double precision) AND (category_fit_score <= (100)::double precision)) AND ((dropshipping_fit_score >= (0)::double precision) AND (dropshipping_fit_score <= (100)::double precision)) AND ((risk_score >= (0)::double precision) AND (risk_score <= (100)::double precision)) AND ((total_score >= (0)::double precision) AND (total_score <= (100)::double precision))))
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    workflow_run_id uuid,
    owner_user_id uuid NOT NULL,
    team_id uuid,
    brand_name character varying(160) NOT NULL,
    domain character varying(255) NOT NULL,
    store_url character varying(500) NOT NULL,
    source character varying(120) NOT NULL,
    country character varying(80) DEFAULT ''::character varying NOT NULL,
    language character varying(40) DEFAULT 'English'::character varying NOT NULL,
    category character varying(120) DEFAULT ''::character varying NOT NULL,
    shopify_confidence double precision DEFAULT 0 NOT NULL,
    ad_activity_score double precision DEFAULT 0 NOT NULL,
    traffic_score double precision DEFAULT 0 NOT NULL,
    contact_score double precision DEFAULT 0 NOT NULL,
    total_score double precision DEFAULT 0 NOT NULL,
    status public.autoflow_lead_status_enum DEFAULT 'new'::public.autoflow_lead_status_enum NOT NULL,
    recommended_angle text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    normalized_domain character varying(255) NOT NULL,
    product_url character varying(1000),
    discovery_sources jsonb DEFAULT '[]'::jsonb NOT NULL,
    lead_type character varying(24) DEFAULT 'automatic'::character varying NOT NULL,
    registered_on date DEFAULT CURRENT_DATE NOT NULL,
    contacted_on date,
    city character varying(120) DEFAULT ''::character varying NOT NULL,
    current_follow_up text DEFAULT ''::text NOT NULL,
    next_follow_up_plan text DEFAULT ''::text NOT NULL,
    registrar_user_id uuid,
    CONSTRAINT chk_lead_type CHECK (((lead_type)::text = ANY ((ARRAY['manual'::character varying, 'import'::character varying, 'automatic'::character varying])::text[]))),
    CONSTRAINT chk_leads_scores CHECK ((((shopify_confidence >= (0)::double precision) AND (shopify_confidence <= (100)::double precision)) AND ((ad_activity_score >= (0)::double precision) AND (ad_activity_score <= (100)::double precision)) AND ((traffic_score >= (0)::double precision) AND (traffic_score <= (100)::double precision)) AND ((contact_score >= (0)::double precision) AND (contact_score <= (100)::double precision)) AND ((total_score >= (0)::double precision) AND (total_score <= (100)::double precision))))
);


--
-- Name: local_opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.local_opportunities (
    id uuid NOT NULL,
    number character varying(48) NOT NULL,
    owner_user_id uuid NOT NULL,
    source_lead_id uuid,
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    customer_name character varying(160) NOT NULL,
    stage character varying(64),
    daily_volume character varying(16),
    monthly_amount numeric(18,2),
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    main_products character varying(4000) DEFAULT ''::character varying NOT NULL,
    country character varying(2) DEFAULT ''::character varying NOT NULL,
    city character varying(120) DEFAULT ''::character varying NOT NULL,
    business_scope character varying(4000) DEFAULT ''::character varying NOT NULL,
    whatsapp character varying(120) DEFAULT ''::character varying NOT NULL,
    store_url character varying(1000) DEFAULT ''::character varying NOT NULL,
    registered_on date DEFAULT ((now() AT TIME ZONE 'Asia/Shanghai'::text))::date NOT NULL,
    last_followed_on date,
    current_follow_up character varying(8000) DEFAULT ''::character varying NOT NULL,
    next_follow_up_plan character varying(8000) DEFAULT ''::character varying NOT NULL,
    problem_feedback character varying(8000) DEFAULT ''::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT chk_local_opportunities_deletion CHECK (((deleted_at IS NULL) = (deleted_by IS NULL))),
    CONSTRAINT local_opportunities_country_check CHECK ((((country)::text = ''::text) OR ((country)::text ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT local_opportunities_currency_check CHECK (((currency)::text = 'USD'::text)),
    CONSTRAINT local_opportunities_customer_name_check CHECK ((length(btrim((customer_name)::text)) > 0)),
    CONSTRAINT local_opportunities_daily_volume_check CHECK (((daily_volume)::text = ANY ((ARRAY['ten'::character varying, 'twenty'::character varying, 'fifty'::character varying, 'more'::character varying])::text[]))),
    CONSTRAINT local_opportunities_monthly_amount_check CHECK (((monthly_amount >= (0)::numeric) AND (monthly_amount <> 'NaN'::numeric))),
    CONSTRAINT local_opportunities_stage_check CHECK (((stage)::text = ANY ((ARRAY['a_a_intentional_cooperation'::character varying, 'f_non-viable_lead'::character varying, 'a_Place_an_order'::character varying, 'b_related_stores'::character varying, 'c_registration_platform'::character varying, 'd_business_opportunity_conflict'::character varying, 'e_terminate_cooperation'::character varying])::text[]))),
    CONSTRAINT local_opportunities_status_check CHECK (((status)::text = 'draft'::text)),
    CONSTRAINT local_opportunities_store_url_check CHECK ((((store_url)::text = ''::text) OR ((store_url)::text ~* '^https?://'::text))),
    CONSTRAINT local_opportunities_version_check CHECK ((version >= 1))
);


--
-- Name: local_opportunity_follow_ups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.local_opportunity_follow_ups (
    id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    followed_on date NOT NULL,
    stage character varying(64) NOT NULL,
    daily_volume character varying(16) NOT NULL,
    monthly_amount numeric(18,2) NOT NULL,
    current_follow_up character varying(8000) NOT NULL,
    next_follow_up_plan character varying(8000) NOT NULL,
    problem_feedback character varying(8000) DEFAULT ''::character varying NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT local_opportunity_follow_ups_current_follow_up_check CHECK ((length(btrim((current_follow_up)::text)) > 0)),
    CONSTRAINT local_opportunity_follow_ups_daily_volume_check CHECK (((daily_volume)::text = ANY ((ARRAY['ten'::character varying, 'twenty'::character varying, 'fifty'::character varying, 'more'::character varying])::text[]))),
    CONSTRAINT local_opportunity_follow_ups_monthly_amount_check CHECK (((monthly_amount >= (0)::numeric) AND (monthly_amount <> 'NaN'::numeric))),
    CONSTRAINT local_opportunity_follow_ups_next_follow_up_plan_check CHECK ((length(btrim((next_follow_up_plan)::text)) > 0)),
    CONSTRAINT local_opportunity_follow_ups_stage_check CHECK (((stage)::text = ANY ((ARRAY['a_a_intentional_cooperation'::character varying, 'f_non-viable_lead'::character varying, 'a_Place_an_order'::character varying, 'b_related_stores'::character varying, 'c_registration_platform'::character varying, 'd_business_opportunity_conflict'::character varying, 'e_terminate_cooperation'::character varying])::text[])))
);


--
-- Name: organization_employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_employees (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    owner_user_id uuid NOT NULL,
    department_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    code character varying(40) NOT NULL,
    email character varying(160) NOT NULL,
    workbench_roles text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id uuid,
    job_title character varying(100) DEFAULT ''::character varying NOT NULL,
    phone character varying(40) DEFAULT ''::character varying NOT NULL,
    archived_at timestamp with time zone,
    directory_profile jsonb,
    CONSTRAINT chk_employee_directory_profile CHECK (((directory_profile IS NULL) OR (jsonb_typeof(directory_profile) = 'object'::text))),
    CONSTRAINT chk_organization_employees_roles CHECK (((workbench_roles <@ ARRAY['sales'::text, 'procurement'::text, 'allocation'::text, 'dispatch'::text, 'warehouse'::text]) AND (cardinality(workbench_roles) <= 5)))
);


--
-- Name: organization_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_nodes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    owner_user_id uuid NOT NULL,
    parent_id uuid,
    name character varying(100) NOT NULL,
    kind character varying(12) NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_organization_nodes_kind CHECK (((((kind)::text = 'organization'::text) AND (parent_id IS NULL)) OR (((kind)::text = 'department'::text) AND (parent_id IS NOT NULL)))),
    CONSTRAINT chk_organization_nodes_name CHECK ((((char_length((name)::text) >= 1) AND (char_length((name)::text) <= 100)) AND ((name)::text !~ '^[[:space:]]|[[:space:]]$'::text))),
    CONSTRAINT chk_organization_nodes_order CHECK (((sort_order >= 0) AND (sort_order <= 99999)))
);


--
-- Name: outreach_draft_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_draft_versions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    conversation_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    outreach_task_id uuid,
    version integer NOT NULL,
    status character varying(24) DEFAULT 'draft'::character varying NOT NULL,
    english_subject character varying(200) DEFAULT ''::character varying NOT NULL,
    english_message text NOT NULL,
    chinese_subject character varying(200) DEFAULT ''::character varying NOT NULL,
    chinese_message text NOT NULL,
    facts_used jsonb DEFAULT '[]'::jsonb NOT NULL,
    missing_facts jsonb DEFAULT '[]'::jsonb NOT NULL,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_outreach_draft_versions_status CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'accepted'::character varying, 'superseded'::character varying])::text[]))),
    CONSTRAINT chk_outreach_draft_versions_version CHECK ((version >= 1))
);


--
-- Name: outreach_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_tasks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    lead_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    team_id uuid,
    channel public.autoflow_outreach_channel_enum NOT NULL,
    status public.autoflow_outreach_status_enum DEFAULT 'draft'::public.autoflow_outreach_status_enum NOT NULL,
    message text NOT NULL,
    next_follow_up_at timestamp with time zone,
    sent_at timestamp with time zone,
    replied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    target_contact character varying(500),
    subject character varying(200),
    template_key character varying(80) DEFAULT 'legacy-first-touch-v1'::character varying NOT NULL,
    template_options jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: quotation_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotation_versions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    quotation_id uuid NOT NULL,
    version integer NOT NULL,
    created_by_user_id uuid NOT NULL,
    request_snapshot jsonb NOT NULL,
    result_snapshot jsonb,
    product_cost_status character varying(24) DEFAULT 'not_requested'::character varying NOT NULL,
    logistics_rate_status character varying(24) DEFAULT 'not_requested'::character varying NOT NULL,
    source_version character varying(120),
    effective_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_quotation_versions_version CHECK ((version > 0))
);


--
-- Name: quotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    owner_user_id uuid NOT NULL,
    lead_id uuid,
    title character varying(160) DEFAULT 'Customer quotation'::character varying NOT NULL,
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    currency character(3) NOT NULL,
    current_version integer DEFAULT 1 NOT NULL,
    valid_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_quotations_current_version CHECK ((current_version > 0)),
    CONSTRAINT chk_quotations_status CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'ready'::character varying, 'expired'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: shopify_stores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shopify_stores (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    workflow_run_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    team_id uuid,
    lead_id uuid,
    name character varying(160) NOT NULL,
    domain character varying(255) NOT NULL,
    normalized_domain character varying(255) NOT NULL,
    url character varying(1000) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    image_url character varying(1000),
    detection_source character varying(80) NOT NULL,
    shopify_confidence double precision DEFAULT 0 NOT NULL,
    traffic jsonb,
    raw_payload jsonb,
    discovered_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    verification_status character varying(24) DEFAULT 'unverified'::character varying NOT NULL,
    verification_evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    verified_at timestamp with time zone,
    contacts jsonb DEFAULT '[]'::jsonb NOT NULL,
    product_url character varying(1000),
    discovery_sources jsonb DEFAULT '[]'::jsonb NOT NULL,
    validity_score double precision DEFAULT 0 NOT NULL,
    CONSTRAINT chk_shopify_stores_confidence CHECK (((shopify_confidence >= (0)::double precision) AND (shopify_confidence <= (100)::double precision))),
    CONSTRAINT chk_shopify_stores_validity_score CHECK (((validity_score >= (0)::double precision) AND (validity_score <= (100)::double precision)))
);


--
-- Name: sourcing_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_offers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    search_id uuid NOT NULL,
    supplier_id uuid,
    owner_user_id uuid NOT NULL,
    workflow_run_id uuid NOT NULL,
    provider character varying(32) DEFAULT 'alibaba_1688'::character varying NOT NULL,
    offer_id character varying(128) NOT NULL,
    offer_url character varying(1000) NOT NULL,
    image_url character varying(1000),
    title character varying(500) NOT NULL,
    title_zh character varying(500),
    title_en character varying(500),
    category_id character varying(128),
    category_name character varying(255),
    minimum_order_quantity numeric(18,4),
    quantity_unit character varying(32),
    price_min numeric(18,4),
    price_max numeric(18,4),
    currency character varying(8) DEFAULT 'USD'::character varying NOT NULL,
    price_tiers jsonb DEFAULT '[]'::jsonb NOT NULL,
    sales_volume bigint,
    repurchase_rate numeric(9,4),
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    sourcing_score double precision DEFAULT 0 NOT NULL,
    sourcing_score_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    retrieved_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    page_number integer DEFAULT 1 NOT NULL,
    rank_in_page integer DEFAULT 1 NOT NULL,
    absolute_rank integer DEFAULT 1 NOT NULL,
    detail_status character varying(24) DEFAULT 'not_requested'::character varying NOT NULL,
    detail_retrieved_at timestamp with time zone,
    score_version character varying(32) DEFAULT 'v1'::character varying NOT NULL,
    score_dimensions jsonb DEFAULT '{}'::jsonb NOT NULL,
    product_fingerprint character varying(64),
    CONSTRAINT chk_sourcing_offers_absolute_rank CHECK ((absolute_rank >= 1)),
    CONSTRAINT chk_sourcing_offers_detail_status CHECK (((detail_status)::text = ANY ((ARRAY['not_requested'::character varying, 'succeeded'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT chk_sourcing_offers_moq CHECK (((minimum_order_quantity IS NULL) OR (minimum_order_quantity >= (0)::numeric))),
    CONSTRAINT chk_sourcing_offers_page_number CHECK ((page_number >= 1)),
    CONSTRAINT chk_sourcing_offers_prices CHECK ((((price_min IS NULL) OR (price_min >= (0)::numeric)) AND ((price_max IS NULL) OR (price_max >= (0)::numeric)) AND ((price_min IS NULL) OR (price_max IS NULL) OR (price_max >= price_min)))),
    CONSTRAINT chk_sourcing_offers_provider CHECK (((provider)::text = 'alibaba_1688'::text)),
    CONSTRAINT chk_sourcing_offers_rank_in_page CHECK ((rank_in_page >= 1)),
    CONSTRAINT chk_sourcing_offers_repurchase_rate CHECK (((repurchase_rate IS NULL) OR (((repurchase_rate)::double precision >= (0)::double precision) AND ((repurchase_rate)::double precision <= (100)::double precision)))),
    CONSTRAINT chk_sourcing_offers_score CHECK (((sourcing_score >= (0)::double precision) AND (sourcing_score <= (100)::double precision)))
);


--
-- Name: sourcing_search_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_search_pages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    search_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    page_number integer NOT NULL,
    page_size integer NOT NULL,
    status character varying(24) DEFAULT 'pending'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_owner character varying(255),
    lease_expires_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    provider_request_id character varying(128),
    provider_trace_id character varying(128),
    result_count integer DEFAULT 0 NOT NULL,
    error_code character varying(80),
    error_message text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cache_hit boolean DEFAULT false NOT NULL,
    cache_source_page_id uuid,
    CONSTRAINT chk_sourcing_search_pages_attempts CHECK (((attempts >= 0) AND (attempts <= max_attempts) AND (max_attempts >= 1))),
    CONSTRAINT chk_sourcing_search_pages_page_number CHECK ((page_number >= 1)),
    CONSTRAINT chk_sourcing_search_pages_page_size CHECK ((page_size = ANY (ARRAY[10, 20, 50]))),
    CONSTRAINT chk_sourcing_search_pages_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'succeeded'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: sourcing_searches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_searches (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    owner_user_id uuid NOT NULL,
    workflow_run_id uuid NOT NULL,
    provider character varying(32) DEFAULT 'alibaba_1688'::character varying NOT NULL,
    search_mode character varying(16) NOT NULL,
    status character varying(24) DEFAULT 'pending'::character varying NOT NULL,
    request_id character varying(128) NOT NULL,
    provider_request_id character varying(128),
    provider_method character varying(160) NOT NULL,
    keyword text,
    image_url character varying(1000),
    request_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_code character varying(80),
    error_message text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    language_code character varying(32) DEFAULT 'en'::character varying NOT NULL,
    image_id character varying(255),
    image_upload_request_id character varying(128),
    image_upload_trace_id character varying(128),
    total_records bigint,
    total_pages integer,
    page_size integer DEFAULT 20 NOT NULL,
    loaded_page_count integer DEFAULT 0 NOT NULL,
    query_fingerprint character varying(128) NOT NULL,
    cache_fingerprint character varying(64),
    result_limit integer DEFAULT 100 NOT NULL,
    CONSTRAINT chk_sourcing_searches_loaded_page_count CHECK ((loaded_page_count >= 0)),
    CONSTRAINT chk_sourcing_searches_mode CHECK (((search_mode)::text = ANY ((ARRAY['keyword'::character varying, 'image'::character varying])::text[]))),
    CONSTRAINT chk_sourcing_searches_page_size CHECK ((page_size = ANY (ARRAY[10, 20, 50]))),
    CONSTRAINT chk_sourcing_searches_provider CHECK (((provider)::text = 'alibaba_1688'::text)),
    CONSTRAINT chk_sourcing_searches_result_limit CHECK (((result_limit >= 100) AND ((result_limit % 100) = 0))),
    CONSTRAINT chk_sourcing_searches_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'succeeded'::character varying, 'partial'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: sourcing_suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sourcing_suppliers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    search_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    workflow_run_id uuid NOT NULL,
    provider character varying(32) DEFAULT 'alibaba_1688'::character varying NOT NULL,
    supplier_key character varying(255) NOT NULL,
    member_id character varying(128),
    open_id character varying(128),
    company_name character varying(255),
    shop_name character varying(255),
    shop_url character varying(1000),
    supplier_rating numeric(9,4),
    years_in_business integer,
    capabilities jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_sourcing_suppliers_provider CHECK (((provider)::text = 'alibaba_1688'::text)),
    CONSTRAINT chk_sourcing_suppliers_rating CHECK (((supplier_rating IS NULL) OR (((supplier_rating)::double precision >= (0)::double precision) AND ((supplier_rating)::double precision <= (100)::double precision)))),
    CONSTRAINT chk_sourcing_suppliers_years CHECK (((years_in_business IS NULL) OR (years_in_business >= 0)))
);


--
-- Name: typeorm_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.typeorm_migrations (
    id integer NOT NULL,
    "timestamp" bigint NOT NULL,
    name character varying NOT NULL
);


--
-- Name: typeorm_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.typeorm_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: typeorm_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.typeorm_migrations_id_seq OWNED BY public.typeorm_migrations.id;


--
-- Name: users_display_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_display_id_seq
    START WITH 2
    INCREMENT BY 1
    MINVALUE 2
    MAXVALUE 999999
    CACHE 1;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying NOT NULL,
    password character varying NOT NULL,
    username character varying NOT NULL,
    avatar_url character varying,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    role public.users_role_enum DEFAULT 'user'::public.users_role_enum NOT NULL,
    display_id character varying(6) DEFAULT lpad((nextval('public.users_display_id_seq'::regclass))::text, 6, '0'::text) NOT NULL,
    next_workflow_number integer DEFAULT 1 NOT NULL,
    workbench_roles text[] DEFAULT ARRAY['sales'::text] NOT NULL,
    fop_tenant_id character varying(128),
    fop_user_id character varying(128),
    business_role character varying(24) DEFAULT 'salesperson'::character varying NOT NULL,
    business_department_id character varying(128),
    business_employee_id character varying(128),
    chart_permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    account_disabled boolean DEFAULT false NOT NULL,
    session_version integer DEFAULT 0 NOT NULL,
    organization_workspace_owner_id uuid,
    fop_binding_details jsonb,
    data_display_scope character varying(16) DEFAULT 'self'::character varying NOT NULL,
    CONSTRAINT chk_users_business_ids CHECK ((((business_department_id IS NULL) OR ((char_length((business_department_id)::text) > 0) AND ((business_department_id)::text = btrim((business_department_id)::text)))) AND ((business_employee_id IS NULL) OR ((char_length((business_employee_id)::text) > 0) AND ((business_employee_id)::text = btrim((business_employee_id)::text)))))),
    CONSTRAINT chk_users_business_role CHECK (((business_role)::text = ANY ((ARRAY['none'::character varying, 'admin'::character varying, 'department_manager'::character varying, 'salesperson'::character varying])::text[]))),
    CONSTRAINT chk_users_chart_permissions CHECK (public.autoflow_valid_chart_permissions(chart_permissions)),
    CONSTRAINT chk_users_data_display_scope CHECK (((data_display_scope)::text = ANY ((ARRAY['department'::character varying, 'self'::character varying])::text[]))),
    CONSTRAINT chk_users_display_id CHECK (((display_id)::text ~ '^[0-9]{6}$'::text)),
    CONSTRAINT chk_users_fop_identity CHECK ((((fop_tenant_id IS NULL) AND (fop_user_id IS NULL)) OR ((fop_tenant_id IS NOT NULL) AND (fop_user_id IS NOT NULL) AND ((char_length((fop_tenant_id)::text) >= 1) AND (char_length((fop_tenant_id)::text) <= 128)) AND ((char_length((fop_user_id)::text) >= 1) AND (char_length((fop_user_id)::text) <= 128)) AND ((fop_tenant_id)::text !~ '^[[:space:]]|[[:space:]]$'::text) AND ((fop_user_id)::text !~ '^[[:space:]]|[[:space:]]$'::text)))),
    CONSTRAINT chk_users_next_workflow_number CHECK (((next_workflow_number >= 1) AND (next_workflow_number <= 1000000))),
    CONSTRAINT chk_users_verified_fop_binding CHECK (((fop_binding_details IS NULL) OR (((fop_tenant_id IS NOT NULL) AND (fop_user_id IS NOT NULL) AND (jsonb_typeof(fop_binding_details) = 'object'::text) AND (fop_binding_details ?& ARRAY['username'::text, 'name'::text, 'employeeRecordId'::text, 'employeeMasterId'::text, 'departmentId'::text, 'organizationId'::text, 'localEmployeeId'::text, 'localDepartmentId'::text, 'verifiedAt'::text]) AND ((length((fop_binding_details ->> 'username'::text)) >= 1) AND (length((fop_binding_details ->> 'username'::text)) <= 128)) AND ((fop_binding_details ->> 'employeeRecordId'::text) ~ '^[1-9][0-9]{0,18}$'::text) AND ((fop_binding_details ->> 'employeeMasterId'::text) ~ '^[1-9][0-9]{0,18}$'::text) AND ((fop_binding_details ->> 'departmentId'::text) ~ '^[1-9][0-9]{0,18}$'::text) AND ((fop_binding_details ->> 'organizationId'::text) ~ '^[1-9][0-9]{0,18}$'::text)) IS TRUE))),
    CONSTRAINT chk_users_workbench_roles CHECK (((workbench_roles <@ ARRAY['sales'::text, 'procurement'::text, 'allocation'::text, 'dispatch'::text, 'warehouse'::text]) AND (cardinality(workbench_roles) = ((((
CASE
    WHEN ('sales'::text = ANY (workbench_roles)) THEN 1
    ELSE 0
END +
CASE
    WHEN ('procurement'::text = ANY (workbench_roles)) THEN 1
    ELSE 0
END) +
CASE
    WHEN ('allocation'::text = ANY (workbench_roles)) THEN 1
    ELSE 0
END) +
CASE
    WHEN ('dispatch'::text = ANY (workbench_roles)) THEN 1
    ELSE 0
END) +
CASE
    WHEN ('warehouse'::text = ANY (workbench_roles)) THEN 1
    ELSE 0
END)))),
    CONSTRAINT users_session_version_check CHECK ((session_version >= 0))
);


--
-- Name: workflow_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_jobs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    workflow_run_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    status public.autoflow_workflow_job_status_enum DEFAULT 'queued'::public.autoflow_workflow_job_status_enum NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_owner character varying(160),
    lease_expires_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    last_error text,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_workflow_jobs_attempts CHECK (((attempts >= 0) AND (max_attempts > 0) AND (attempts <= max_attempts)))
);


--
-- Name: workflow_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_leads (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    workflow_run_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    source character varying(120) NOT NULL,
    source_reference character varying(500),
    source_score double precision DEFAULT 0 NOT NULL,
    metadata jsonb,
    discovered_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_workflow_leads_source_score CHECK (((source_score >= (0)::double precision) AND (source_score <= (100)::double precision)))
);


--
-- Name: workflow_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_runs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    owner_user_id uuid NOT NULL,
    team_id uuid,
    name character varying(120) NOT NULL,
    seed_type public.autoflow_seed_type_enum NOT NULL,
    seed_value character varying(500) NOT NULL,
    target_market character varying(80) DEFAULT 'United States'::character varying NOT NULL,
    status public.autoflow_workflow_status_enum DEFAULT 'draft'::public.autoflow_workflow_status_enum NOT NULL,
    current_stage public.autoflow_workflow_stage_enum DEFAULT 'seed'::public.autoflow_workflow_stage_enum NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    lead_count integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_options jsonb DEFAULT '{"titleMatch": false, "exactPhrase": true, "findOwnerFacebook": true, "excludeMarketplaces": true}'::jsonb NOT NULL,
    parent_workflow_run_id uuid,
    root_workflow_run_id uuid,
    revision_no integer DEFAULT 1 NOT NULL,
    archived_at timestamp with time zone,
    display_id character varying(6) NOT NULL,
    seed_asset_path character varying(1000),
    seed_asset_mime_type character varying(64),
    seed_asset_size bigint,
    seed_asset_sha256 character varying(64),
    CONSTRAINT chk_workflow_runs_display_id CHECK ((((display_id)::text ~ '^[0-9]{2,6}$'::text) AND (((display_id)::integer >= 1) AND ((display_id)::integer <= 999999)))),
    CONSTRAINT chk_workflow_runs_progress CHECK (((progress >= 0) AND (progress <= 100))),
    CONSTRAINT chk_workflow_runs_revision_no CHECK ((revision_no >= 1))
);


--
-- Name: workflow_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_steps (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    workflow_run_id uuid NOT NULL,
    stage public.autoflow_workflow_stage_enum NOT NULL,
    status public.autoflow_workflow_step_status_enum DEFAULT 'pending'::public.autoflow_workflow_step_status_enum NOT NULL,
    sequence integer NOT NULL,
    input jsonb,
    output jsonb,
    error_message text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: typeorm_migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.typeorm_migrations ALTER COLUMN id SET DEFAULT nextval('public.typeorm_migrations_id_seq'::regclass);


--
-- Name: typeorm_migrations PK_bb2f075707dd300ba86d0208923; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.typeorm_migrations
    ADD CONSTRAINT "PK_bb2f075707dd300ba86d0208923" PRIMARY KEY (id);


--
-- Name: hz_fop_bootstrap_pages hz_fop_bootstrap_pages_batch_id_stream_id_page_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_bootstrap_pages
    ADD CONSTRAINT hz_fop_bootstrap_pages_batch_id_stream_id_page_index_key UNIQUE (batch_id, stream_id, page_index);


--
-- Name: hz_fop_bootstrap_pages hz_fop_bootstrap_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_bootstrap_pages
    ADD CONSTRAINT hz_fop_bootstrap_pages_pkey PRIMARY KEY (id);


--
-- Name: hz_fop_collected_analytics_facts hz_fop_collected_analytics_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_collected_analytics_facts
    ADD CONSTRAINT hz_fop_collected_analytics_facts_pkey PRIMARY KEY (batch_id, entity_type, source_id);


--
-- Name: hz_fop_collected_batches hz_fop_collected_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_collected_batches
    ADD CONSTRAINT hz_fop_collected_batches_pkey PRIMARY KEY (id);


--
-- Name: hz_fop_collected_chains hz_fop_collected_chains_dataset_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_collected_chains
    ADD CONSTRAINT hz_fop_collected_chains_dataset_id_key UNIQUE (dataset_id);


--
-- Name: hz_fop_collected_chains hz_fop_collected_chains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_collected_chains
    ADD CONSTRAINT hz_fop_collected_chains_pkey PRIMARY KEY (batch_id);


--
-- Name: hz_fop_collected_customer_registrations hz_fop_collected_customer_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_collected_customer_registrations
    ADD CONSTRAINT hz_fop_collected_customer_registrations_pkey PRIMARY KEY (batch_id, source_id);


--
-- Name: hz_fop_collected_entities hz_fop_collected_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_collected_entities
    ADD CONSTRAINT hz_fop_collected_entities_pkey PRIMARY KEY (batch_id, entity_type, source_id);


--
-- Name: hz_fop_collected_orders hz_fop_collected_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_collected_orders
    ADD CONSTRAINT hz_fop_collected_orders_pkey PRIMARY KEY (batch_id, source_id);


--
-- Name: hz_fop_collected_stock_consumptions hz_fop_collected_stock_consumptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_collected_stock_consumptions
    ADD CONSTRAINT hz_fop_collected_stock_consumptions_pkey PRIMARY KEY (batch_id, stock_id, record_id);


--
-- Name: hz_fop_exception_dirty hz_fop_exception_dirty_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_exception_dirty
    ADD CONSTRAINT hz_fop_exception_dirty_pkey PRIMARY KEY (batch_id, transaction_id, document_kind, source_id);


--
-- Name: hz_fop_exception_versions hz_fop_exception_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_exception_versions
    ADD CONSTRAINT hz_fop_exception_versions_pkey PRIMARY KEY (batch_id);


--
-- Name: hz_fop_order_relation_paths hz_fop_order_relation_paths_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_relation_paths
    ADD CONSTRAINT hz_fop_order_relation_paths_pkey PRIMARY KEY (company_id, dataset_id, order_document_id, relation_id);


--
-- Name: hz_fop_relation_dirty_sources hz_fop_relation_dirty_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_relation_dirty_sources
    ADD CONSTRAINT hz_fop_relation_dirty_sources_pkey PRIMARY KEY (batch_id, entity_code, source_id);


--
-- Name: hz_fop_relation_refresh hz_fop_relation_refresh_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_relation_refresh
    ADD CONSTRAINT hz_fop_relation_refresh_pkey PRIMARY KEY (batch_id, root_kind, root_id);


--
-- Name: hz_fop_timestamp_documents hz_fop_timestamp_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_timestamp_documents
    ADD CONSTRAINT hz_fop_timestamp_documents_pkey PRIMARY KEY (batch_id, entity_code, source_id);


--
-- Name: hz_fop_timestamp_pages hz_fop_timestamp_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_timestamp_pages
    ADD CONSTRAINT hz_fop_timestamp_pages_pkey PRIMARY KEY (run_id, page_index);


--
-- Name: hz_fop_timestamp_projection_tasks hz_fop_timestamp_projection_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_timestamp_projection_tasks
    ADD CONSTRAINT hz_fop_timestamp_projection_tasks_pkey PRIMARY KEY (batch_id, entity_code, source_id);


--
-- Name: hz_fop_timestamp_runs hz_fop_timestamp_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_timestamp_runs
    ADD CONSTRAINT hz_fop_timestamp_runs_pkey PRIMARY KEY (id);


--
-- Name: hz_fop_timestamp_state hz_fop_timestamp_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_timestamp_state
    ADD CONSTRAINT hz_fop_timestamp_state_pkey PRIMARY KEY (batch_id, entity_code);


--
-- Name: hz_fop_workbench_receipt_notices hz_fop_workbench_receipt_notices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_receipt_notices
    ADD CONSTRAINT hz_fop_workbench_receipt_notices_pkey PRIMARY KEY (document_id);


--
-- Name: local_opportunities local_opportunities_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_opportunities
    ADD CONSTRAINT local_opportunities_number_key UNIQUE (number);


--
-- Name: local_opportunities local_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_opportunities
    ADD CONSTRAINT local_opportunities_pkey PRIMARY KEY (id);


--
-- Name: local_opportunity_follow_ups local_opportunity_follow_ups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_opportunity_follow_ups
    ADD CONSTRAINT local_opportunity_follow_ups_pkey PRIMARY KEY (id);


--
-- Name: organization_employees organization_employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_employees
    ADD CONSTRAINT organization_employees_pkey PRIMARY KEY (id);


--
-- Name: organization_nodes organization_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_nodes
    ADD CONSTRAINT organization_nodes_pkey PRIMARY KEY (id);


--
-- Name: ad_creatives pk_ad_creatives; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_creatives
    ADD CONSTRAINT pk_ad_creatives PRIMARY KEY (id);


--
-- Name: ai_outreach_conversations pk_ai_outreach_conversations; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_outreach_conversations
    ADD CONSTRAINT pk_ai_outreach_conversations PRIMARY KEY (id);


--
-- Name: ai_outreach_messages pk_ai_outreach_messages; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_outreach_messages
    ADD CONSTRAINT pk_ai_outreach_messages PRIMARY KEY (id);


--
-- Name: ai_prompt_bindings pk_ai_prompt_bindings; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_prompt_bindings
    ADD CONSTRAINT pk_ai_prompt_bindings PRIMARY KEY (id);


--
-- Name: ai_prompt_templates pk_ai_prompt_templates; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_prompt_templates
    ADD CONSTRAINT pk_ai_prompt_templates PRIMARY KEY (id);


--
-- Name: audit_events pk_audit_events; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT pk_audit_events PRIMARY KEY (id);


--
-- Name: crm_activities pk_crm_activities; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT pk_crm_activities PRIMARY KEY (id);


--
-- Name: fop_handoffs pk_fop_handoffs; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fop_handoffs
    ADD CONSTRAINT pk_fop_handoffs PRIMARY KEY (id);


--
-- Name: hz_fop_action_requests pk_hz_fop_action_requests_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_action_requests
    ADD CONSTRAINT pk_hz_fop_action_requests_id PRIMARY KEY (id);


--
-- Name: hz_fop_action_targets pk_hz_fop_action_targets_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_action_targets
    ADD CONSTRAINT pk_hz_fop_action_targets_id PRIMARY KEY (id);


--
-- Name: hz_fop_allocation_line_details pk_hz_fop_allocation_line_details_line_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_allocation_line_details
    ADD CONSTRAINT pk_hz_fop_allocation_line_details_line_id PRIMARY KEY (line_id);


--
-- Name: hz_fop_allocations pk_hz_fop_allocations_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_allocations
    ADD CONSTRAINT pk_hz_fop_allocations_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_bootstrap_batches pk_hz_fop_bootstrap_batches_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_bootstrap_batches
    ADD CONSTRAINT pk_hz_fop_bootstrap_batches_id PRIMARY KEY (id);


--
-- Name: hz_fop_companies pk_hz_fop_companies_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_companies
    ADD CONSTRAINT pk_hz_fop_companies_id PRIMARY KEY (id);


--
-- Name: hz_fop_connections pk_hz_fop_connections_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_connections
    ADD CONSTRAINT pk_hz_fop_connections_id PRIMARY KEY (id);


--
-- Name: hz_fop_datasets pk_hz_fop_datasets_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_datasets
    ADD CONSTRAINT pk_hz_fop_datasets_id PRIMARY KEY (id);


--
-- Name: hz_fop_delivery_notices pk_hz_fop_delivery_notices_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_delivery_notices
    ADD CONSTRAINT pk_hz_fop_delivery_notices_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_dispatches pk_hz_fop_dispatches_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_dispatches
    ADD CONSTRAINT pk_hz_fop_dispatches_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_document_packages pk_hz_fop_document_packages_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_packages
    ADD CONSTRAINT pk_hz_fop_document_packages_id PRIMARY KEY (id);


--
-- Name: hz_fop_document_relations pk_hz_fop_document_relations_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_relations
    ADD CONSTRAINT pk_hz_fop_document_relations_id PRIMARY KEY (id);


--
-- Name: hz_fop_employee_bindings pk_hz_fop_employee_bindings_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_employee_bindings
    ADD CONSTRAINT pk_hz_fop_employee_bindings_id PRIMARY KEY (id);


--
-- Name: hz_fop_exception_marks pk_hz_fop_exception_marks_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_exception_marks
    ADD CONSTRAINT pk_hz_fop_exception_marks_id PRIMARY KEY (id);


--
-- Name: hz_fop_export_items pk_hz_fop_export_items_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_export_items
    ADD CONSTRAINT pk_hz_fop_export_items_id PRIMARY KEY (id);


--
-- Name: hz_fop_export_jobs pk_hz_fop_export_jobs_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_export_jobs
    ADD CONSTRAINT pk_hz_fop_export_jobs_id PRIMARY KEY (id);


--
-- Name: hz_fop_financial_line_details pk_hz_fop_financial_line_details_line_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_financial_line_details
    ADD CONSTRAINT pk_hz_fop_financial_line_details_line_id PRIMARY KEY (line_id);


--
-- Name: hz_fop_fulfillment_orders pk_hz_fop_fulfillment_orders_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_fulfillment_orders
    ADD CONSTRAINT pk_hz_fop_fulfillment_orders_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_inbound_bills pk_hz_fop_inbound_bills_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_inbound_bills
    ADD CONSTRAINT pk_hz_fop_inbound_bills_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_inventory_balances pk_hz_fop_inventory_balances_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_inventory_balances
    ADD CONSTRAINT pk_hz_fop_inventory_balances_id PRIMARY KEY (id);


--
-- Name: hz_fop_inventory_line_details pk_hz_fop_inventory_line_details_line_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_inventory_line_details
    ADD CONSTRAINT pk_hz_fop_inventory_line_details_line_id PRIMARY KEY (line_id);


--
-- Name: hz_fop_order_flags pk_hz_fop_order_flags_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_flags
    ADD CONSTRAINT pk_hz_fop_order_flags_id PRIMARY KEY (id);


--
-- Name: hz_fop_order_line_details pk_hz_fop_order_line_details_line_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_line_details
    ADD CONSTRAINT pk_hz_fop_order_line_details_line_id PRIMARY KEY (line_id);


--
-- Name: hz_fop_order_packages pk_hz_fop_order_packages_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_packages
    ADD CONSTRAINT pk_hz_fop_order_packages_id PRIMARY KEY (id);


--
-- Name: hz_fop_outbound_bills pk_hz_fop_outbound_bills_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_outbound_bills
    ADD CONSTRAINT pk_hz_fop_outbound_bills_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_package_lines pk_hz_fop_package_lines_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_package_lines
    ADD CONSTRAINT pk_hz_fop_package_lines_id PRIMARY KEY (id);


--
-- Name: hz_fop_payments pk_hz_fop_payments_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_payments
    ADD CONSTRAINT pk_hz_fop_payments_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_platform_orders pk_hz_fop_platform_orders_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_platform_orders
    ADD CONSTRAINT pk_hz_fop_platform_orders_id PRIMARY KEY (id);


--
-- Name: hz_fop_procurement_line_details pk_hz_fop_procurement_line_details_line_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_procurement_line_details
    ADD CONSTRAINT pk_hz_fop_procurement_line_details_line_id PRIMARY KEY (line_id);


--
-- Name: hz_fop_projection_dependencies pk_hz_fop_projection_dependencies_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_projection_dependencies
    ADD CONSTRAINT pk_hz_fop_projection_dependencies_id PRIMARY KEY (id);


--
-- Name: hz_fop_purchase_orders pk_hz_fop_purchase_orders_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_purchase_orders
    ADD CONSTRAINT pk_hz_fop_purchase_orders_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_purchase_requisitions pk_hz_fop_purchase_requisitions_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_purchase_requisitions
    ADD CONSTRAINT pk_hz_fop_purchase_requisitions_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_purchase_returns pk_hz_fop_purchase_returns_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_purchase_returns
    ADD CONSTRAINT pk_hz_fop_purchase_returns_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_receipt_adjustments pk_hz_fop_receipt_adjustments_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_receipt_adjustments
    ADD CONSTRAINT pk_hz_fop_receipt_adjustments_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_receipt_notices pk_hz_fop_receipt_notices_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_receipt_notices
    ADD CONSTRAINT pk_hz_fop_receipt_notices_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_receipts pk_hz_fop_receipts_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_receipts
    ADD CONSTRAINT pk_hz_fop_receipts_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_reconciliation_runs pk_hz_fop_reconciliation_runs_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_reconciliation_runs
    ADD CONSTRAINT pk_hz_fop_reconciliation_runs_id PRIMARY KEY (id);


--
-- Name: hz_fop_reference_items pk_hz_fop_reference_items_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_reference_items
    ADD CONSTRAINT pk_hz_fop_reference_items_id PRIMARY KEY (id);


--
-- Name: hz_fop_refresh_requests pk_hz_fop_refresh_requests_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_refresh_requests
    ADD CONSTRAINT pk_hz_fop_refresh_requests_id PRIMARY KEY (id);


--
-- Name: hz_fop_resource_grants pk_hz_fop_resource_grants_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_resource_grants
    ADD CONSTRAINT pk_hz_fop_resource_grants_id PRIMARY KEY (id);


--
-- Name: hz_fop_return_line_details pk_hz_fop_return_line_details_line_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_return_line_details
    ADD CONSTRAINT pk_hz_fop_return_line_details_line_id PRIMARY KEY (line_id);


--
-- Name: hz_fop_rma_orders pk_hz_fop_rma_orders_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_rma_orders
    ADD CONSTRAINT pk_hz_fop_rma_orders_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_source_documents pk_hz_fop_source_documents_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_source_documents
    ADD CONSTRAINT pk_hz_fop_source_documents_id PRIMARY KEY (id);


--
-- Name: hz_fop_source_lines pk_hz_fop_source_lines_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_source_lines
    ADD CONSTRAINT pk_hz_fop_source_lines_id PRIMARY KEY (id);


--
-- Name: hz_fop_stock_consumptions pk_hz_fop_stock_consumptions_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_stock_consumptions
    ADD CONSTRAINT pk_hz_fop_stock_consumptions_id PRIMARY KEY (id);


--
-- Name: hz_fop_stock_orders pk_hz_fop_stock_orders_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_stock_orders
    ADD CONSTRAINT pk_hz_fop_stock_orders_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_sync_barriers pk_hz_fop_sync_barriers_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_barriers
    ADD CONSTRAINT pk_hz_fop_sync_barriers_id PRIMARY KEY (id);


--
-- Name: hz_fop_sync_commit_groups pk_hz_fop_sync_commit_groups_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_commit_groups
    ADD CONSTRAINT pk_hz_fop_sync_commit_groups_id PRIMARY KEY (id);


--
-- Name: hz_fop_sync_event_requirements pk_hz_fop_sync_event_requirements_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_event_requirements
    ADD CONSTRAINT pk_hz_fop_sync_event_requirements_id PRIMARY KEY (id);


--
-- Name: hz_fop_sync_events pk_hz_fop_sync_events_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_events
    ADD CONSTRAINT pk_hz_fop_sync_events_id PRIMARY KEY (id);


--
-- Name: hz_fop_sync_issues pk_hz_fop_sync_issues_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_issues
    ADD CONSTRAINT pk_hz_fop_sync_issues_id PRIMARY KEY (id);


--
-- Name: hz_fop_sync_runs pk_hz_fop_sync_runs_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_runs
    ADD CONSTRAINT pk_hz_fop_sync_runs_id PRIMARY KEY (id);


--
-- Name: hz_fop_sync_streams pk_hz_fop_sync_streams_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_streams
    ADD CONSTRAINT pk_hz_fop_sync_streams_id PRIMARY KEY (id);


--
-- Name: hz_fop_sync_tasks pk_hz_fop_sync_tasks_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_tasks
    ADD CONSTRAINT pk_hz_fop_sync_tasks_id PRIMARY KEY (id);


--
-- Name: hz_fop_tracking_events pk_hz_fop_tracking_events_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_tracking_events
    ADD CONSTRAINT pk_hz_fop_tracking_events_id PRIMARY KEY (id);


--
-- Name: hz_fop_tracking_numbers pk_hz_fop_tracking_numbers_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_tracking_numbers
    ADD CONSTRAINT pk_hz_fop_tracking_numbers_id PRIMARY KEY (id);


--
-- Name: hz_fop_workbench_memberships pk_hz_fop_workbench_memberships_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_memberships
    ADD CONSTRAINT pk_hz_fop_workbench_memberships_id PRIMARY KEY (id);


--
-- Name: hz_fop_workbench_order_lines pk_hz_fop_workbench_order_lines_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_order_lines
    ADD CONSTRAINT pk_hz_fop_workbench_order_lines_id PRIMARY KEY (id);


--
-- Name: hz_fop_workbench_orders pk_hz_fop_workbench_orders_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_orders
    ADD CONSTRAINT pk_hz_fop_workbench_orders_document_id PRIMARY KEY (document_id);


--
-- Name: hz_fop_workbench_procurement_demands pk_hz_fop_workbench_procurement_demands_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_procurement_demands
    ADD CONSTRAINT pk_hz_fop_workbench_procurement_demands_id PRIMARY KEY (id);


--
-- Name: hz_fop_workbench_purchase_allocations pk_hz_fop_workbench_purchase_allocations_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_purchase_allocations
    ADD CONSTRAINT pk_hz_fop_workbench_purchase_allocations_id PRIMARY KEY (id);


--
-- Name: lead_contacts pk_lead_contacts; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_contacts
    ADD CONSTRAINT pk_lead_contacts PRIMARY KEY (id);


--
-- Name: lead_scores pk_lead_scores; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_scores
    ADD CONSTRAINT pk_lead_scores PRIMARY KEY (id);


--
-- Name: leads pk_leads; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT pk_leads PRIMARY KEY (id);


--
-- Name: outreach_draft_versions pk_outreach_draft_versions; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_draft_versions
    ADD CONSTRAINT pk_outreach_draft_versions PRIMARY KEY (id);


--
-- Name: outreach_tasks pk_outreach_tasks; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_tasks
    ADD CONSTRAINT pk_outreach_tasks PRIMARY KEY (id);


--
-- Name: quotation_versions pk_quotation_versions; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_versions
    ADD CONSTRAINT pk_quotation_versions PRIMARY KEY (id);


--
-- Name: quotations pk_quotations; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT pk_quotations PRIMARY KEY (id);


--
-- Name: shopify_stores pk_shopify_stores; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopify_stores
    ADD CONSTRAINT pk_shopify_stores PRIMARY KEY (id);


--
-- Name: sourcing_offers pk_sourcing_offers; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_offers
    ADD CONSTRAINT pk_sourcing_offers PRIMARY KEY (id);


--
-- Name: sourcing_search_pages pk_sourcing_search_pages; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_search_pages
    ADD CONSTRAINT pk_sourcing_search_pages PRIMARY KEY (id);


--
-- Name: sourcing_searches pk_sourcing_searches; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_searches
    ADD CONSTRAINT pk_sourcing_searches PRIMARY KEY (id);


--
-- Name: sourcing_suppliers pk_sourcing_suppliers; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_suppliers
    ADD CONSTRAINT pk_sourcing_suppliers PRIMARY KEY (id);


--
-- Name: users pk_users; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT pk_users PRIMARY KEY (id);


--
-- Name: workflow_jobs pk_workflow_jobs; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_jobs
    ADD CONSTRAINT pk_workflow_jobs PRIMARY KEY (id);


--
-- Name: workflow_leads pk_workflow_leads; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_leads
    ADD CONSTRAINT pk_workflow_leads PRIMARY KEY (id);


--
-- Name: workflow_runs pk_workflow_runs; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT pk_workflow_runs PRIMARY KEY (id);


--
-- Name: workflow_steps pk_workflow_steps; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steps
    ADD CONSTRAINT pk_workflow_steps PRIMARY KEY (id);


--
-- Name: ad_creatives uq_ad_creatives_run_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_creatives
    ADD CONSTRAINT uq_ad_creatives_run_provider_key UNIQUE (workflow_run_id, provider, deduplication_key);


--
-- Name: ai_outreach_messages uq_ai_outreach_messages_conversation_sequence; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_outreach_messages
    ADD CONSTRAINT uq_ai_outreach_messages_conversation_sequence UNIQUE (conversation_id, sequence);


--
-- Name: ai_prompt_bindings uq_ai_prompt_bindings_owner_module; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_prompt_bindings
    ADD CONSTRAINT uq_ai_prompt_bindings_owner_module UNIQUE (owner_user_id, module_key);


--
-- Name: fop_handoffs uq_fop_handoffs_idempotency_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fop_handoffs
    ADD CONSTRAINT uq_fop_handoffs_idempotency_key UNIQUE (idempotency_key);


--
-- Name: fop_handoffs uq_fop_handoffs_lead; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fop_handoffs
    ADD CONSTRAINT uq_fop_handoffs_lead UNIQUE (lead_id);


--
-- Name: lead_contacts uq_lead_contacts_lead_type_value; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_contacts
    ADD CONSTRAINT uq_lead_contacts_lead_type_value UNIQUE (lead_id, type, value);


--
-- Name: organization_employees uq_organization_employees_owner_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_employees
    ADD CONSTRAINT uq_organization_employees_owner_code UNIQUE (owner_user_id, code);


--
-- Name: organization_nodes uq_organization_nodes_owner_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_nodes
    ADD CONSTRAINT uq_organization_nodes_owner_id UNIQUE (id, owner_user_id);


--
-- Name: outreach_draft_versions uq_outreach_draft_versions_conversation_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_draft_versions
    ADD CONSTRAINT uq_outreach_draft_versions_conversation_version UNIQUE (conversation_id, version);


--
-- Name: quotation_versions uq_quotation_versions_quote_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_versions
    ADD CONSTRAINT uq_quotation_versions_quote_version UNIQUE (quotation_id, version);


--
-- Name: shopify_stores uq_shopify_stores_run_domain; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopify_stores
    ADD CONSTRAINT uq_shopify_stores_run_domain UNIQUE (workflow_run_id, normalized_domain);


--
-- Name: sourcing_offers uq_sourcing_offers_search_provider_offer; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_offers
    ADD CONSTRAINT uq_sourcing_offers_search_provider_offer UNIQUE (search_id, provider, offer_id);


--
-- Name: sourcing_search_pages uq_sourcing_search_pages_search_page; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_search_pages
    ADD CONSTRAINT uq_sourcing_search_pages_search_page UNIQUE (search_id, page_number);


--
-- Name: sourcing_searches uq_sourcing_searches_owner_request; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_searches
    ADD CONSTRAINT uq_sourcing_searches_owner_request UNIQUE (owner_user_id, request_id);


--
-- Name: sourcing_suppliers uq_sourcing_suppliers_search_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_suppliers
    ADD CONSTRAINT uq_sourcing_suppliers_search_provider_key UNIQUE (search_id, provider, supplier_key);


--
-- Name: users uq_users_display_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_display_id UNIQUE (display_id);


--
-- Name: users uq_users_email; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_email UNIQUE (email);


--
-- Name: users uq_users_fop_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_fop_identity UNIQUE (fop_tenant_id, fop_user_id);


--
-- Name: users uq_users_username; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_username UNIQUE (username);


--
-- Name: workflow_jobs uq_workflow_jobs_workflow_run; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_jobs
    ADD CONSTRAINT uq_workflow_jobs_workflow_run UNIQUE (workflow_run_id);


--
-- Name: workflow_leads uq_workflow_leads_run_lead; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_leads
    ADD CONSTRAINT uq_workflow_leads_run_lead UNIQUE (workflow_run_id, lead_id);


--
-- Name: workflow_runs uq_workflow_runs_owner_display_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT uq_workflow_runs_owner_display_id UNIQUE (owner_user_id, display_id);


--
-- Name: workflow_steps uq_workflow_steps_run_stage; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steps
    ADD CONSTRAINT uq_workflow_steps_run_stage UNIQUE (workflow_run_id, stage);


--
-- Name: hz_api_relation_nodes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hz_api_relation_nodes ON public.hz_fop_collected_entities USING gin (((raw -> 'bills'::text))) WHERE (entity_type = 'api_bill_relations'::text);


--
-- Name: hz_collected_allocation_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hz_collected_allocation_parent_idx ON public.hz_fop_collected_entities USING btree (batch_id, ((display ->> 'sourceOrderId'::text))) WHERE (entity_type = 'allocation'::text);


--
-- Name: hz_fop_collected_entities_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hz_fop_collected_entities_owner ON public.hz_fop_collected_entities USING btree (batch_id, entity_type, owner_employee_id);


--
-- Name: hz_fop_relation_refresh_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hz_fop_relation_refresh_due ON public.hz_fop_relation_refresh USING btree (batch_id, next_attempt_at, updated_at);


--
-- Name: idx_ad_creatives_owner_discovered_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_creatives_owner_discovered_at ON public.ad_creatives USING btree (owner_user_id, discovered_at);


--
-- Name: idx_ad_creatives_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_creatives_team_id ON public.ad_creatives USING btree (team_id);


--
-- Name: idx_ad_creatives_workflow_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_creatives_workflow_run_id ON public.ad_creatives USING btree (workflow_run_id);


--
-- Name: idx_ai_outreach_conversations_lead_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_outreach_conversations_lead_updated ON public.ai_outreach_conversations USING btree (lead_id, updated_at);


--
-- Name: idx_ai_outreach_conversations_owner_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_outreach_conversations_owner_updated ON public.ai_outreach_conversations USING btree (owner_user_id, updated_at);


--
-- Name: idx_ai_outreach_messages_conversation_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_outreach_messages_conversation_created ON public.ai_outreach_messages USING btree (conversation_id, created_at);


--
-- Name: idx_ai_prompt_templates_owner_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_prompt_templates_owner_module ON public.ai_prompt_templates USING btree (owner_user_id, module_key);


--
-- Name: idx_audit_events_action_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_action_created_at ON public.audit_events USING btree (action, created_at);


--
-- Name: idx_audit_events_actor_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_actor_created_at ON public.audit_events USING btree (actor_user_id, created_at);


--
-- Name: idx_audit_events_correlation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_correlation_id ON public.audit_events USING btree (correlation_id);


--
-- Name: idx_crm_activities_lead_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_activities_lead_occurred_at ON public.crm_activities USING btree (lead_id, occurred_at);


--
-- Name: idx_crm_activities_next_follow_up_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_activities_next_follow_up_at ON public.crm_activities USING btree (next_follow_up_at);


--
-- Name: idx_crm_activities_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_activities_owner_id ON public.crm_activities USING btree (owner_user_id);


--
-- Name: idx_crm_activities_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_activities_team_id ON public.crm_activities USING btree (team_id);


--
-- Name: idx_crm_activities_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_activities_type ON public.crm_activities USING btree (type);


--
-- Name: idx_fop_handoffs_owner_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fop_handoffs_owner_updated_at ON public.fop_handoffs USING btree (owner_user_id, updated_at);


--
-- Name: idx_fop_handoffs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fop_handoffs_status ON public.fop_handoffs USING btree (status);


--
-- Name: idx_lead_contacts_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_contacts_lead_id ON public.lead_contacts USING btree (lead_id);


--
-- Name: idx_lead_contacts_verification_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_contacts_verification_status ON public.lead_contacts USING btree (verification_status);


--
-- Name: idx_lead_contacts_verified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_contacts_verified ON public.lead_contacts USING btree (verified);


--
-- Name: idx_lead_scores_lead_calculated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_scores_lead_calculated_at ON public.lead_scores USING btree (lead_id, calculated_at);


--
-- Name: idx_lead_scores_owner_total_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_scores_owner_total_score ON public.lead_scores USING btree (owner_user_id, total_score);


--
-- Name: idx_lead_scores_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_scores_team_id ON public.lead_scores USING btree (team_id);


--
-- Name: idx_lead_scores_workflow_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_scores_workflow_run_id ON public.lead_scores USING btree (workflow_run_id);


--
-- Name: idx_leads_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_created_at ON public.leads USING btree (created_at);


--
-- Name: idx_leads_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_domain ON public.leads USING btree (domain);


--
-- Name: idx_leads_owner_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_owner_status ON public.leads USING btree (owner_user_id, status);


--
-- Name: idx_leads_owner_type_registered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_owner_type_registered ON public.leads USING btree (owner_user_id, lead_type, registered_on DESC);


--
-- Name: idx_leads_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_team_id ON public.leads USING btree (team_id);


--
-- Name: idx_leads_workflow_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_workflow_run_id ON public.leads USING btree (workflow_run_id);


--
-- Name: idx_local_opportunities_owner_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_local_opportunities_owner_date ON public.local_opportunities USING btree (owner_user_id, registered_on DESC, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_local_opportunity_follow_ups_parent_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_local_opportunity_follow_ups_parent_date ON public.local_opportunity_follow_ups USING btree (opportunity_id, followed_on DESC, created_at DESC);


--
-- Name: idx_organization_employees_owner_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organization_employees_owner_department ON public.organization_employees USING btree (owner_user_id, department_id);


--
-- Name: idx_organization_nodes_owner_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organization_nodes_owner_parent ON public.organization_nodes USING btree (owner_user_id, parent_id);


--
-- Name: idx_outreach_draft_versions_owner_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_draft_versions_owner_created ON public.outreach_draft_versions USING btree (owner_user_id, created_at);


--
-- Name: idx_outreach_tasks_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_tasks_created_at ON public.outreach_tasks USING btree (created_at);


--
-- Name: idx_outreach_tasks_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_tasks_lead_id ON public.outreach_tasks USING btree (lead_id);


--
-- Name: idx_outreach_tasks_next_follow_up_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_tasks_next_follow_up_at ON public.outreach_tasks USING btree (next_follow_up_at);


--
-- Name: idx_outreach_tasks_owner_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_tasks_owner_status ON public.outreach_tasks USING btree (owner_user_id, status);


--
-- Name: idx_outreach_tasks_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_tasks_team_id ON public.outreach_tasks USING btree (team_id);


--
-- Name: idx_outreach_tasks_template_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_tasks_template_key ON public.outreach_tasks USING btree (template_key);


--
-- Name: idx_quotation_versions_quote_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotation_versions_quote_created_at ON public.quotation_versions USING btree (quotation_id, created_at);


--
-- Name: idx_quotations_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_lead_id ON public.quotations USING btree (lead_id);


--
-- Name: idx_quotations_owner_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_owner_updated_at ON public.quotations USING btree (owner_user_id, updated_at);


--
-- Name: idx_quotations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_status ON public.quotations USING btree (status);


--
-- Name: idx_shopify_stores_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shopify_stores_lead_id ON public.shopify_stores USING btree (lead_id);


--
-- Name: idx_shopify_stores_owner_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shopify_stores_owner_domain ON public.shopify_stores USING btree (owner_user_id, normalized_domain);


--
-- Name: idx_shopify_stores_run_validity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shopify_stores_run_validity ON public.shopify_stores USING btree (workflow_run_id, validity_score DESC);


--
-- Name: idx_shopify_stores_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shopify_stores_team_id ON public.shopify_stores USING btree (team_id);


--
-- Name: idx_shopify_stores_verification_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shopify_stores_verification_status ON public.shopify_stores USING btree (verification_status);


--
-- Name: idx_shopify_stores_workflow_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shopify_stores_workflow_run_id ON public.shopify_stores USING btree (workflow_run_id);


--
-- Name: idx_sourcing_offers_owner_provider_offer_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_offers_owner_provider_offer_recent ON public.sourcing_offers USING btree (owner_user_id, provider, offer_id, retrieved_at DESC);


--
-- Name: idx_sourcing_offers_owner_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_offers_owner_score ON public.sourcing_offers USING btree (owner_user_id, sourcing_score);


--
-- Name: idx_sourcing_offers_provider_offer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_offers_provider_offer ON public.sourcing_offers USING btree (provider, offer_id);


--
-- Name: idx_sourcing_offers_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_offers_search ON public.sourcing_offers USING btree (search_id);


--
-- Name: idx_sourcing_offers_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_offers_supplier ON public.sourcing_offers USING btree (supplier_id);


--
-- Name: idx_sourcing_offers_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_offers_workflow ON public.sourcing_offers USING btree (workflow_run_id);


--
-- Name: idx_sourcing_pages_cache_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_pages_cache_lookup ON public.sourcing_search_pages USING btree (page_number, page_size, status, completed_at DESC);


--
-- Name: idx_sourcing_search_pages_lease_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_search_pages_lease_expires ON public.sourcing_search_pages USING btree (lease_expires_at);


--
-- Name: idx_sourcing_search_pages_owner_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_search_pages_owner_search ON public.sourcing_search_pages USING btree (owner_user_id, search_id);


--
-- Name: idx_sourcing_search_pages_search_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_search_pages_search_page ON public.sourcing_search_pages USING btree (search_id, page_number);


--
-- Name: idx_sourcing_search_pages_status_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_search_pages_status_available ON public.sourcing_search_pages USING btree (status, available_at);


--
-- Name: idx_sourcing_searches_cache_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_searches_cache_lookup ON public.sourcing_searches USING btree (owner_user_id, provider, cache_fingerprint, created_at DESC) WHERE (cache_fingerprint IS NOT NULL);


--
-- Name: idx_sourcing_searches_owner_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_searches_owner_created ON public.sourcing_searches USING btree (owner_user_id, created_at);


--
-- Name: idx_sourcing_searches_owner_workflow_fingerprint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_searches_owner_workflow_fingerprint ON public.sourcing_searches USING btree (owner_user_id, workflow_run_id, query_fingerprint, created_at DESC);


--
-- Name: idx_sourcing_searches_provider_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_searches_provider_request ON public.sourcing_searches USING btree (provider, provider_request_id);


--
-- Name: idx_sourcing_searches_workflow_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_searches_workflow_status ON public.sourcing_searches USING btree (workflow_run_id, status);


--
-- Name: idx_sourcing_suppliers_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_suppliers_member ON public.sourcing_suppliers USING btree (provider, member_id);


--
-- Name: idx_sourcing_suppliers_open_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_suppliers_open_id ON public.sourcing_suppliers USING btree (provider, open_id);


--
-- Name: idx_sourcing_suppliers_owner_provider_open_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_suppliers_owner_provider_open_recent ON public.sourcing_suppliers USING btree (owner_user_id, provider, open_id, updated_at DESC) WHERE (open_id IS NOT NULL);


--
-- Name: idx_sourcing_suppliers_owner_rating; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_suppliers_owner_rating ON public.sourcing_suppliers USING btree (owner_user_id, supplier_rating);


--
-- Name: idx_sourcing_suppliers_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_suppliers_search ON public.sourcing_suppliers USING btree (search_id);


--
-- Name: idx_sourcing_suppliers_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sourcing_suppliers_workflow ON public.sourcing_suppliers USING btree (workflow_run_id);


--
-- Name: idx_workflow_jobs_lease_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_jobs_lease_expires_at ON public.workflow_jobs USING btree (lease_expires_at);


--
-- Name: idx_workflow_jobs_owner_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_jobs_owner_created_at ON public.workflow_jobs USING btree (owner_user_id, created_at);


--
-- Name: idx_workflow_jobs_status_available_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_jobs_status_available_at ON public.workflow_jobs USING btree (status, available_at);


--
-- Name: idx_workflow_leads_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_leads_lead_id ON public.workflow_leads USING btree (lead_id);


--
-- Name: idx_workflow_leads_run_discovered_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_leads_run_discovered_at ON public.workflow_leads USING btree (workflow_run_id, discovered_at);


--
-- Name: idx_workflow_leads_run_score_discovered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_leads_run_score_discovered ON public.workflow_leads USING btree (workflow_run_id, source_score DESC, discovered_at DESC);


--
-- Name: idx_workflow_runs_owner_archived_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_runs_owner_archived_at ON public.workflow_runs USING btree (owner_user_id, archived_at);


--
-- Name: idx_workflow_runs_owner_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_runs_owner_created_at ON public.workflow_runs USING btree (owner_user_id, created_at);


--
-- Name: idx_workflow_runs_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_runs_parent_id ON public.workflow_runs USING btree (parent_workflow_run_id);


--
-- Name: idx_workflow_runs_root_revision; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_runs_root_revision ON public.workflow_runs USING btree (root_workflow_run_id, revision_no);


--
-- Name: idx_workflow_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_runs_status ON public.workflow_runs USING btree (status);


--
-- Name: idx_workflow_runs_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_runs_team_id ON public.workflow_runs USING btree (team_id);


--
-- Name: idx_workflow_runs_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_runs_updated_at ON public.workflow_runs USING btree (updated_at);


--
-- Name: idx_workflow_steps_run_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_steps_run_sequence ON public.workflow_steps USING btree (workflow_run_id, sequence);


--
-- Name: idx_workflow_steps_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_steps_status ON public.workflow_steps USING btree (status);


--
-- Name: idx_workflow_steps_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_steps_updated_at ON public.workflow_steps USING btree (updated_at);


--
-- Name: ix_chain_relation_from_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_chain_relation_from_document ON public.hz_fop_document_relations USING btree (company_id, dataset_id, from_document_id);


--
-- Name: ix_chain_relation_holder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_chain_relation_holder ON public.hz_fop_document_relations USING btree (company_id, dataset_id, holder_document_id);


--
-- Name: ix_chain_relation_to_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_chain_relation_to_document ON public.hz_fop_document_relations USING btree (company_id, dataset_id, to_document_id);


--
-- Name: ix_collected_active_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_collected_active_batch ON public.hz_fop_collected_batches USING btree (workspace_owner_id, tenant_id, company_id) WHERE (state = 'active'::text);


--
-- Name: ix_collected_allocation_errors; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_collected_allocation_errors ON public.hz_fop_collected_entities USING btree (batch_id, ((display ->> 'sourceOrderId'::text))) WHERE ((entity_type = 'allocation'::text) AND ((display ->> 'rawAllocationStatus'::text) = 'error'::text));


--
-- Name: ix_collected_analytics_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_collected_analytics_document ON public.hz_fop_collected_analytics_facts USING btree (batch_id, entity_type, document_number);


--
-- Name: ix_collected_analytics_scope_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_collected_analytics_scope_time ON public.hz_fop_collected_analytics_facts USING btree (batch_id, entity_type, owner_employee_id, occurred_at, source_id);


--
-- Name: ix_collected_exception_candidates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_collected_exception_candidates ON public.hz_fop_collected_orders USING btree (batch_id, source_id) INCLUDE (owner_employee_id) WHERE ((raw_order_status = '6'::text) OR (raw_order_status IS NULL) OR (raw_order_status <> ALL (ARRAY['0'::text, '1'::text, '2'::text, '3'::text, '4'::text, '5'::text, '6'::text, 'no'::text])) OR ((raw_order_status = ANY (ARRAY['2'::text, '3'::text, '4'::text, '5'::text])) AND ((raw_payment_status IS NULL) OR (raw_payment_status <> ALL (ARRAY['0'::text, '1'::text])))) OR ((raw_payment_status = '1'::text) AND (paid_at IS NULL)) OR (COALESCE(((display -> 'exception'::text) ->> 'type'::text), ''::text) <> ''::text) OR ((display -> 'nativeAssociationIssues'::text) ?| ARRAY['parent_version_conflict'::text, 'dispatch_relationship_conflict'::text, 'allocation_relationship_conflict'::text]) OR ((display -> 'nativeProcurementAssociationIssues'::text) ? 'current_purchase_relationship_conflict'::text) OR ((raw_delivery_status = '1'::text) AND (((display -> 'businessStatus'::text) ->> 'outbound'::text) = 'unknown'::text)) OR ((raw_order_status = ANY (ARRAY['2'::text, '3'::text])) AND ((display ->> 'dispatchTaskStatus'::text) = 'dispatch_synced'::text)) OR ((raw_bill_status = 'C'::text) AND (raw_order_status = ANY (ARRAY['2'::text, '3'::text]))) OR ((raw_bill_status = 'C'::text) AND (raw_order_status = ANY (ARRAY['4'::text, '5'::text])) AND ((NOT COALESCE(jsonb_path_exists(raw, 'strict $."hzkj_logistics_info"[*]?(@."hzkj_tracking_number".type() == "string" && @."hzkj_tracking_number" like_regex "[^ \\t\\n\\r]")'::jsonpath, '{}'::jsonb, true), false)) OR jsonb_exists(((display -> 'moneyCapture'::text) -> 'values'::text), 'hzkj_logistics_info'::text) OR COALESCE(jsonb_path_exists(display, 'strict $."dispatchDocuments"[*]?((@."deliveryStatus" == "SYNC_FAILED" || @."deliveryStatus" == "TRACKING_OBTAINED") || exists (@."trackingNumbers"[*]?((@."type" == "full" || @."type" == "first_mile") || @."type" == "last_mile")) && !(exists (@."trackingNumbers"[*]?((@."type" == "full" && @."number".type() == "string") && @."number" like_regex "[^ \\t\\n\\r]"))))'::jsonpath, '{}'::jsonb, true), false))));


--
-- Name: ix_collected_exception_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_collected_exception_state ON public.hz_fop_collected_orders USING btree (batch_id, exception_type, owner_employee_id, paid_at, source_id) WHERE is_exception;


--
-- Name: ix_collected_inbound_candidates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_collected_inbound_candidates ON public.hz_fop_collected_orders USING btree (batch_id, owner_employee_id, warehouse_code, paid_at, source_id) WHERE (((raw ->> 'hzkj_purchase_status'::text) = ANY (ARRAY['1'::text, '4'::text])) OR ((raw ->> 'hzkj_purchase_status_title'::text) = ANY (ARRAY['部分发货'::text, '已发货'::text])));


--
-- Name: ix_collected_order_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_collected_order_number ON public.hz_fop_collected_orders USING btree (batch_id, order_number);


--
-- Name: ix_collected_physical_inbound_candidates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_collected_physical_inbound_candidates ON public.hz_fop_collected_orders USING btree (batch_id, owner_employee_id, warehouse_code, paid_at, source_id) WHERE (raw @? '$."hzkj_orders_billentry"[*]?(@."hzkj_entrypurc_status" == "3" || @."hzkj_entrypurc_status" == "4")'::jsonpath);


--
-- Name: ix_collected_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_collected_queue ON public.hz_fop_collected_orders USING btree (batch_id, raw_bill_status, raw_payment_status, raw_order_status);


--
-- Name: ix_collected_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_collected_scope ON public.hz_fop_collected_orders USING btree (batch_id, owner_employee_id, paid_at DESC, source_id);


--
-- Name: ix_collected_stock_consumption_order_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_collected_stock_consumption_order_sku ON public.hz_fop_collected_stock_consumptions USING btree (batch_id, order_number, sku_id);


--
-- Name: ix_collected_stock_exception_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_collected_stock_exception_state ON public.hz_fop_collected_entities USING btree (batch_id, owner_employee_id, source_id) WHERE (is_exception AND (entity_type = 'stock_orders'::text));


--
-- Name: ix_collected_unpaid_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_collected_unpaid_time ON public.hz_fop_collected_orders USING btree (batch_id, raw_order_status, consumer_paid_at DESC NULLS LAST, source_id) INCLUDE (owner_employee_id, warehouse_code, country_code, total_quantity) WHERE ((raw_order_status = ANY (ARRAY['no'::text, '1'::text])) AND (
CASE
    WHEN jsonb_exists(raw, 'hzkj_fulfillment_status'::text) THEN (raw ->> 'hzkj_fulfillment_status'::text)
    WHEN ((((display -> 'salesSourceStatus'::text) ->> 'source'::text) = 'fulfillment_capture'::text) AND (((display -> 'salesSourceStatus'::text) ->> 'sourceId'::text) = source_id) AND (((display -> 'salesSourceStatus'::text) ->> 'orderStatus'::text) = raw_order_status)) THEN ((display -> 'salesSourceStatus'::text) ->> 'fulfillmentStatus'::text)
    ELSE NULL::text
END IS DISTINCT FROM 'fulfilled'::text) AND COALESCE((
CASE
    WHEN jsonb_exists(raw, 'hzkj_sourcepayststus'::text) THEN (raw ->> 'hzkj_sourcepayststus'::text)
    WHEN ((((display -> 'salesSourcePaymentStatus'::text) ->> 'source'::text) = 'fulfillment_capture'::text) AND (((display -> 'salesSourcePaymentStatus'::text) ->> 'sourceId'::text) = source_id) AND (((display -> 'salesSourcePaymentStatus'::text) ->> 'orderStatus'::text) = raw_order_status)) THEN ((display -> 'salesSourcePaymentStatus'::text) ->> 'paymentStatus'::text)
    ELSE NULL::text
END <> ALL (ARRAY['refunded'::text, 'voided'::text, 'expired'::text, 'unpaid'::text])), true));


--
-- Name: ix_customer_registration_scope_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_customer_registration_scope_time ON public.hz_fop_collected_customer_registrations USING btree (batch_id, company_id, source_owner_user_id, created_at);


--
-- Name: ix_exception_allocation_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_exception_allocation_parent ON public.hz_fop_collected_entities USING btree (batch_id, ((display ->> 'sourceOrderId'::text))) WHERE (entity_type = 'allocation'::text);


--
-- Name: ix_exception_dispatch_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_exception_dispatch_parent ON public.hz_fop_collected_entities USING btree (batch_id, ((display ->> 'sourceOrderId'::text))) WHERE (entity_type = 'dispatch'::text);


--
-- Name: ix_exception_downstream_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_exception_downstream_parent ON public.hz_fop_collected_entities USING btree (batch_id, ((display ->> 'sourceOrderId'::text))) WHERE (entity_type = ANY (ARRAY['delivery_notice'::text, 'outbound'::text]));


--
-- Name: ix_exception_notice_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_exception_notice_order ON public.hz_fop_collected_entities USING btree (batch_id, ((raw ->> 'hzkj_platform_order_no'::text))) WHERE (entity_type = 'delivery_notice'::text);


--
-- Name: ix_exception_outbound_lines; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_exception_outbound_lines ON public.hz_fop_collected_entities USING gin (((raw -> 'billentry'::text)) jsonb_path_ops) WHERE (entity_type = 'outbound'::text);


--
-- Name: ix_exception_purchase_rows; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_exception_purchase_rows ON public.hz_fop_collected_entities USING gin (((display -> 'rows'::text)) jsonb_path_ops) WHERE (entity_type = 'purchase'::text);


--
-- Name: ix_hz_fop_action_targets_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_action_targets_1 ON public.hz_fop_action_targets USING btree (state, submitted_at);


--
-- Name: ix_hz_fop_bootstrap_pages_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_bootstrap_pages_pending ON public.hz_fop_bootstrap_pages USING btree (batch_id, state, stream_id, page_index);


--
-- Name: ix_hz_fop_document_packages_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_document_packages_1 ON public.hz_fop_document_packages USING btree (document_id, package_id) WHERE (removed_at IS NULL);


--
-- Name: ix_hz_fop_document_relations_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_document_relations_1 ON public.hz_fop_document_relations USING btree (from_document_id, relation_type) WHERE (removed_at IS NULL);


--
-- Name: ix_hz_fop_document_relations_2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_document_relations_2 ON public.hz_fop_document_relations USING btree (to_document_id, relation_type) WHERE (removed_at IS NULL);


--
-- Name: ix_hz_fop_document_relations_3; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_document_relations_3 ON public.hz_fop_document_relations USING btree (from_line_id);


--
-- Name: ix_hz_fop_document_relations_4; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_document_relations_4 ON public.hz_fop_document_relations USING btree (to_line_id);


--
-- Name: ix_hz_fop_employee_bindings_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_employee_bindings_1 ON public.hz_fop_employee_bindings USING btree (connection_id, employee_number);


--
-- Name: ix_hz_fop_exception_marks_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_exception_marks_1 ON public.hz_fop_exception_marks USING btree (company_id, dataset_id, type, active, order_document_id);


--
-- Name: ix_hz_fop_export_items_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_export_items_1 ON public.hz_fop_export_items USING btree (expires_at);


--
-- Name: ix_hz_fop_export_jobs_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_export_jobs_1 ON public.hz_fop_export_jobs USING btree (actor_account_id, state, created_at);


--
-- Name: ix_hz_fop_export_jobs_2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_export_jobs_2 ON public.hz_fop_export_jobs USING btree (expires_at);


--
-- Name: ix_hz_fop_inventory_balances_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_inventory_balances_1 ON public.hz_fop_inventory_balances USING btree (company_id, customer_id, sku_id, warehouse_id);


--
-- Name: ix_hz_fop_package_lines_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_package_lines_1 ON public.hz_fop_package_lines USING btree (order_line_id, package_id);


--
-- Name: ix_hz_fop_platform_orders_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_platform_orders_1 ON public.hz_fop_platform_orders USING btree (company_id, dataset_id, platform_code, external_order_id);


--
-- Name: ix_hz_fop_projection_dependencies_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_projection_dependencies_1 ON public.hz_fop_projection_dependencies USING btree (source_document_id, order_document_id);


--
-- Name: ix_hz_fop_reconciliation_runs_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_reconciliation_runs_1 ON public.hz_fop_reconciliation_runs USING btree (company_id, dataset_id, entity_code, state, created_at);


--
-- Name: ix_hz_fop_reference_items_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_reference_items_1 ON public.hz_fop_reference_items USING btree (connection_id, company_id, resource_type, code);


--
-- Name: ix_hz_fop_reference_items_2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_reference_items_2 ON public.hz_fop_reference_items USING btree (connection_id, company_id, resource_type, parent_source_id);


--
-- Name: ix_hz_fop_refresh_requests_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_refresh_requests_1 ON public.hz_fop_refresh_requests USING btree (actor_account_id, state, requested_at);


--
-- Name: ix_hz_fop_resource_grants_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_resource_grants_1 ON public.hz_fop_resource_grants USING btree (connection_id, company_id, resource_type, expires_at);


--
-- Name: ix_hz_fop_source_documents_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_source_documents_1 ON public.hz_fop_source_documents USING btree (company_id, dataset_id, entity_code, document_number);


--
-- Name: ix_hz_fop_source_documents_2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_source_documents_2 ON public.hz_fop_source_documents USING btree (company_id, dataset_id, entity_code, source_modified_at, id);


--
-- Name: ix_hz_fop_source_lines_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_source_lines_1 ON public.hz_fop_source_lines USING btree (document_id, sequence);


--
-- Name: ix_hz_fop_source_lines_2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_source_lines_2 ON public.hz_fop_source_lines USING btree (company_id, dataset_id, sku_code, document_id);


--
-- Name: ix_hz_fop_stock_consumptions_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_stock_consumptions_1 ON public.hz_fop_stock_consumptions USING btree (order_document_id, order_line_id);


--
-- Name: ix_hz_fop_sync_commit_groups_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_sync_commit_groups_1 ON public.hz_fop_sync_commit_groups USING btree (stream_id, state, created_at);


--
-- Name: ix_hz_fop_sync_event_requirements_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_sync_event_requirements_1 ON public.hz_fop_sync_event_requirements USING btree (event_id, state);


--
-- Name: ix_hz_fop_sync_event_requirements_2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_sync_event_requirements_2 ON public.hz_fop_sync_event_requirements USING btree (task_id, state);


--
-- Name: ix_hz_fop_sync_event_requirements_3; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_sync_event_requirements_3 ON public.hz_fop_sync_event_requirements USING btree (order_document_id, state);


--
-- Name: ix_hz_fop_sync_events_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_sync_events_1 ON public.hz_fop_sync_events USING btree (stream_id, state, stream_position);


--
-- Name: ix_hz_fop_sync_events_2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_sync_events_2 ON public.hz_fop_sync_events USING btree (state, next_attempt_at);


--
-- Name: ix_hz_fop_sync_issues_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_sync_issues_1 ON public.hz_fop_sync_issues USING btree (company_id, dataset_id, state, category, last_seen_at);


--
-- Name: ix_hz_fop_sync_runs_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_sync_runs_1 ON public.hz_fop_sync_runs USING btree (company_id, dataset_id, state, created_at);


--
-- Name: ix_hz_fop_sync_tasks_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_sync_tasks_1 ON public.hz_fop_sync_tasks USING btree (state, priority, next_attempt_at, created_at);


--
-- Name: ix_hz_fop_workbench_memberships_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_workbench_memberships_1 ON public.hz_fop_workbench_memberships USING btree (company_id, dataset_id, queue_code, classification_state, order_document_id);


--
-- Name: ix_hz_fop_workbench_order_lines_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_workbench_order_lines_1 ON public.hz_fop_workbench_order_lines USING btree (company_id, dataset_id, sku_code, order_document_id);


--
-- Name: ix_hz_fop_workbench_orders_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_workbench_orders_1 ON public.hz_fop_workbench_orders USING btree (company_id, dataset_id, owner_employee_id, customer_paid_at DESC NULLS LAST, document_id);


--
-- Name: ix_hz_fop_workbench_orders_2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_workbench_orders_2 ON public.hz_fop_workbench_orders USING btree (company_id, dataset_id, customer_paid_at DESC NULLS LAST, document_id);


--
-- Name: ix_hz_fop_workbench_orders_3; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_workbench_orders_3 ON public.hz_fop_workbench_orders USING btree (company_id, dataset_id, order_kind, business_created_at DESC NULLS LAST, document_id);


--
-- Name: ix_hz_fop_workbench_orders_4; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_workbench_orders_4 ON public.hz_fop_workbench_orders USING btree (company_id, dataset_id, warehouse_id, country_code);


--
-- Name: ix_hz_fop_workbench_orders_5; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_workbench_orders_5 ON public.hz_fop_workbench_orders USING btree (company_id, dataset_id, procurement_stage, customer_paid_at DESC NULLS LAST, document_id);


--
-- Name: ix_hz_fop_workbench_purchase_allocations_1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hz_fop_workbench_purchase_allocations_1 ON public.hz_fop_workbench_purchase_allocations USING btree (purchase_document_id, order_document_id);


--
-- Name: ix_order_relation_path_relation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_order_relation_path_relation ON public.hz_fop_order_relation_paths USING btree (relation_id);


--
-- Name: ix_timestamp_runs_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_timestamp_runs_scope ON public.hz_fop_timestamp_runs USING btree (batch_id, entity_code, started_at DESC);


--
-- Name: uq_ai_prompt_templates_owner_module_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ai_prompt_templates_owner_module_name ON public.ai_prompt_templates USING btree (owner_user_id, module_key, name);


--
-- Name: uq_ai_prompt_templates_system_module; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ai_prompt_templates_system_module ON public.ai_prompt_templates USING btree (module_key) WHERE (is_system = true);


--
-- Name: uq_hz_fop_action_requests_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_action_requests_1 ON public.hz_fop_action_requests USING btree (connection_id, company_id, actor_account_id, operation, client_request_key);


--
-- Name: uq_hz_fop_action_requests_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_action_requests_2 ON public.hz_fop_action_requests USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_action_targets_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_action_targets_1 ON public.hz_fop_action_targets USING btree (request_id, document_id, operation);


--
-- Name: uq_hz_fop_action_targets_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_action_targets_2 ON public.hz_fop_action_targets USING btree (connection_id, company_id, operation, document_id, idempotency_key);


--
-- Name: uq_hz_fop_action_targets_3; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_action_targets_3 ON public.hz_fop_action_targets USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_allocation_line_details_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_allocation_line_details_1 ON public.hz_fop_allocation_line_details USING btree (company_id, line_id);


--
-- Name: uq_hz_fop_allocations_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_allocations_1 ON public.hz_fop_allocations USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_bootstrap_batches_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_bootstrap_batches_1 ON public.hz_fop_bootstrap_batches USING btree (company_id, dataset_id);


--
-- Name: uq_hz_fop_bootstrap_batches_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_bootstrap_batches_2 ON public.hz_fop_bootstrap_batches USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_companies_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_companies_1 ON public.hz_fop_companies USING btree (connection_id, source_company_id);


--
-- Name: uq_hz_fop_companies_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_companies_2 ON public.hz_fop_companies USING btree (connection_id, id);


--
-- Name: uq_hz_fop_connections_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_connections_1 ON public.hz_fop_connections USING btree (workspace_owner_id, environment, tenant_id, base_url);


--
-- Name: uq_hz_fop_datasets_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_datasets_1 ON public.hz_fop_datasets USING btree (company_id, id);


--
-- Name: uq_hz_fop_datasets_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_datasets_2 ON public.hz_fop_datasets USING btree (connection_id, company_id) WHERE ((state)::text = 'active'::text);


--
-- Name: uq_hz_fop_delivery_notices_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_delivery_notices_1 ON public.hz_fop_delivery_notices USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_dispatches_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_dispatches_1 ON public.hz_fop_dispatches USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_document_packages_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_document_packages_1 ON public.hz_fop_document_packages USING btree (dataset_id, package_id, document_id, relation_role) WHERE (removed_at IS NULL);


--
-- Name: uq_hz_fop_document_packages_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_document_packages_2 ON public.hz_fop_document_packages USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_document_relations_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_document_relations_1 ON public.hz_fop_document_relations USING btree (dataset_id, holder_document_id, source_relation_id) WHERE (source_relation_id IS NOT NULL);


--
-- Name: uq_hz_fop_document_relations_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_document_relations_2 ON public.hz_fop_document_relations USING btree (dataset_id, holder_document_id, from_document_id, COALESCE((from_line_id)::text, ''::text), to_document_id, COALESCE((to_line_id)::text, ''::text), relation_type) WHERE ((source_relation_id IS NULL) AND (removed_at IS NULL));


--
-- Name: uq_hz_fop_document_relations_3; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_document_relations_3 ON public.hz_fop_document_relations USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_employee_bindings_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_employee_bindings_1 ON public.hz_fop_employee_bindings USING btree (connection_id, local_account_id);


--
-- Name: uq_hz_fop_employee_bindings_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_employee_bindings_2 ON public.hz_fop_employee_bindings USING btree (connection_id, employee_master_id) WHERE ((employee_master_id IS NOT NULL) AND ((state)::text <> 'disabled'::text));


--
-- Name: uq_hz_fop_employee_bindings_3; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_employee_bindings_3 ON public.hz_fop_employee_bindings USING btree (connection_id, auth_user_id) WHERE ((auth_user_id IS NOT NULL) AND ((state)::text = 'identity_verified'::text));


--
-- Name: uq_hz_fop_employee_bindings_4; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_employee_bindings_4 ON public.hz_fop_employee_bindings USING btree (connection_id, person_record_id) WHERE ((person_record_id IS NOT NULL) AND ((state)::text = ANY ((ARRAY['pending'::character varying, 'directory_verified'::character varying, 'identity_verified'::character varying])::text[])));


--
-- Name: uq_hz_fop_exception_marks_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_exception_marks_1 ON public.hz_fop_exception_marks USING btree (order_document_id, source_mark_key);


--
-- Name: uq_hz_fop_exception_marks_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_exception_marks_2 ON public.hz_fop_exception_marks USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_export_items_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_export_items_1 ON public.hz_fop_export_items USING btree (export_job_id, order_document_id);


--
-- Name: uq_hz_fop_export_items_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_export_items_2 ON public.hz_fop_export_items USING btree (export_job_id, sequence);


--
-- Name: uq_hz_fop_export_items_3; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_export_items_3 ON public.hz_fop_export_items USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_export_jobs_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_export_jobs_1 ON public.hz_fop_export_jobs USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_financial_line_details_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_financial_line_details_1 ON public.hz_fop_financial_line_details USING btree (company_id, line_id);


--
-- Name: uq_hz_fop_fulfillment_orders_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_fulfillment_orders_1 ON public.hz_fop_fulfillment_orders USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_inbound_bills_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_inbound_bills_1 ON public.hz_fop_inbound_bills USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_inventory_balances_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_inventory_balances_1 ON public.hz_fop_inventory_balances USING btree (connection_id, company_id, warehouse_id, sku_id, pool_type, owner_key);


--
-- Name: uq_hz_fop_inventory_line_details_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_inventory_line_details_1 ON public.hz_fop_inventory_line_details USING btree (company_id, line_id);


--
-- Name: uq_hz_fop_order_flags_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_order_flags_1 ON public.hz_fop_order_flags USING btree (order_document_id, flag_type);


--
-- Name: uq_hz_fop_order_flags_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_order_flags_2 ON public.hz_fop_order_flags USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_order_line_details_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_order_line_details_1 ON public.hz_fop_order_line_details USING btree (company_id, line_id);


--
-- Name: uq_hz_fop_order_packages_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_order_packages_1 ON public.hz_fop_order_packages USING btree (order_document_id, source_package_key);


--
-- Name: uq_hz_fop_order_packages_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_order_packages_2 ON public.hz_fop_order_packages USING btree (company_id, id);


--
-- Name: uq_hz_fop_order_packages_3; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_order_packages_3 ON public.hz_fop_order_packages USING btree (company_id, dataset_id, order_document_id, id);


--
-- Name: uq_hz_fop_order_packages_4; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_order_packages_4 ON public.hz_fop_order_packages USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_outbound_bills_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_outbound_bills_1 ON public.hz_fop_outbound_bills USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_package_lines_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_package_lines_1 ON public.hz_fop_package_lines USING btree (package_id, order_line_id);


--
-- Name: uq_hz_fop_package_lines_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_package_lines_2 ON public.hz_fop_package_lines USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_payments_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_payments_1 ON public.hz_fop_payments USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_platform_orders_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_platform_orders_1 ON public.hz_fop_platform_orders USING btree (purchase_document_id, platform_code, external_order_id, COALESCE(external_suborder_id, ''::character varying));


--
-- Name: uq_hz_fop_platform_orders_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_platform_orders_2 ON public.hz_fop_platform_orders USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_procurement_line_details_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_procurement_line_details_1 ON public.hz_fop_procurement_line_details USING btree (company_id, line_id);


--
-- Name: uq_hz_fop_projection_dependencies_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_projection_dependencies_1 ON public.hz_fop_projection_dependencies USING btree (order_document_id, source_document_id);


--
-- Name: uq_hz_fop_projection_dependencies_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_projection_dependencies_2 ON public.hz_fop_projection_dependencies USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_purchase_orders_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_purchase_orders_1 ON public.hz_fop_purchase_orders USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_purchase_requisitions_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_purchase_requisitions_1 ON public.hz_fop_purchase_requisitions USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_purchase_returns_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_purchase_returns_1 ON public.hz_fop_purchase_returns USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_receipt_adjustments_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_receipt_adjustments_1 ON public.hz_fop_receipt_adjustments USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_receipt_notices_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_receipt_notices_1 ON public.hz_fop_receipt_notices USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_receipts_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_receipts_1 ON public.hz_fop_receipts USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_reconciliation_runs_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_reconciliation_runs_1 ON public.hz_fop_reconciliation_runs USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_reference_items_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_reference_items_1 ON public.hz_fop_reference_items USING btree (connection_id, company_id, resource_type, source_id);


--
-- Name: uq_hz_fop_refresh_requests_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_refresh_requests_1 ON public.hz_fop_refresh_requests USING btree (actor_account_id, request_key);


--
-- Name: uq_hz_fop_refresh_requests_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_refresh_requests_2 ON public.hz_fop_refresh_requests USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_resource_grants_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_resource_grants_1 ON public.hz_fop_resource_grants USING btree (connection_id, company_id, resource_type, target_key);


--
-- Name: uq_hz_fop_return_line_details_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_return_line_details_1 ON public.hz_fop_return_line_details USING btree (company_id, line_id);


--
-- Name: uq_hz_fop_rma_orders_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_rma_orders_1 ON public.hz_fop_rma_orders USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_source_documents_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_source_documents_1 ON public.hz_fop_source_documents USING btree (dataset_id, entity_code, source_id);


--
-- Name: uq_hz_fop_source_documents_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_source_documents_2 ON public.hz_fop_source_documents USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_source_documents_3; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_source_documents_3 ON public.hz_fop_source_documents USING btree (company_id, dataset_id, id, entity_code);


--
-- Name: uq_hz_fop_source_lines_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_source_lines_1 ON public.hz_fop_source_lines USING btree (document_id, entry_entity, source_entry_id);


--
-- Name: uq_hz_fop_source_lines_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_source_lines_2 ON public.hz_fop_source_lines USING btree (company_id, document_id, id);


--
-- Name: uq_hz_fop_source_lines_3; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_source_lines_3 ON public.hz_fop_source_lines USING btree (company_id, id);


--
-- Name: uq_hz_fop_source_lines_4; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_source_lines_4 ON public.hz_fop_source_lines USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_source_lines_5; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_source_lines_5 ON public.hz_fop_source_lines USING btree (company_id, dataset_id, document_id, id);


--
-- Name: uq_hz_fop_stock_consumptions_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_stock_consumptions_1 ON public.hz_fop_stock_consumptions USING btree (stock_document_id, source_consumption_id);


--
-- Name: uq_hz_fop_stock_consumptions_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_stock_consumptions_2 ON public.hz_fop_stock_consumptions USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_stock_orders_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_stock_orders_1 ON public.hz_fop_stock_orders USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_sync_barriers_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_barriers_1 ON public.hz_fop_sync_barriers USING btree (company_id, dataset_id, source_barrier_id);


--
-- Name: uq_hz_fop_sync_barriers_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_barriers_2 ON public.hz_fop_sync_barriers USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_sync_commit_groups_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_commit_groups_1 ON public.hz_fop_sync_commit_groups USING btree (stream_id, source_group_key);


--
-- Name: uq_hz_fop_sync_commit_groups_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_commit_groups_2 ON public.hz_fop_sync_commit_groups USING btree (company_id, dataset_id, stream_id, id);


--
-- Name: uq_hz_fop_sync_commit_groups_3; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_commit_groups_3 ON public.hz_fop_sync_commit_groups USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_sync_event_requirements_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_event_requirements_1 ON public.hz_fop_sync_event_requirements USING btree (event_id, target_kind, target_key);


--
-- Name: uq_hz_fop_sync_event_requirements_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_event_requirements_2 ON public.hz_fop_sync_event_requirements USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_sync_events_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_events_1 ON public.hz_fop_sync_events USING btree (stream_id, source_event_id);


--
-- Name: uq_hz_fop_sync_events_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_events_2 ON public.hz_fop_sync_events USING btree (stream_id, stream_position);


--
-- Name: uq_hz_fop_sync_events_3; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_events_3 ON public.hz_fop_sync_events USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_sync_issues_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_issues_1 ON public.hz_fop_sync_issues USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_sync_runs_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_runs_1 ON public.hz_fop_sync_runs USING btree (company_id, dataset_id, scheduled_for) WHERE (scheduled_for IS NOT NULL);


--
-- Name: uq_hz_fop_sync_runs_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_runs_2 ON public.hz_fop_sync_runs USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_sync_streams_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_streams_1 ON public.hz_fop_sync_streams USING btree (connection_id, company_id, dataset_id, stream_key);


--
-- Name: uq_hz_fop_sync_streams_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_streams_2 ON public.hz_fop_sync_streams USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_sync_tasks_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_tasks_1 ON public.hz_fop_sync_tasks USING btree (company_id, dataset_id, task_type, target_key) WHERE ((state)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'retry'::character varying, 'blocked'::character varying])::text[]));


--
-- Name: uq_hz_fop_sync_tasks_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_sync_tasks_2 ON public.hz_fop_sync_tasks USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_tracking_events_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_tracking_events_1 ON public.hz_fop_tracking_events USING btree (dispatch_document_id, source_event_id);


--
-- Name: uq_hz_fop_tracking_events_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_tracking_events_2 ON public.hz_fop_tracking_events USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_tracking_numbers_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_tracking_numbers_1 ON public.hz_fop_tracking_numbers USING btree (dispatch_document_id, tracking_type, number);


--
-- Name: uq_hz_fop_tracking_numbers_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_tracking_numbers_2 ON public.hz_fop_tracking_numbers USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_workbench_memberships_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_workbench_memberships_1 ON public.hz_fop_workbench_memberships USING btree (order_document_id, queue_code);


--
-- Name: uq_hz_fop_workbench_memberships_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_workbench_memberships_2 ON public.hz_fop_workbench_memberships USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_workbench_order_lines_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_workbench_order_lines_1 ON public.hz_fop_workbench_order_lines USING btree (order_document_id, source_line_id);


--
-- Name: uq_hz_fop_workbench_order_lines_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_workbench_order_lines_2 ON public.hz_fop_workbench_order_lines USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_workbench_orders_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_workbench_orders_1 ON public.hz_fop_workbench_orders USING btree (company_id, document_id);


--
-- Name: uq_hz_fop_workbench_orders_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_workbench_orders_2 ON public.hz_fop_workbench_orders USING btree (company_id, dataset_id, document_id);


--
-- Name: uq_hz_fop_workbench_procurement_demands_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_workbench_procurement_demands_1 ON public.hz_fop_workbench_procurement_demands USING btree (order_document_id, order_line_id);


--
-- Name: uq_hz_fop_workbench_procurement_demands_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_workbench_procurement_demands_2 ON public.hz_fop_workbench_procurement_demands USING btree (company_id, dataset_id, id);


--
-- Name: uq_hz_fop_workbench_purchase_allocations_1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_workbench_purchase_allocations_1 ON public.hz_fop_workbench_purchase_allocations USING btree (order_document_id, order_line_id, purchase_document_id, purchase_line_id);


--
-- Name: uq_hz_fop_workbench_purchase_allocations_2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hz_fop_workbench_purchase_allocations_2 ON public.hz_fop_workbench_purchase_allocations USING btree (company_id, dataset_id, id);


--
-- Name: uq_lead_scores_lead_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_lead_scores_lead_workflow ON public.lead_scores USING btree (lead_id, workflow_run_id);


--
-- Name: uq_leads_owner_normalized_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_leads_owner_normalized_domain ON public.leads USING btree (owner_user_id, normalized_domain);


--
-- Name: uq_local_opportunities_active_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_local_opportunities_active_lead ON public.local_opportunities USING btree (source_lead_id) WHERE ((deleted_at IS NULL) AND (source_lead_id IS NOT NULL));


--
-- Name: uq_organization_employee_account; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_organization_employee_account ON public.organization_employees USING btree (account_id) WHERE (account_id IS NOT NULL);


--
-- Name: uq_organization_nodes_root; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_organization_nodes_root ON public.organization_nodes USING btree (owner_user_id) WHERE (parent_id IS NULL);


--
-- Name: uq_sourcing_offers_search_provider_fingerprint; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_sourcing_offers_search_provider_fingerprint ON public.sourcing_offers USING btree (search_id, provider, product_fingerprint) WHERE (product_fingerprint IS NOT NULL);


--
-- Name: hz_fop_collected_entities hz_entities_relation_dirty; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hz_entities_relation_dirty AFTER INSERT OR DELETE OR UPDATE ON public.hz_fop_collected_entities FOR EACH ROW EXECUTE FUNCTION public.hz_mark_relation_source();


--
-- Name: hz_fop_exception_dirty hz_exception_at_commit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER hz_exception_at_commit AFTER INSERT ON public.hz_fop_exception_dirty DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hz_exception_commit_v1();


--
-- Name: hz_fop_collected_batches hz_exception_batch_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hz_exception_batch_delete AFTER DELETE ON public.hz_fop_collected_batches FOR EACH ROW EXECUTE FUNCTION public.hz_exception_batch_deleted_v1();


--
-- Name: hz_fop_collected_entities hz_exception_downstream_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hz_exception_downstream_change AFTER INSERT OR DELETE OR UPDATE ON public.hz_fop_collected_entities FOR EACH ROW EXECUTE FUNCTION public.hz_exception_downstream_changed_v4();


--
-- Name: hz_fop_collected_entities hz_exception_purchase_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hz_exception_purchase_change AFTER INSERT OR DELETE OR UPDATE ON public.hz_fop_collected_entities FOR EACH ROW EXECUTE FUNCTION public.hz_exception_purchase_changed_v2();


--
-- Name: hz_fop_collected_analytics_facts hz_exception_source_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hz_exception_source_change AFTER UPDATE OF batch_id, entity_type, source_id, company_id, document_number, owner_employee_id, customer_id, department_id, created_at, paid_at, source_paid_at, occurred_at, amount, currency_code, quantity, raw_status, facts, raw ON public.hz_fop_collected_analytics_facts FOR EACH ROW EXECUTE FUNCTION public.hz_exception_source_changed_v1();


--
-- Name: hz_fop_collected_entities hz_exception_source_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hz_exception_source_change AFTER UPDATE OF batch_id, entity_type, source_id, owner_employee_id, search_text, display, raw ON public.hz_fop_collected_entities FOR EACH ROW EXECUTE FUNCTION public.hz_exception_source_changed_v1();


--
-- Name: hz_fop_collected_orders hz_exception_source_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hz_exception_source_change AFTER UPDATE OF batch_id, source_id, order_number, owner_employee_id, customer_id, warehouse_code, country_code, bill_type, raw_bill_status, raw_order_status, raw_payment_status, raw_delivery_status, created_at, paid_at, consumer_paid_at, product_amount, total_amount, currency_code, total_quantity, search_text, display, raw ON public.hz_fop_collected_orders FOR EACH ROW EXECUTE FUNCTION public.hz_exception_source_changed_v1();


--
-- Name: hz_fop_collected_analytics_facts hz_exception_source_create_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hz_exception_source_create_delete AFTER INSERT OR DELETE ON public.hz_fop_collected_analytics_facts FOR EACH ROW EXECUTE FUNCTION public.hz_exception_source_changed_v1();


--
-- Name: hz_fop_collected_entities hz_exception_source_create_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hz_exception_source_create_delete AFTER INSERT OR DELETE ON public.hz_fop_collected_entities FOR EACH ROW EXECUTE FUNCTION public.hz_exception_source_changed_v1();


--
-- Name: hz_fop_collected_orders hz_exception_source_create_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hz_exception_source_create_delete AFTER INSERT OR DELETE ON public.hz_fop_collected_orders FOR EACH ROW EXECUTE FUNCTION public.hz_exception_source_changed_v1();


--
-- Name: hz_fop_collected_orders hz_orders_relation_dirty; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hz_orders_relation_dirty AFTER INSERT OR DELETE OR UPDATE ON public.hz_fop_collected_orders FOR EACH ROW EXECUTE FUNCTION public.hz_mark_relation_source();


--
-- Name: leads lead_origin_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER lead_origin_immutable BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.hz_lead_origin_immutable();


--
-- Name: ad_creatives fk_ad_creatives_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_creatives
    ADD CONSTRAINT fk_ad_creatives_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: ad_creatives fk_ad_creatives_workflow_run; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_creatives
    ADD CONSTRAINT fk_ad_creatives_workflow_run FOREIGN KEY (workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- Name: ai_outreach_conversations fk_ai_outreach_conversations_lead; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_outreach_conversations
    ADD CONSTRAINT fk_ai_outreach_conversations_lead FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: ai_outreach_conversations fk_ai_outreach_conversations_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_outreach_conversations
    ADD CONSTRAINT fk_ai_outreach_conversations_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_outreach_messages fk_ai_outreach_messages_conversation; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_outreach_messages
    ADD CONSTRAINT fk_ai_outreach_messages_conversation FOREIGN KEY (conversation_id) REFERENCES public.ai_outreach_conversations(id) ON DELETE CASCADE;


--
-- Name: ai_prompt_bindings fk_ai_prompt_bindings_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_prompt_bindings
    ADD CONSTRAINT fk_ai_prompt_bindings_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_prompt_bindings fk_ai_prompt_bindings_template; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_prompt_bindings
    ADD CONSTRAINT fk_ai_prompt_bindings_template FOREIGN KEY (template_id) REFERENCES public.ai_prompt_templates(id) ON DELETE CASCADE;


--
-- Name: ai_prompt_templates fk_ai_prompt_templates_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_prompt_templates
    ADD CONSTRAINT fk_ai_prompt_templates_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: audit_events fk_audit_events_actor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT fk_audit_events_actor FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: hz_fop_order_relation_paths fk_chain_relation_scope; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_relation_paths
    ADD CONSTRAINT fk_chain_relation_scope FOREIGN KEY (company_id, dataset_id, relation_id) REFERENCES public.hz_fop_document_relations(company_id, dataset_id, id) ON DELETE RESTRICT;


--
-- Name: crm_activities fk_crm_activities_lead; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT fk_crm_activities_lead FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: crm_activities fk_crm_activities_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT fk_crm_activities_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: fop_handoffs fk_fop_handoffs_lead; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fop_handoffs
    ADD CONSTRAINT fk_fop_handoffs_lead FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: fop_handoffs fk_fop_handoffs_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fop_handoffs
    ADD CONSTRAINT fk_fop_handoffs_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: hz_fop_action_requests fk_hz_fop_action_requests_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_action_requests
    ADD CONSTRAINT fk_hz_fop_action_requests_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_action_requests fk_hz_fop_action_requests_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_action_requests
    ADD CONSTRAINT fk_hz_fop_action_requests_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_action_requests fk_hz_fop_action_requests_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_action_requests
    ADD CONSTRAINT fk_hz_fop_action_requests_3 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_action_requests fk_hz_fop_action_requests_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_action_requests
    ADD CONSTRAINT fk_hz_fop_action_requests_4 FOREIGN KEY (actor_account_id) REFERENCES public.users(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_action_targets fk_hz_fop_action_targets_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_action_targets
    ADD CONSTRAINT fk_hz_fop_action_targets_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_action_targets fk_hz_fop_action_targets_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_action_targets
    ADD CONSTRAINT fk_hz_fop_action_targets_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_action_targets fk_hz_fop_action_targets_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_action_targets
    ADD CONSTRAINT fk_hz_fop_action_targets_3 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_action_targets fk_hz_fop_action_targets_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_action_targets
    ADD CONSTRAINT fk_hz_fop_action_targets_4 FOREIGN KEY (company_id, dataset_id, document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_action_targets fk_hz_fop_action_targets_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_action_targets
    ADD CONSTRAINT fk_hz_fop_action_targets_5 FOREIGN KEY (company_id, dataset_id, request_id) REFERENCES public.hz_fop_action_requests(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_allocation_line_details fk_hz_fop_allocation_line_details_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_allocation_line_details
    ADD CONSTRAINT fk_hz_fop_allocation_line_details_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_allocation_line_details fk_hz_fop_allocation_line_details_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_allocation_line_details
    ADD CONSTRAINT fk_hz_fop_allocation_line_details_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_allocation_line_details fk_hz_fop_allocation_line_details_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_allocation_line_details
    ADD CONSTRAINT fk_hz_fop_allocation_line_details_3 FOREIGN KEY (company_id, dataset_id, line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_allocations fk_hz_fop_allocations_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_allocations
    ADD CONSTRAINT fk_hz_fop_allocations_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_allocations fk_hz_fop_allocations_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_allocations
    ADD CONSTRAINT fk_hz_fop_allocations_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_allocations fk_hz_fop_allocations_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_allocations
    ADD CONSTRAINT fk_hz_fop_allocations_3 FOREIGN KEY (company_id, dataset_id, document_id, entity_code) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id, entity_code) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_bootstrap_batches fk_hz_fop_bootstrap_batches_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_bootstrap_batches
    ADD CONSTRAINT fk_hz_fop_bootstrap_batches_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_bootstrap_batches fk_hz_fop_bootstrap_batches_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_bootstrap_batches
    ADD CONSTRAINT fk_hz_fop_bootstrap_batches_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_bootstrap_batches fk_hz_fop_bootstrap_batches_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_bootstrap_batches
    ADD CONSTRAINT fk_hz_fop_bootstrap_batches_3 FOREIGN KEY (company_id, dataset_id, cutover_barrier_id) REFERENCES public.hz_fop_sync_barriers(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_bootstrap_batches fk_hz_fop_bootstrap_batches_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_bootstrap_batches
    ADD CONSTRAINT fk_hz_fop_bootstrap_batches_4 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_bootstrap_batches fk_hz_fop_bootstrap_batches_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_bootstrap_batches
    ADD CONSTRAINT fk_hz_fop_bootstrap_batches_5 FOREIGN KEY (company_id, dataset_id, start_barrier_id) REFERENCES public.hz_fop_sync_barriers(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_bootstrap_batches fk_hz_fop_bootstrap_batches_6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_bootstrap_batches
    ADD CONSTRAINT fk_hz_fop_bootstrap_batches_6 FOREIGN KEY (company_id, dataset_id, sync_run_id) REFERENCES public.hz_fop_sync_runs(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_companies fk_hz_fop_companies_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_companies
    ADD CONSTRAINT fk_hz_fop_companies_1 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_companies fk_hz_fop_companies_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_companies
    ADD CONSTRAINT fk_hz_fop_companies_2 FOREIGN KEY (id, active_dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_connections fk_hz_fop_connections_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_connections
    ADD CONSTRAINT fk_hz_fop_connections_1 FOREIGN KEY (workspace_owner_id) REFERENCES public.users(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_datasets fk_hz_fop_datasets_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_datasets
    ADD CONSTRAINT fk_hz_fop_datasets_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_datasets fk_hz_fop_datasets_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_datasets
    ADD CONSTRAINT fk_hz_fop_datasets_2 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_datasets fk_hz_fop_datasets_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_datasets
    ADD CONSTRAINT fk_hz_fop_datasets_3 FOREIGN KEY (company_id, previous_dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_delivery_notices fk_hz_fop_delivery_notices_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_delivery_notices
    ADD CONSTRAINT fk_hz_fop_delivery_notices_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_delivery_notices fk_hz_fop_delivery_notices_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_delivery_notices
    ADD CONSTRAINT fk_hz_fop_delivery_notices_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_delivery_notices fk_hz_fop_delivery_notices_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_delivery_notices
    ADD CONSTRAINT fk_hz_fop_delivery_notices_3 FOREIGN KEY (company_id, dataset_id, document_id, entity_code) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id, entity_code) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_dispatches fk_hz_fop_dispatches_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_dispatches
    ADD CONSTRAINT fk_hz_fop_dispatches_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_dispatches fk_hz_fop_dispatches_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_dispatches
    ADD CONSTRAINT fk_hz_fop_dispatches_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_dispatches fk_hz_fop_dispatches_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_dispatches
    ADD CONSTRAINT fk_hz_fop_dispatches_3 FOREIGN KEY (company_id, dataset_id, document_id, entity_code) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id, entity_code) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_packages fk_hz_fop_document_packages_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_packages
    ADD CONSTRAINT fk_hz_fop_document_packages_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_packages fk_hz_fop_document_packages_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_packages
    ADD CONSTRAINT fk_hz_fop_document_packages_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_packages fk_hz_fop_document_packages_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_packages
    ADD CONSTRAINT fk_hz_fop_document_packages_3 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_packages fk_hz_fop_document_packages_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_packages
    ADD CONSTRAINT fk_hz_fop_document_packages_4 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_packages fk_hz_fop_document_packages_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_packages
    ADD CONSTRAINT fk_hz_fop_document_packages_5 FOREIGN KEY (company_id, dataset_id, document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_packages fk_hz_fop_document_packages_6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_packages
    ADD CONSTRAINT fk_hz_fop_document_packages_6 FOREIGN KEY (company_id, dataset_id, package_id) REFERENCES public.hz_fop_order_packages(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_packages fk_hz_fop_document_packages_7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_packages
    ADD CONSTRAINT fk_hz_fop_document_packages_7 FOREIGN KEY (company_id, dataset_id, order_document_id, package_id) REFERENCES public.hz_fop_order_packages(company_id, dataset_id, order_document_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_relations fk_hz_fop_document_relations_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_relations
    ADD CONSTRAINT fk_hz_fop_document_relations_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_relations fk_hz_fop_document_relations_10; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_relations
    ADD CONSTRAINT fk_hz_fop_document_relations_10 FOREIGN KEY (company_id, dataset_id, to_document_id, to_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, document_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_relations fk_hz_fop_document_relations_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_relations
    ADD CONSTRAINT fk_hz_fop_document_relations_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_relations fk_hz_fop_document_relations_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_relations
    ADD CONSTRAINT fk_hz_fop_document_relations_3 FOREIGN KEY (company_id, dataset_id, from_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_relations fk_hz_fop_document_relations_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_relations
    ADD CONSTRAINT fk_hz_fop_document_relations_4 FOREIGN KEY (company_id, dataset_id, holder_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_relations fk_hz_fop_document_relations_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_relations
    ADD CONSTRAINT fk_hz_fop_document_relations_5 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_relations fk_hz_fop_document_relations_6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_relations
    ADD CONSTRAINT fk_hz_fop_document_relations_6 FOREIGN KEY (company_id, dataset_id, to_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_relations fk_hz_fop_document_relations_7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_relations
    ADD CONSTRAINT fk_hz_fop_document_relations_7 FOREIGN KEY (company_id, dataset_id, from_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_relations fk_hz_fop_document_relations_8; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_relations
    ADD CONSTRAINT fk_hz_fop_document_relations_8 FOREIGN KEY (company_id, dataset_id, to_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_document_relations fk_hz_fop_document_relations_9; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_document_relations
    ADD CONSTRAINT fk_hz_fop_document_relations_9 FOREIGN KEY (company_id, dataset_id, from_document_id, from_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, document_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_employee_bindings fk_hz_fop_employee_bindings_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_employee_bindings
    ADD CONSTRAINT fk_hz_fop_employee_bindings_1 FOREIGN KEY (local_account_id) REFERENCES public.users(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_employee_bindings fk_hz_fop_employee_bindings_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_employee_bindings
    ADD CONSTRAINT fk_hz_fop_employee_bindings_2 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_exception_marks fk_hz_fop_exception_marks_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_exception_marks
    ADD CONSTRAINT fk_hz_fop_exception_marks_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_exception_marks fk_hz_fop_exception_marks_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_exception_marks
    ADD CONSTRAINT fk_hz_fop_exception_marks_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_exception_marks fk_hz_fop_exception_marks_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_exception_marks
    ADD CONSTRAINT fk_hz_fop_exception_marks_3 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_exception_marks fk_hz_fop_exception_marks_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_exception_marks
    ADD CONSTRAINT fk_hz_fop_exception_marks_4 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_export_items fk_hz_fop_export_items_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_export_items
    ADD CONSTRAINT fk_hz_fop_export_items_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_export_items fk_hz_fop_export_items_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_export_items
    ADD CONSTRAINT fk_hz_fop_export_items_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_export_items fk_hz_fop_export_items_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_export_items
    ADD CONSTRAINT fk_hz_fop_export_items_3 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_export_items fk_hz_fop_export_items_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_export_items
    ADD CONSTRAINT fk_hz_fop_export_items_4 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_export_items fk_hz_fop_export_items_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_export_items
    ADD CONSTRAINT fk_hz_fop_export_items_5 FOREIGN KEY (company_id, dataset_id, export_job_id) REFERENCES public.hz_fop_export_jobs(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_export_jobs fk_hz_fop_export_jobs_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_export_jobs
    ADD CONSTRAINT fk_hz_fop_export_jobs_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_export_jobs fk_hz_fop_export_jobs_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_export_jobs
    ADD CONSTRAINT fk_hz_fop_export_jobs_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_export_jobs fk_hz_fop_export_jobs_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_export_jobs
    ADD CONSTRAINT fk_hz_fop_export_jobs_3 FOREIGN KEY (actor_account_id) REFERENCES public.users(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_export_jobs fk_hz_fop_export_jobs_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_export_jobs
    ADD CONSTRAINT fk_hz_fop_export_jobs_4 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_financial_line_details fk_hz_fop_financial_line_details_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_financial_line_details
    ADD CONSTRAINT fk_hz_fop_financial_line_details_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_financial_line_details fk_hz_fop_financial_line_details_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_financial_line_details
    ADD CONSTRAINT fk_hz_fop_financial_line_details_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_financial_line_details fk_hz_fop_financial_line_details_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_financial_line_details
    ADD CONSTRAINT fk_hz_fop_financial_line_details_3 FOREIGN KEY (company_id, dataset_id, line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_fulfillment_orders fk_hz_fop_fulfillment_orders_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_fulfillment_orders
    ADD CONSTRAINT fk_hz_fop_fulfillment_orders_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_fulfillment_orders fk_hz_fop_fulfillment_orders_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_fulfillment_orders
    ADD CONSTRAINT fk_hz_fop_fulfillment_orders_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_fulfillment_orders fk_hz_fop_fulfillment_orders_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_fulfillment_orders
    ADD CONSTRAINT fk_hz_fop_fulfillment_orders_3 FOREIGN KEY (company_id, dataset_id, document_id, entity_code) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id, entity_code) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_inbound_bills fk_hz_fop_inbound_bills_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_inbound_bills
    ADD CONSTRAINT fk_hz_fop_inbound_bills_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_inbound_bills fk_hz_fop_inbound_bills_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_inbound_bills
    ADD CONSTRAINT fk_hz_fop_inbound_bills_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_inbound_bills fk_hz_fop_inbound_bills_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_inbound_bills
    ADD CONSTRAINT fk_hz_fop_inbound_bills_3 FOREIGN KEY (company_id, dataset_id, document_id, entity_code) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id, entity_code) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_inventory_balances fk_hz_fop_inventory_balances_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_inventory_balances
    ADD CONSTRAINT fk_hz_fop_inventory_balances_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_inventory_balances fk_hz_fop_inventory_balances_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_inventory_balances
    ADD CONSTRAINT fk_hz_fop_inventory_balances_2 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_inventory_line_details fk_hz_fop_inventory_line_details_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_inventory_line_details
    ADD CONSTRAINT fk_hz_fop_inventory_line_details_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_inventory_line_details fk_hz_fop_inventory_line_details_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_inventory_line_details
    ADD CONSTRAINT fk_hz_fop_inventory_line_details_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_inventory_line_details fk_hz_fop_inventory_line_details_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_inventory_line_details
    ADD CONSTRAINT fk_hz_fop_inventory_line_details_3 FOREIGN KEY (company_id, dataset_id, line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_order_flags fk_hz_fop_order_flags_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_flags
    ADD CONSTRAINT fk_hz_fop_order_flags_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_order_flags fk_hz_fop_order_flags_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_flags
    ADD CONSTRAINT fk_hz_fop_order_flags_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_order_flags fk_hz_fop_order_flags_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_flags
    ADD CONSTRAINT fk_hz_fop_order_flags_3 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_order_flags fk_hz_fop_order_flags_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_flags
    ADD CONSTRAINT fk_hz_fop_order_flags_4 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_order_flags fk_hz_fop_order_flags_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_flags
    ADD CONSTRAINT fk_hz_fop_order_flags_5 FOREIGN KEY (company_id, dataset_id, source_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_order_line_details fk_hz_fop_order_line_details_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_line_details
    ADD CONSTRAINT fk_hz_fop_order_line_details_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_order_line_details fk_hz_fop_order_line_details_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_line_details
    ADD CONSTRAINT fk_hz_fop_order_line_details_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_order_line_details fk_hz_fop_order_line_details_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_line_details
    ADD CONSTRAINT fk_hz_fop_order_line_details_3 FOREIGN KEY (company_id, dataset_id, line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_order_packages fk_hz_fop_order_packages_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_packages
    ADD CONSTRAINT fk_hz_fop_order_packages_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_order_packages fk_hz_fop_order_packages_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_packages
    ADD CONSTRAINT fk_hz_fop_order_packages_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_order_packages fk_hz_fop_order_packages_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_packages
    ADD CONSTRAINT fk_hz_fop_order_packages_3 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_order_packages fk_hz_fop_order_packages_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_packages
    ADD CONSTRAINT fk_hz_fop_order_packages_4 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_outbound_bills fk_hz_fop_outbound_bills_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_outbound_bills
    ADD CONSTRAINT fk_hz_fop_outbound_bills_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_outbound_bills fk_hz_fop_outbound_bills_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_outbound_bills
    ADD CONSTRAINT fk_hz_fop_outbound_bills_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_outbound_bills fk_hz_fop_outbound_bills_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_outbound_bills
    ADD CONSTRAINT fk_hz_fop_outbound_bills_3 FOREIGN KEY (company_id, dataset_id, document_id, entity_code) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id, entity_code) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_package_lines fk_hz_fop_package_lines_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_package_lines
    ADD CONSTRAINT fk_hz_fop_package_lines_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_package_lines fk_hz_fop_package_lines_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_package_lines
    ADD CONSTRAINT fk_hz_fop_package_lines_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_package_lines fk_hz_fop_package_lines_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_package_lines
    ADD CONSTRAINT fk_hz_fop_package_lines_3 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_package_lines fk_hz_fop_package_lines_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_package_lines
    ADD CONSTRAINT fk_hz_fop_package_lines_4 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_package_lines fk_hz_fop_package_lines_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_package_lines
    ADD CONSTRAINT fk_hz_fop_package_lines_5 FOREIGN KEY (company_id, dataset_id, order_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_package_lines fk_hz_fop_package_lines_6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_package_lines
    ADD CONSTRAINT fk_hz_fop_package_lines_6 FOREIGN KEY (company_id, dataset_id, package_id) REFERENCES public.hz_fop_order_packages(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_package_lines fk_hz_fop_package_lines_7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_package_lines
    ADD CONSTRAINT fk_hz_fop_package_lines_7 FOREIGN KEY (company_id, dataset_id, order_document_id, order_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, document_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_package_lines fk_hz_fop_package_lines_8; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_package_lines
    ADD CONSTRAINT fk_hz_fop_package_lines_8 FOREIGN KEY (company_id, dataset_id, order_document_id, package_id) REFERENCES public.hz_fop_order_packages(company_id, dataset_id, order_document_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_payments fk_hz_fop_payments_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_payments
    ADD CONSTRAINT fk_hz_fop_payments_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_payments fk_hz_fop_payments_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_payments
    ADD CONSTRAINT fk_hz_fop_payments_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_payments fk_hz_fop_payments_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_payments
    ADD CONSTRAINT fk_hz_fop_payments_3 FOREIGN KEY (company_id, dataset_id, document_id, entity_code) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id, entity_code) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_platform_orders fk_hz_fop_platform_orders_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_platform_orders
    ADD CONSTRAINT fk_hz_fop_platform_orders_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_platform_orders fk_hz_fop_platform_orders_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_platform_orders
    ADD CONSTRAINT fk_hz_fop_platform_orders_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_platform_orders fk_hz_fop_platform_orders_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_platform_orders
    ADD CONSTRAINT fk_hz_fop_platform_orders_3 FOREIGN KEY (company_id, dataset_id, purchase_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_platform_orders fk_hz_fop_platform_orders_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_platform_orders
    ADD CONSTRAINT fk_hz_fop_platform_orders_4 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_procurement_line_details fk_hz_fop_procurement_line_details_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_procurement_line_details
    ADD CONSTRAINT fk_hz_fop_procurement_line_details_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_procurement_line_details fk_hz_fop_procurement_line_details_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_procurement_line_details
    ADD CONSTRAINT fk_hz_fop_procurement_line_details_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_procurement_line_details fk_hz_fop_procurement_line_details_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_procurement_line_details
    ADD CONSTRAINT fk_hz_fop_procurement_line_details_3 FOREIGN KEY (company_id, dataset_id, line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_projection_dependencies fk_hz_fop_projection_dependencies_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_projection_dependencies
    ADD CONSTRAINT fk_hz_fop_projection_dependencies_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_projection_dependencies fk_hz_fop_projection_dependencies_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_projection_dependencies
    ADD CONSTRAINT fk_hz_fop_projection_dependencies_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_projection_dependencies fk_hz_fop_projection_dependencies_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_projection_dependencies
    ADD CONSTRAINT fk_hz_fop_projection_dependencies_3 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_projection_dependencies fk_hz_fop_projection_dependencies_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_projection_dependencies
    ADD CONSTRAINT fk_hz_fop_projection_dependencies_4 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_projection_dependencies fk_hz_fop_projection_dependencies_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_projection_dependencies
    ADD CONSTRAINT fk_hz_fop_projection_dependencies_5 FOREIGN KEY (company_id, dataset_id, source_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_projection_dependencies fk_hz_fop_projection_dependencies_6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_projection_dependencies
    ADD CONSTRAINT fk_hz_fop_projection_dependencies_6 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_workbench_orders(company_id, dataset_id, document_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_purchase_orders fk_hz_fop_purchase_orders_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_purchase_orders
    ADD CONSTRAINT fk_hz_fop_purchase_orders_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_purchase_orders fk_hz_fop_purchase_orders_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_purchase_orders
    ADD CONSTRAINT fk_hz_fop_purchase_orders_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_purchase_orders fk_hz_fop_purchase_orders_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_purchase_orders
    ADD CONSTRAINT fk_hz_fop_purchase_orders_3 FOREIGN KEY (company_id, dataset_id, document_id, entity_code) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id, entity_code) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_purchase_requisitions fk_hz_fop_purchase_requisitions_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_purchase_requisitions
    ADD CONSTRAINT fk_hz_fop_purchase_requisitions_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_purchase_requisitions fk_hz_fop_purchase_requisitions_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_purchase_requisitions
    ADD CONSTRAINT fk_hz_fop_purchase_requisitions_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_purchase_requisitions fk_hz_fop_purchase_requisitions_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_purchase_requisitions
    ADD CONSTRAINT fk_hz_fop_purchase_requisitions_3 FOREIGN KEY (company_id, dataset_id, document_id, entity_code) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id, entity_code) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_purchase_returns fk_hz_fop_purchase_returns_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_purchase_returns
    ADD CONSTRAINT fk_hz_fop_purchase_returns_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_purchase_returns fk_hz_fop_purchase_returns_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_purchase_returns
    ADD CONSTRAINT fk_hz_fop_purchase_returns_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_purchase_returns fk_hz_fop_purchase_returns_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_purchase_returns
    ADD CONSTRAINT fk_hz_fop_purchase_returns_3 FOREIGN KEY (company_id, dataset_id, document_id, entity_code) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id, entity_code) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_receipt_adjustments fk_hz_fop_receipt_adjustments_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_receipt_adjustments
    ADD CONSTRAINT fk_hz_fop_receipt_adjustments_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_receipt_adjustments fk_hz_fop_receipt_adjustments_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_receipt_adjustments
    ADD CONSTRAINT fk_hz_fop_receipt_adjustments_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_receipt_adjustments fk_hz_fop_receipt_adjustments_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_receipt_adjustments
    ADD CONSTRAINT fk_hz_fop_receipt_adjustments_3 FOREIGN KEY (company_id, dataset_id, document_id, entity_code) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id, entity_code) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_receipt_notices fk_hz_fop_receipt_notices_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_receipt_notices
    ADD CONSTRAINT fk_hz_fop_receipt_notices_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_receipt_notices fk_hz_fop_receipt_notices_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_receipt_notices
    ADD CONSTRAINT fk_hz_fop_receipt_notices_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_receipt_notices fk_hz_fop_receipt_notices_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_receipt_notices
    ADD CONSTRAINT fk_hz_fop_receipt_notices_3 FOREIGN KEY (company_id, dataset_id, document_id, entity_code) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id, entity_code) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_receipts fk_hz_fop_receipts_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_receipts
    ADD CONSTRAINT fk_hz_fop_receipts_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_receipts fk_hz_fop_receipts_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_receipts
    ADD CONSTRAINT fk_hz_fop_receipts_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_receipts fk_hz_fop_receipts_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_receipts
    ADD CONSTRAINT fk_hz_fop_receipts_3 FOREIGN KEY (company_id, dataset_id, document_id, entity_code) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id, entity_code) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_reconciliation_runs fk_hz_fop_reconciliation_runs_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_reconciliation_runs
    ADD CONSTRAINT fk_hz_fop_reconciliation_runs_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_reconciliation_runs fk_hz_fop_reconciliation_runs_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_reconciliation_runs
    ADD CONSTRAINT fk_hz_fop_reconciliation_runs_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_reconciliation_runs fk_hz_fop_reconciliation_runs_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_reconciliation_runs
    ADD CONSTRAINT fk_hz_fop_reconciliation_runs_3 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_reference_items fk_hz_fop_reference_items_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_reference_items
    ADD CONSTRAINT fk_hz_fop_reference_items_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_reference_items fk_hz_fop_reference_items_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_reference_items
    ADD CONSTRAINT fk_hz_fop_reference_items_2 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_refresh_requests fk_hz_fop_refresh_requests_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_refresh_requests
    ADD CONSTRAINT fk_hz_fop_refresh_requests_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_refresh_requests fk_hz_fop_refresh_requests_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_refresh_requests
    ADD CONSTRAINT fk_hz_fop_refresh_requests_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_refresh_requests fk_hz_fop_refresh_requests_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_refresh_requests
    ADD CONSTRAINT fk_hz_fop_refresh_requests_3 FOREIGN KEY (company_id, dataset_id, barrier_id) REFERENCES public.hz_fop_sync_barriers(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_refresh_requests fk_hz_fop_refresh_requests_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_refresh_requests
    ADD CONSTRAINT fk_hz_fop_refresh_requests_4 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_refresh_requests fk_hz_fop_refresh_requests_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_refresh_requests
    ADD CONSTRAINT fk_hz_fop_refresh_requests_5 FOREIGN KEY (actor_account_id) REFERENCES public.users(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_refresh_requests fk_hz_fop_refresh_requests_6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_refresh_requests
    ADD CONSTRAINT fk_hz_fop_refresh_requests_6 FOREIGN KEY (company_id, dataset_id, sync_run_id) REFERENCES public.hz_fop_sync_runs(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_resource_grants fk_hz_fop_resource_grants_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_resource_grants
    ADD CONSTRAINT fk_hz_fop_resource_grants_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_resource_grants fk_hz_fop_resource_grants_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_resource_grants
    ADD CONSTRAINT fk_hz_fop_resource_grants_2 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_return_line_details fk_hz_fop_return_line_details_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_return_line_details
    ADD CONSTRAINT fk_hz_fop_return_line_details_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_return_line_details fk_hz_fop_return_line_details_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_return_line_details
    ADD CONSTRAINT fk_hz_fop_return_line_details_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_return_line_details fk_hz_fop_return_line_details_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_return_line_details
    ADD CONSTRAINT fk_hz_fop_return_line_details_3 FOREIGN KEY (company_id, dataset_id, line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_rma_orders fk_hz_fop_rma_orders_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_rma_orders
    ADD CONSTRAINT fk_hz_fop_rma_orders_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_rma_orders fk_hz_fop_rma_orders_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_rma_orders
    ADD CONSTRAINT fk_hz_fop_rma_orders_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_rma_orders fk_hz_fop_rma_orders_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_rma_orders
    ADD CONSTRAINT fk_hz_fop_rma_orders_3 FOREIGN KEY (company_id, dataset_id, document_id, entity_code) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id, entity_code) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_source_documents fk_hz_fop_source_documents_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_source_documents
    ADD CONSTRAINT fk_hz_fop_source_documents_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_source_documents fk_hz_fop_source_documents_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_source_documents
    ADD CONSTRAINT fk_hz_fop_source_documents_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_source_documents fk_hz_fop_source_documents_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_source_documents
    ADD CONSTRAINT fk_hz_fop_source_documents_3 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_source_lines fk_hz_fop_source_lines_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_source_lines
    ADD CONSTRAINT fk_hz_fop_source_lines_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_source_lines fk_hz_fop_source_lines_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_source_lines
    ADD CONSTRAINT fk_hz_fop_source_lines_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_source_lines fk_hz_fop_source_lines_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_source_lines
    ADD CONSTRAINT fk_hz_fop_source_lines_3 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_source_lines fk_hz_fop_source_lines_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_source_lines
    ADD CONSTRAINT fk_hz_fop_source_lines_4 FOREIGN KEY (company_id, dataset_id, document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_source_lines fk_hz_fop_source_lines_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_source_lines
    ADD CONSTRAINT fk_hz_fop_source_lines_5 FOREIGN KEY (company_id, dataset_id, document_id, parent_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, document_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_stock_consumptions fk_hz_fop_stock_consumptions_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_stock_consumptions
    ADD CONSTRAINT fk_hz_fop_stock_consumptions_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_stock_consumptions fk_hz_fop_stock_consumptions_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_stock_consumptions
    ADD CONSTRAINT fk_hz_fop_stock_consumptions_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_stock_consumptions fk_hz_fop_stock_consumptions_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_stock_consumptions
    ADD CONSTRAINT fk_hz_fop_stock_consumptions_3 FOREIGN KEY (company_id, dataset_id, stock_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_stock_consumptions fk_hz_fop_stock_consumptions_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_stock_consumptions
    ADD CONSTRAINT fk_hz_fop_stock_consumptions_4 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_stock_consumptions fk_hz_fop_stock_consumptions_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_stock_consumptions
    ADD CONSTRAINT fk_hz_fop_stock_consumptions_5 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_stock_consumptions fk_hz_fop_stock_consumptions_6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_stock_consumptions
    ADD CONSTRAINT fk_hz_fop_stock_consumptions_6 FOREIGN KEY (company_id, dataset_id, order_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_stock_consumptions fk_hz_fop_stock_consumptions_7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_stock_consumptions
    ADD CONSTRAINT fk_hz_fop_stock_consumptions_7 FOREIGN KEY (company_id, dataset_id, stock_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_stock_consumptions fk_hz_fop_stock_consumptions_8; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_stock_consumptions
    ADD CONSTRAINT fk_hz_fop_stock_consumptions_8 FOREIGN KEY (company_id, dataset_id, stock_document_id, stock_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, document_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_stock_consumptions fk_hz_fop_stock_consumptions_9; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_stock_consumptions
    ADD CONSTRAINT fk_hz_fop_stock_consumptions_9 FOREIGN KEY (company_id, dataset_id, order_document_id, order_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, document_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_stock_orders fk_hz_fop_stock_orders_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_stock_orders
    ADD CONSTRAINT fk_hz_fop_stock_orders_1 FOREIGN KEY (company_id) REFERENCES public.hz_fop_companies(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_stock_orders fk_hz_fop_stock_orders_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_stock_orders
    ADD CONSTRAINT fk_hz_fop_stock_orders_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_stock_orders fk_hz_fop_stock_orders_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_stock_orders
    ADD CONSTRAINT fk_hz_fop_stock_orders_3 FOREIGN KEY (company_id, dataset_id, document_id, entity_code) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id, entity_code) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_barriers fk_hz_fop_sync_barriers_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_barriers
    ADD CONSTRAINT fk_hz_fop_sync_barriers_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_barriers fk_hz_fop_sync_barriers_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_barriers
    ADD CONSTRAINT fk_hz_fop_sync_barriers_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_barriers fk_hz_fop_sync_barriers_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_barriers
    ADD CONSTRAINT fk_hz_fop_sync_barriers_3 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_barriers fk_hz_fop_sync_barriers_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_barriers
    ADD CONSTRAINT fk_hz_fop_sync_barriers_4 FOREIGN KEY (company_id, dataset_id, sync_run_id) REFERENCES public.hz_fop_sync_runs(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_commit_groups fk_hz_fop_sync_commit_groups_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_commit_groups
    ADD CONSTRAINT fk_hz_fop_sync_commit_groups_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_commit_groups fk_hz_fop_sync_commit_groups_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_commit_groups
    ADD CONSTRAINT fk_hz_fop_sync_commit_groups_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_commit_groups fk_hz_fop_sync_commit_groups_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_commit_groups
    ADD CONSTRAINT fk_hz_fop_sync_commit_groups_3 FOREIGN KEY (company_id, dataset_id, stream_id) REFERENCES public.hz_fop_sync_streams(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_commit_groups fk_hz_fop_sync_commit_groups_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_commit_groups
    ADD CONSTRAINT fk_hz_fop_sync_commit_groups_4 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_event_requirements fk_hz_fop_sync_event_requirements_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_event_requirements
    ADD CONSTRAINT fk_hz_fop_sync_event_requirements_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_event_requirements fk_hz_fop_sync_event_requirements_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_event_requirements
    ADD CONSTRAINT fk_hz_fop_sync_event_requirements_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_event_requirements fk_hz_fop_sync_event_requirements_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_event_requirements
    ADD CONSTRAINT fk_hz_fop_sync_event_requirements_3 FOREIGN KEY (company_id, dataset_id, task_id) REFERENCES public.hz_fop_sync_tasks(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_event_requirements fk_hz_fop_sync_event_requirements_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_event_requirements
    ADD CONSTRAINT fk_hz_fop_sync_event_requirements_4 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_event_requirements fk_hz_fop_sync_event_requirements_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_event_requirements
    ADD CONSTRAINT fk_hz_fop_sync_event_requirements_5 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_event_requirements fk_hz_fop_sync_event_requirements_6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_event_requirements
    ADD CONSTRAINT fk_hz_fop_sync_event_requirements_6 FOREIGN KEY (company_id, dataset_id, event_id) REFERENCES public.hz_fop_sync_events(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_events fk_hz_fop_sync_events_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_events
    ADD CONSTRAINT fk_hz_fop_sync_events_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_events fk_hz_fop_sync_events_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_events
    ADD CONSTRAINT fk_hz_fop_sync_events_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_events fk_hz_fop_sync_events_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_events
    ADD CONSTRAINT fk_hz_fop_sync_events_3 FOREIGN KEY (company_id, dataset_id, stream_id) REFERENCES public.hz_fop_sync_streams(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_events fk_hz_fop_sync_events_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_events
    ADD CONSTRAINT fk_hz_fop_sync_events_4 FOREIGN KEY (company_id, dataset_id, commit_group_id) REFERENCES public.hz_fop_sync_commit_groups(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_events fk_hz_fop_sync_events_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_events
    ADD CONSTRAINT fk_hz_fop_sync_events_5 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_events fk_hz_fop_sync_events_6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_events
    ADD CONSTRAINT fk_hz_fop_sync_events_6 FOREIGN KEY (company_id, dataset_id, stream_id, commit_group_id) REFERENCES public.hz_fop_sync_commit_groups(company_id, dataset_id, stream_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_issues fk_hz_fop_sync_issues_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_issues
    ADD CONSTRAINT fk_hz_fop_sync_issues_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_issues fk_hz_fop_sync_issues_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_issues
    ADD CONSTRAINT fk_hz_fop_sync_issues_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_issues fk_hz_fop_sync_issues_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_issues
    ADD CONSTRAINT fk_hz_fop_sync_issues_3 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_issues fk_hz_fop_sync_issues_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_issues
    ADD CONSTRAINT fk_hz_fop_sync_issues_4 FOREIGN KEY (company_id, dataset_id, document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_issues fk_hz_fop_sync_issues_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_issues
    ADD CONSTRAINT fk_hz_fop_sync_issues_5 FOREIGN KEY (company_id, dataset_id, event_id) REFERENCES public.hz_fop_sync_events(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_runs fk_hz_fop_sync_runs_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_runs
    ADD CONSTRAINT fk_hz_fop_sync_runs_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_runs fk_hz_fop_sync_runs_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_runs
    ADD CONSTRAINT fk_hz_fop_sync_runs_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_runs fk_hz_fop_sync_runs_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_runs
    ADD CONSTRAINT fk_hz_fop_sync_runs_3 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_streams fk_hz_fop_sync_streams_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_streams
    ADD CONSTRAINT fk_hz_fop_sync_streams_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_streams fk_hz_fop_sync_streams_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_streams
    ADD CONSTRAINT fk_hz_fop_sync_streams_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_streams fk_hz_fop_sync_streams_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_streams
    ADD CONSTRAINT fk_hz_fop_sync_streams_3 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_tasks fk_hz_fop_sync_tasks_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_tasks
    ADD CONSTRAINT fk_hz_fop_sync_tasks_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_tasks fk_hz_fop_sync_tasks_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_tasks
    ADD CONSTRAINT fk_hz_fop_sync_tasks_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_tasks fk_hz_fop_sync_tasks_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_tasks
    ADD CONSTRAINT fk_hz_fop_sync_tasks_3 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_sync_tasks fk_hz_fop_sync_tasks_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_sync_tasks
    ADD CONSTRAINT fk_hz_fop_sync_tasks_4 FOREIGN KEY (company_id, dataset_id, document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_tracking_events fk_hz_fop_tracking_events_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_tracking_events
    ADD CONSTRAINT fk_hz_fop_tracking_events_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_tracking_events fk_hz_fop_tracking_events_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_tracking_events
    ADD CONSTRAINT fk_hz_fop_tracking_events_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_tracking_events fk_hz_fop_tracking_events_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_tracking_events
    ADD CONSTRAINT fk_hz_fop_tracking_events_3 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_tracking_events fk_hz_fop_tracking_events_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_tracking_events
    ADD CONSTRAINT fk_hz_fop_tracking_events_4 FOREIGN KEY (company_id, dataset_id, dispatch_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_tracking_numbers fk_hz_fop_tracking_numbers_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_tracking_numbers
    ADD CONSTRAINT fk_hz_fop_tracking_numbers_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_tracking_numbers fk_hz_fop_tracking_numbers_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_tracking_numbers
    ADD CONSTRAINT fk_hz_fop_tracking_numbers_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_tracking_numbers fk_hz_fop_tracking_numbers_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_tracking_numbers
    ADD CONSTRAINT fk_hz_fop_tracking_numbers_3 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_tracking_numbers fk_hz_fop_tracking_numbers_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_tracking_numbers
    ADD CONSTRAINT fk_hz_fop_tracking_numbers_4 FOREIGN KEY (company_id, dataset_id, dispatch_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_tracking_numbers fk_hz_fop_tracking_numbers_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_tracking_numbers
    ADD CONSTRAINT fk_hz_fop_tracking_numbers_5 FOREIGN KEY (company_id, dataset_id, package_id) REFERENCES public.hz_fop_order_packages(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_memberships fk_hz_fop_workbench_memberships_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_memberships
    ADD CONSTRAINT fk_hz_fop_workbench_memberships_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_memberships fk_hz_fop_workbench_memberships_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_memberships
    ADD CONSTRAINT fk_hz_fop_workbench_memberships_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_memberships fk_hz_fop_workbench_memberships_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_memberships
    ADD CONSTRAINT fk_hz_fop_workbench_memberships_3 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_memberships fk_hz_fop_workbench_memberships_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_memberships
    ADD CONSTRAINT fk_hz_fop_workbench_memberships_4 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_memberships fk_hz_fop_workbench_memberships_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_memberships
    ADD CONSTRAINT fk_hz_fop_workbench_memberships_5 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_workbench_orders(company_id, dataset_id, document_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_order_lines fk_hz_fop_workbench_order_lines_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_order_lines
    ADD CONSTRAINT fk_hz_fop_workbench_order_lines_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_order_lines fk_hz_fop_workbench_order_lines_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_order_lines
    ADD CONSTRAINT fk_hz_fop_workbench_order_lines_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_order_lines fk_hz_fop_workbench_order_lines_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_order_lines
    ADD CONSTRAINT fk_hz_fop_workbench_order_lines_3 FOREIGN KEY (company_id, dataset_id, source_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_order_lines fk_hz_fop_workbench_order_lines_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_order_lines
    ADD CONSTRAINT fk_hz_fop_workbench_order_lines_4 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_order_lines fk_hz_fop_workbench_order_lines_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_order_lines
    ADD CONSTRAINT fk_hz_fop_workbench_order_lines_5 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_order_lines fk_hz_fop_workbench_order_lines_6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_order_lines
    ADD CONSTRAINT fk_hz_fop_workbench_order_lines_6 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_workbench_orders(company_id, dataset_id, document_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_order_lines fk_hz_fop_workbench_order_lines_7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_order_lines
    ADD CONSTRAINT fk_hz_fop_workbench_order_lines_7 FOREIGN KEY (company_id, dataset_id, order_document_id, source_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, document_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_orders fk_hz_fop_workbench_orders_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_orders
    ADD CONSTRAINT fk_hz_fop_workbench_orders_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_orders fk_hz_fop_workbench_orders_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_orders
    ADD CONSTRAINT fk_hz_fop_workbench_orders_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_orders fk_hz_fop_workbench_orders_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_orders
    ADD CONSTRAINT fk_hz_fop_workbench_orders_3 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_orders fk_hz_fop_workbench_orders_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_orders
    ADD CONSTRAINT fk_hz_fop_workbench_orders_4 FOREIGN KEY (company_id, dataset_id, document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_procurement_demands fk_hz_fop_workbench_procurement_demands_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_procurement_demands
    ADD CONSTRAINT fk_hz_fop_workbench_procurement_demands_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_procurement_demands fk_hz_fop_workbench_procurement_demands_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_procurement_demands
    ADD CONSTRAINT fk_hz_fop_workbench_procurement_demands_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_procurement_demands fk_hz_fop_workbench_procurement_demands_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_procurement_demands
    ADD CONSTRAINT fk_hz_fop_workbench_procurement_demands_3 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_procurement_demands fk_hz_fop_workbench_procurement_demands_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_procurement_demands
    ADD CONSTRAINT fk_hz_fop_workbench_procurement_demands_4 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_procurement_demands fk_hz_fop_workbench_procurement_demands_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_procurement_demands
    ADD CONSTRAINT fk_hz_fop_workbench_procurement_demands_5 FOREIGN KEY (company_id, dataset_id, order_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_procurement_demands fk_hz_fop_workbench_procurement_demands_6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_procurement_demands
    ADD CONSTRAINT fk_hz_fop_workbench_procurement_demands_6 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_workbench_orders(company_id, dataset_id, document_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_procurement_demands fk_hz_fop_workbench_procurement_demands_7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_procurement_demands
    ADD CONSTRAINT fk_hz_fop_workbench_procurement_demands_7 FOREIGN KEY (company_id, dataset_id, order_document_id, order_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, document_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_purchase_allocations fk_hz_fop_workbench_purchase_allocations_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_purchase_allocations
    ADD CONSTRAINT fk_hz_fop_workbench_purchase_allocations_1 FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_purchase_allocations fk_hz_fop_workbench_purchase_allocations_10; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_purchase_allocations
    ADD CONSTRAINT fk_hz_fop_workbench_purchase_allocations_10 FOREIGN KEY (company_id, dataset_id, purchase_document_id, purchase_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, document_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_purchase_allocations fk_hz_fop_workbench_purchase_allocations_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_purchase_allocations
    ADD CONSTRAINT fk_hz_fop_workbench_purchase_allocations_2 FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_purchase_allocations fk_hz_fop_workbench_purchase_allocations_3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_purchase_allocations
    ADD CONSTRAINT fk_hz_fop_workbench_purchase_allocations_3 FOREIGN KEY (company_id, dataset_id, purchase_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_purchase_allocations fk_hz_fop_workbench_purchase_allocations_4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_purchase_allocations
    ADD CONSTRAINT fk_hz_fop_workbench_purchase_allocations_4 FOREIGN KEY (company_id, dataset_id, order_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_purchase_allocations fk_hz_fop_workbench_purchase_allocations_5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_purchase_allocations
    ADD CONSTRAINT fk_hz_fop_workbench_purchase_allocations_5 FOREIGN KEY (company_id, dataset_id, purchase_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_purchase_allocations fk_hz_fop_workbench_purchase_allocations_6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_purchase_allocations
    ADD CONSTRAINT fk_hz_fop_workbench_purchase_allocations_6 FOREIGN KEY (connection_id) REFERENCES public.hz_fop_connections(id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_purchase_allocations fk_hz_fop_workbench_purchase_allocations_7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_purchase_allocations
    ADD CONSTRAINT fk_hz_fop_workbench_purchase_allocations_7 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_purchase_allocations fk_hz_fop_workbench_purchase_allocations_8; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_purchase_allocations
    ADD CONSTRAINT fk_hz_fop_workbench_purchase_allocations_8 FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_workbench_orders(company_id, dataset_id, document_id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: hz_fop_workbench_purchase_allocations fk_hz_fop_workbench_purchase_allocations_9; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_purchase_allocations
    ADD CONSTRAINT fk_hz_fop_workbench_purchase_allocations_9 FOREIGN KEY (company_id, dataset_id, order_document_id, order_line_id) REFERENCES public.hz_fop_source_lines(company_id, dataset_id, document_id, id) ON DELETE RESTRICT DEFERRABLE;


--
-- Name: lead_contacts fk_lead_contacts_lead; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_contacts
    ADD CONSTRAINT fk_lead_contacts_lead FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_scores fk_lead_scores_lead; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_scores
    ADD CONSTRAINT fk_lead_scores_lead FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_scores fk_lead_scores_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_scores
    ADD CONSTRAINT fk_lead_scores_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: lead_scores fk_lead_scores_workflow_run; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_scores
    ADD CONSTRAINT fk_lead_scores_workflow_run FOREIGN KEY (workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE SET NULL;


--
-- Name: leads fk_leads_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT fk_leads_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: leads fk_leads_workflow_run; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT fk_leads_workflow_run FOREIGN KEY (workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE SET NULL;


--
-- Name: organization_employees fk_organization_employees_department; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_employees
    ADD CONSTRAINT fk_organization_employees_department FOREIGN KEY (department_id, owner_user_id) REFERENCES public.organization_nodes(id, owner_user_id);


--
-- Name: organization_nodes fk_organization_nodes_parent; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_nodes
    ADD CONSTRAINT fk_organization_nodes_parent FOREIGN KEY (parent_id, owner_user_id) REFERENCES public.organization_nodes(id, owner_user_id);


--
-- Name: outreach_draft_versions fk_outreach_draft_versions_conversation; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_draft_versions
    ADD CONSTRAINT fk_outreach_draft_versions_conversation FOREIGN KEY (conversation_id) REFERENCES public.ai_outreach_conversations(id) ON DELETE CASCADE;


--
-- Name: outreach_draft_versions fk_outreach_draft_versions_lead; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_draft_versions
    ADD CONSTRAINT fk_outreach_draft_versions_lead FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: outreach_draft_versions fk_outreach_draft_versions_task; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_draft_versions
    ADD CONSTRAINT fk_outreach_draft_versions_task FOREIGN KEY (outreach_task_id) REFERENCES public.outreach_tasks(id) ON DELETE SET NULL;


--
-- Name: outreach_tasks fk_outreach_tasks_lead; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_tasks
    ADD CONSTRAINT fk_outreach_tasks_lead FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: outreach_tasks fk_outreach_tasks_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_tasks
    ADD CONSTRAINT fk_outreach_tasks_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: quotation_versions fk_quotation_versions_creator; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_versions
    ADD CONSTRAINT fk_quotation_versions_creator FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: quotation_versions fk_quotation_versions_quote; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_versions
    ADD CONSTRAINT fk_quotation_versions_quote FOREIGN KEY (quotation_id) REFERENCES public.quotations(id) ON DELETE CASCADE;


--
-- Name: quotations fk_quotations_lead; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT fk_quotations_lead FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: quotations fk_quotations_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT fk_quotations_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: shopify_stores fk_shopify_stores_lead; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopify_stores
    ADD CONSTRAINT fk_shopify_stores_lead FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: shopify_stores fk_shopify_stores_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopify_stores
    ADD CONSTRAINT fk_shopify_stores_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: shopify_stores fk_shopify_stores_workflow_run; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopify_stores
    ADD CONSTRAINT fk_shopify_stores_workflow_run FOREIGN KEY (workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- Name: sourcing_offers fk_sourcing_offers_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_offers
    ADD CONSTRAINT fk_sourcing_offers_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: sourcing_offers fk_sourcing_offers_search; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_offers
    ADD CONSTRAINT fk_sourcing_offers_search FOREIGN KEY (search_id) REFERENCES public.sourcing_searches(id) ON DELETE CASCADE;


--
-- Name: sourcing_offers fk_sourcing_offers_supplier; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_offers
    ADD CONSTRAINT fk_sourcing_offers_supplier FOREIGN KEY (supplier_id) REFERENCES public.sourcing_suppliers(id) ON DELETE SET NULL;


--
-- Name: sourcing_offers fk_sourcing_offers_workflow; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_offers
    ADD CONSTRAINT fk_sourcing_offers_workflow FOREIGN KEY (workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- Name: sourcing_search_pages fk_sourcing_search_pages_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_search_pages
    ADD CONSTRAINT fk_sourcing_search_pages_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: sourcing_search_pages fk_sourcing_search_pages_search; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_search_pages
    ADD CONSTRAINT fk_sourcing_search_pages_search FOREIGN KEY (search_id) REFERENCES public.sourcing_searches(id) ON DELETE CASCADE;


--
-- Name: sourcing_searches fk_sourcing_searches_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_searches
    ADD CONSTRAINT fk_sourcing_searches_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: sourcing_searches fk_sourcing_searches_workflow; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_searches
    ADD CONSTRAINT fk_sourcing_searches_workflow FOREIGN KEY (workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- Name: sourcing_suppliers fk_sourcing_suppliers_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_suppliers
    ADD CONSTRAINT fk_sourcing_suppliers_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: sourcing_suppliers fk_sourcing_suppliers_search; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_suppliers
    ADD CONSTRAINT fk_sourcing_suppliers_search FOREIGN KEY (search_id) REFERENCES public.sourcing_searches(id) ON DELETE CASCADE;


--
-- Name: sourcing_suppliers fk_sourcing_suppliers_workflow; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sourcing_suppliers
    ADD CONSTRAINT fk_sourcing_suppliers_workflow FOREIGN KEY (workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- Name: users fk_user_directory_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_user_directory_owner FOREIGN KEY (organization_workspace_owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: workflow_jobs fk_workflow_jobs_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_jobs
    ADD CONSTRAINT fk_workflow_jobs_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: workflow_jobs fk_workflow_jobs_run; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_jobs
    ADD CONSTRAINT fk_workflow_jobs_run FOREIGN KEY (workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- Name: workflow_leads fk_workflow_leads_lead; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_leads
    ADD CONSTRAINT fk_workflow_leads_lead FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: workflow_leads fk_workflow_leads_run; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_leads
    ADD CONSTRAINT fk_workflow_leads_run FOREIGN KEY (workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- Name: workflow_runs fk_workflow_runs_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT fk_workflow_runs_owner FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: workflow_runs fk_workflow_runs_parent; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT fk_workflow_runs_parent FOREIGN KEY (parent_workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE SET NULL;


--
-- Name: workflow_runs fk_workflow_runs_root; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT fk_workflow_runs_root FOREIGN KEY (root_workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE SET NULL;


--
-- Name: workflow_steps fk_workflow_steps_run; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_steps
    ADD CONSTRAINT fk_workflow_steps_run FOREIGN KEY (workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- Name: hz_fop_bootstrap_pages hz_fop_bootstrap_pages_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_bootstrap_pages
    ADD CONSTRAINT hz_fop_bootstrap_pages_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.hz_fop_bootstrap_batches(id) ON DELETE CASCADE;


--
-- Name: hz_fop_bootstrap_pages hz_fop_bootstrap_pages_company_id_dataset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_bootstrap_pages
    ADD CONSTRAINT hz_fop_bootstrap_pages_company_id_dataset_id_fkey FOREIGN KEY (company_id, dataset_id) REFERENCES public.hz_fop_datasets(company_id, id) ON DELETE RESTRICT;


--
-- Name: hz_fop_bootstrap_pages hz_fop_bootstrap_pages_connection_id_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_bootstrap_pages
    ADD CONSTRAINT hz_fop_bootstrap_pages_connection_id_company_id_fkey FOREIGN KEY (connection_id, company_id) REFERENCES public.hz_fop_companies(connection_id, id) ON DELETE RESTRICT;


--
-- Name: hz_fop_bootstrap_pages hz_fop_bootstrap_pages_stream_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_bootstrap_pages
    ADD CONSTRAINT hz_fop_bootstrap_pages_stream_id_fkey FOREIGN KEY (stream_id) REFERENCES public.hz_fop_sync_streams(id) ON DELETE CASCADE;


--
-- Name: hz_fop_collected_analytics_facts hz_fop_collected_analytics_facts_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_collected_analytics_facts
    ADD CONSTRAINT hz_fop_collected_analytics_facts_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.hz_fop_collected_batches(id) ON DELETE CASCADE;


--
-- Name: hz_fop_collected_chains hz_fop_collected_chains_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_collected_chains
    ADD CONSTRAINT hz_fop_collected_chains_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.hz_fop_collected_batches(id) ON DELETE RESTRICT;


--
-- Name: hz_fop_collected_chains hz_fop_collected_chains_dataset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_collected_chains
    ADD CONSTRAINT hz_fop_collected_chains_dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES public.hz_fop_datasets(id) ON DELETE RESTRICT;


--
-- Name: hz_fop_collected_customer_registrations hz_fop_collected_customer_registrations_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_collected_customer_registrations
    ADD CONSTRAINT hz_fop_collected_customer_registrations_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.hz_fop_collected_batches(id) ON DELETE CASCADE;


--
-- Name: hz_fop_collected_entities hz_fop_collected_entities_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_collected_entities
    ADD CONSTRAINT hz_fop_collected_entities_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.hz_fop_collected_batches(id) ON DELETE CASCADE;


--
-- Name: hz_fop_collected_orders hz_fop_collected_orders_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_collected_orders
    ADD CONSTRAINT hz_fop_collected_orders_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.hz_fop_collected_batches(id) ON DELETE CASCADE;


--
-- Name: hz_fop_collected_stock_consumptions hz_fop_collected_stock_consumptions_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_collected_stock_consumptions
    ADD CONSTRAINT hz_fop_collected_stock_consumptions_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.hz_fop_collected_batches(id) ON DELETE CASCADE;


--
-- Name: hz_fop_order_relation_paths hz_fop_order_relation_paths_company_id_dataset_id_order_do_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_relation_paths
    ADD CONSTRAINT hz_fop_order_relation_paths_company_id_dataset_id_order_do_fkey FOREIGN KEY (company_id, dataset_id, order_document_id) REFERENCES public.hz_fop_source_documents(company_id, dataset_id, id) ON DELETE RESTRICT;


--
-- Name: hz_fop_order_relation_paths hz_fop_order_relation_paths_relation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_order_relation_paths
    ADD CONSTRAINT hz_fop_order_relation_paths_relation_id_fkey FOREIGN KEY (relation_id) REFERENCES public.hz_fop_document_relations(id) ON DELETE RESTRICT;


--
-- Name: hz_fop_relation_dirty_sources hz_fop_relation_dirty_sources_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_relation_dirty_sources
    ADD CONSTRAINT hz_fop_relation_dirty_sources_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.hz_fop_collected_batches(id) ON DELETE CASCADE;


--
-- Name: hz_fop_relation_refresh hz_fop_relation_refresh_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_relation_refresh
    ADD CONSTRAINT hz_fop_relation_refresh_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.hz_fop_collected_batches(id) ON DELETE CASCADE;


--
-- Name: hz_fop_timestamp_documents hz_fop_timestamp_documents_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_timestamp_documents
    ADD CONSTRAINT hz_fop_timestamp_documents_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.hz_fop_collected_batches(id) ON DELETE CASCADE;


--
-- Name: hz_fop_timestamp_documents hz_fop_timestamp_documents_last_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_timestamp_documents
    ADD CONSTRAINT hz_fop_timestamp_documents_last_run_id_fkey FOREIGN KEY (last_run_id) REFERENCES public.hz_fop_timestamp_runs(id);


--
-- Name: hz_fop_timestamp_pages hz_fop_timestamp_pages_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_timestamp_pages
    ADD CONSTRAINT hz_fop_timestamp_pages_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.hz_fop_timestamp_runs(id) ON DELETE CASCADE;


--
-- Name: hz_fop_timestamp_projection_tasks hz_fop_timestamp_projection_tasks_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_timestamp_projection_tasks
    ADD CONSTRAINT hz_fop_timestamp_projection_tasks_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.hz_fop_collected_batches(id) ON DELETE CASCADE;


--
-- Name: hz_fop_timestamp_projection_tasks hz_fop_timestamp_projection_tasks_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_timestamp_projection_tasks
    ADD CONSTRAINT hz_fop_timestamp_projection_tasks_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.hz_fop_timestamp_runs(id);


--
-- Name: hz_fop_timestamp_runs hz_fop_timestamp_runs_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_timestamp_runs
    ADD CONSTRAINT hz_fop_timestamp_runs_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.hz_fop_collected_batches(id) ON DELETE CASCADE;


--
-- Name: hz_fop_timestamp_state hz_fop_timestamp_state_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_timestamp_state
    ADD CONSTRAINT hz_fop_timestamp_state_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.hz_fop_collected_batches(id) ON DELETE CASCADE;


--
-- Name: hz_fop_workbench_receipt_notices hz_fop_workbench_receipt_notices_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hz_fop_workbench_receipt_notices
    ADD CONSTRAINT hz_fop_workbench_receipt_notices_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.hz_fop_receipt_notices(document_id) ON DELETE CASCADE;


--
-- Name: leads leads_registrar_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_registrar_user_id_fkey FOREIGN KEY (registrar_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: local_opportunities local_opportunities_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_opportunities
    ADD CONSTRAINT local_opportunities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: local_opportunities local_opportunities_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_opportunities
    ADD CONSTRAINT local_opportunities_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: local_opportunities local_opportunities_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_opportunities
    ADD CONSTRAINT local_opportunities_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: local_opportunities local_opportunities_source_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_opportunities
    ADD CONSTRAINT local_opportunities_source_lead_id_fkey FOREIGN KEY (source_lead_id) REFERENCES public.leads(id) ON DELETE RESTRICT;


--
-- Name: local_opportunities local_opportunities_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_opportunities
    ADD CONSTRAINT local_opportunities_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: local_opportunity_follow_ups local_opportunity_follow_ups_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_opportunity_follow_ups
    ADD CONSTRAINT local_opportunity_follow_ups_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: local_opportunity_follow_ups local_opportunity_follow_ups_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_opportunity_follow_ups
    ADD CONSTRAINT local_opportunity_follow_ups_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.local_opportunities(id) ON DELETE RESTRICT;


--
-- Name: organization_employees organization_employees_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_employees
    ADD CONSTRAINT organization_employees_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: organization_employees organization_employees_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_employees
    ADD CONSTRAINT organization_employees_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: organization_nodes organization_nodes_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_nodes
    ADD CONSTRAINT organization_nodes_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--
