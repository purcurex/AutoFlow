-- Reference only. Initialize using migrate-compiled.mjs run; not this SQL.
--
-- PostgreSQL database dump
--

\restrict 7qZD9z6x6oCEEAVKdlEOgVzyVCclp8CEzxwJir7UeGrjd1ckvEysnK7pHfSWo69

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
-- Name: hz_collected_allocation_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hz_collected_allocation_parent_idx ON public.hz_fop_collected_entities USING btree (batch_id, ((display ->> 'sourceOrderId'::text))) WHERE (entity_type = 'allocation'::text);


--
-- Name: hz_fop_collected_entities_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hz_fop_collected_entities_owner ON public.hz_fop_collected_entities USING btree (batch_id, entity_type, owner_employee_id);


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

\unrestrict 7qZD9z6x6oCEEAVKdlEOgVzyVCclp8CEzxwJir7UeGrjd1ckvEysnK7pHfSWo69
