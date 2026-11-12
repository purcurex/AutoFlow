// Populate native status fixtures only in the dedicated synthetic database; no FOP access.
require('reflect-metadata')
require('ts-node').register({project:'backend/tsconfig.json',transpileOnly:true})
const fs=require('node:fs'),{parseEnv}=require('node:util'),{DataSource}=require('typeorm'),{ConfigService}=require('@nestjs/config')
const {workbenchMockEnabled,assertMockDatabase,MOCK_CREDENTIAL}=require('../backend/src/modules/workbench-replica/workbench-mock')
;(async()=>{
 const c={...parseEnv(fs.readFileSync('backend/.env.workbench.local','utf8')),NODE_ENV:'test'}
 if(!workbenchMockEnabled(new ConfigService(c)))throw new Error('Dedicated Mock environment required')
 const db=await new DataSource({type:'postgres',host:c.DB_HOST,port:Number(c.DB_PORT),username:c.DB_USERNAME,password:c.DB_PASSWORD,database:c.DB_DATABASE,logging:false}).initialize()
 try {assertMockDatabase(db);await db.transaction(async m=>{
 await m.query(`SELECT pg_advisory_xact_lock(hashtextextended('schema-mock-write',0))`)
 const rows=await m.query(`UPDATE hz_fop_fulfillment_orders f SET
 raw_purchase_status=CASE WHEN o.purchase_coverage_state='not_ordered' THEN '0' WHEN o.supplier_payment_state IN ('refunded','unpaid') THEN '2' WHEN o.supplier_shipment_state='partial' THEN '1' WHEN o.stock_readiness_state='ready' THEN '3' WHEN o.supplier_shipment_state='shipped' THEN '4' ELSE '2' END,
 raw_delivery_status=CASE o.outbound_state WHEN 'completed' THEN '2' WHEN 'partial' THEN '1' ELSE '0' END
 FROM hz_fop_workbench_orders o JOIN hz_fop_connections c ON c.id=o.connection_id
 WHERE f.document_id=o.document_id AND f.company_id=o.company_id AND f.dataset_id=o.dataset_id
 AND c.credential_ref=$1 AND c.tenant_id='local-mock' AND c.base_url='https://mock.invalid'
 AND (f.raw_purchase_status IS NULL OR f.raw_delivery_status IS NULL) RETURNING f.document_id`,[MOCK_CREDENTIAL]);console.log(JSON.stringify({source:'mock',updated:rows.length}))
 })}finally{await db.destroy()}
})().catch(e=>{console.error(e.message);process.exitCode=1})
