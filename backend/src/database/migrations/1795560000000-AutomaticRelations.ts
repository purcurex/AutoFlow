import { MigrationInterface, QueryRunner } from 'typeorm'
export class AutomaticRelations1795560000000 implements MigrationInterface {
 async up(q:QueryRunner){await q.query(`
 CREATE TABLE hz_fop_relation_refresh (
 batch_id uuid NOT NULL REFERENCES hz_fop_collected_batches(id) ON DELETE CASCADE,
 root_kind text NOT NULL CHECK(root_kind IN ('fulfillment','stock')), root_id text NOT NULL, root_number text NOT NULL,
 requested_version bigint NOT NULL DEFAULT 1, published_version bigint NOT NULL DEFAULT 0,
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz, last_error text, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(batch_id,root_kind,root_id));
 CREATE INDEX hz_fop_relation_refresh_due ON hz_fop_relation_refresh(batch_id,next_attempt_at,updated_at);
 CREATE TABLE hz_fop_relation_dirty_sources (
 batch_id uuid NOT NULL REFERENCES hz_fop_collected_batches(id) ON DELETE CASCADE,
 entity_code text NOT NULL, source_id text NOT NULL, PRIMARY KEY(batch_id,entity_code,source_id));
 CREATE INDEX hz_api_relation_nodes ON hz_fop_collected_entities USING gin ((raw->'bills')) WHERE entity_type='api_bill_relations';
 CREATE FUNCTION hz_enqueue_relation_root(b uuid,k text,i text,n text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF i IS NULL OR n IS NULL OR n='' THEN RETURN; END IF;
 INSERT INTO hz_fop_relation_refresh(batch_id,root_kind,root_id,root_number) VALUES(b,k,i,n)
 ON CONFLICT(batch_id,root_kind,root_id) DO UPDATE SET root_number=excluded.root_number,
 requested_version=hz_fop_relation_refresh.requested_version+1,next_attempt_at=now(),updated_at=now(); END $$;
 CREATE FUNCTION hz_mark_relation_source() RETURNS trigger LANGUAGE plpgsql AS $$
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
 CREATE TRIGGER hz_orders_relation_dirty AFTER INSERT OR UPDATE OR DELETE ON hz_fop_collected_orders FOR EACH ROW EXECUTE FUNCTION hz_mark_relation_source();
 CREATE TRIGGER hz_entities_relation_dirty AFTER INSERT OR UPDATE OR DELETE ON hz_fop_collected_entities FOR EACH ROW EXECUTE FUNCTION hz_mark_relation_source();
 `)}
 async down(q:QueryRunner){await q.query(`DROP TRIGGER IF EXISTS hz_orders_relation_dirty ON hz_fop_collected_orders; DROP TRIGGER IF EXISTS hz_entities_relation_dirty ON hz_fop_collected_entities; DROP FUNCTION hz_mark_relation_source(); DROP FUNCTION hz_enqueue_relation_root(uuid,text,text,text); DROP INDEX hz_api_relation_nodes; DROP TABLE hz_fop_relation_dirty_sources; DROP TABLE hz_fop_relation_refresh;`)}
}
