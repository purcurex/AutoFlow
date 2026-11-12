/* Incremental, idempotent fixtures for the confirmed document mapping. Dedicated Mock DB only. */
require('reflect-metadata')
require('ts-node').register({project:'backend/tsconfig.json',transpileOnly:true})
const fs=require('node:fs'),{DataSource}=require('typeorm'),dotenv=require('dotenv'),{ConfigService}=require('@nestjs/config')
const {workbenchMockEnabled,assertMockDatabase}=require('../backend/src/modules/workbench-replica/workbench-mock')
const {WorkbenchConfirmedSources1794405000000}=require('../backend/src/database/migrations/1794405000000-WorkbenchConfirmedSources')
const {populateMockLogistics}=require('../backend/src/database/mock-logistics')
const {WorkbenchTrackingLifecycle1794407000000}=require('../backend/src/database/migrations/1794407000000-WorkbenchTrackingLifecycle')
const {WorkbenchPackageTracking1794406000000}=require('../backend/src/database/migrations/1794406000000-WorkbenchPackageTracking')
;(async()=>{
 const c={...dotenv.parse(fs.readFileSync('backend/.env.workbench.local')),NODE_ENV:'test'}
 if(!workbenchMockEnabled(new ConfigService(c)))throw new Error('Dedicated Mock environment required')
 const db=await new DataSource({type:'postgres',host:c.DB_HOST,port:Number(c.DB_PORT),username:c.DB_USERNAME,password:c.DB_PASSWORD,database:c.DB_DATABASE,migrationsTableName:'typeorm_migrations',migrations:[WorkbenchConfirmedSources1794405000000,WorkbenchPackageTracking1794406000000,WorkbenchTrackingLifecycle1794407000000],logging:false}).initialize()
 try{
 assertMockDatabase(db); await db.runMigrations()
 await db.transaction(async m=>{
  await m.query(`SELECT pg_advisory_xact_lock(hashtextextended('schema-mock-write',0))`)
  await m.query(`UPDATE hz_fop_fulfillment_orders f SET custom_channel_name='Standard Shipping',custom_channel_id='mock-custom-standard'`)
  await m.query(`UPDATE hz_fop_purchase_orders p SET paid_at=po.paid_at FROM hz_fop_platform_orders po WHERE po.purchase_document_id=p.document_id AND po.company_id=p.company_id AND po.dataset_id=p.dataset_id AND po.removed_at IS NULL`)
  await m.query(`UPDATE hz_fop_dispatches d SET raw_delivery_status=CASE WHEN o.shopify_sync_state='synced' THEN 'FULFILLED' WHEN sd.raw_bill_status='C' THEN 'TRACKING_OBTAINED' ELSE 'PENDING' END FROM hz_fop_document_relations r JOIN hz_fop_workbench_orders o ON o.document_id=r.from_document_id JOIN hz_fop_source_documents sd ON sd.id=r.to_document_id WHERE r.to_document_id=d.document_id AND r.relation_type='dispatch' AND r.removed_at IS NULL AND d.company_id=r.company_id AND d.dataset_id=r.dataset_id`)
  await m.query(`UPDATE hz_fop_workbench_purchase_allocations a SET supplier_shipped_quantity=a.allocated_requirement_quantity FROM hz_fop_workbench_orders o WHERE a.order_document_id=o.document_id AND o.supplier_shipment_state='shipped' AND a.company_id=o.company_id AND a.dataset_id=o.dataset_id`)
  await m.query(`UPDATE hz_fop_workbench_memberships m SET classification_state=CASE WHEN o.purchase_coverage_state='ordered' AND o.supplier_shipment_state='shipped' AND o.customer_payment_state='paid' AND o.cancelled IS NOT TRUE THEN 'member' ELSE 'non_member' END FROM hz_fop_workbench_orders o WHERE m.order_document_id=o.document_id AND m.company_id=o.company_id AND m.dataset_id=o.dataset_id AND m.queue_code='procurement_completed'`)
  await m.query(`INSERT INTO hz_fop_tracking_numbers(id,connection_id,company_id,dataset_id,dispatch_document_id,package_id,tracking_type,number,provider_id,shopify_selected,source_version) SELECT md5(t.id::text||':last-mile')::uuid,t.connection_id,t.company_id,t.dataset_id,t.dispatch_document_id,t.package_id,'last_mile','MOCK-LAST-'||t.number,t.provider_id,false,t.source_version FROM hz_fop_tracking_numbers t WHERE t.tracking_type='full' AND t.removed_at IS NULL ON CONFLICT(id) DO NOTHING`)
  await m.query(`INSERT INTO hz_fop_source_documents(id,connection_id,company_id,dataset_id,entity_code,source_id,document_number,source_version,validation_state,raw_bill_status,source_created_at,source_modified_at)
   SELECT md5(sd.id::text||':second-case')::uuid,sd.connection_id,sd.company_id,sd.dataset_id,sd.entity_code,sd.source_id||'-02',sd.document_number||'-02',1,'verified',sd.raw_bill_status,sd.source_created_at,sd.source_modified_at FROM hz_fop_source_documents sd WHERE sd.entity_code='hzkj_after_sale_orders' AND sd.source_id NOT LIKE '%-02' ON CONFLICT(id) DO NOTHING`)
  await m.query(`INSERT INTO hz_fop_rma_orders(document_id,company_id,dataset_id,after_sale_type,raw_flow_status,is_open,reason,refund_amount,refund_currency) SELECT md5(r.document_id::text||':second-case')::uuid,r.company_id,r.dataset_id,r.after_sale_type,r.raw_flow_status,true,'第二张独立售后单',CASE WHEN r.after_sale_type='reshipment' THEN NULL ELSE 5 END,r.refund_currency FROM hz_fop_rma_orders r JOIN hz_fop_source_documents sd ON sd.id=r.document_id WHERE sd.source_id NOT LIKE '%-02' ON CONFLICT(document_id) DO NOTHING`)
  await m.query(`INSERT INTO hz_fop_document_relations(id,connection_id,company_id,dataset_id,from_document_id,to_document_id,relation_type,holder_document_id,relation_grain,resolution_state) SELECT md5(r.id::text||':second-case')::uuid,r.connection_id,r.company_id,r.dataset_id,r.from_document_id,md5(r.to_document_id::text||':second-case')::uuid,'rma',md5(r.to_document_id::text||':second-case')::uuid,'document','resolved' FROM hz_fop_document_relations r JOIN hz_fop_source_documents sd ON sd.id=r.to_document_id WHERE r.relation_type='rma' AND sd.source_id NOT LIKE '%-02' ON CONFLICT(id) DO NOTHING`)
  await populateMockLogistics(m)
 }); console.log('Mock migration and confirmed-source fixtures updated; no FOP requests.')
 }finally{await db.destroy()}
})().catch(e=>{console.error(e.message);process.exitCode=1})
