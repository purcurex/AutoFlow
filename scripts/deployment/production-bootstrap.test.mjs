import test from 'node:test'
import assert from 'node:assert/strict'
import {Client} from 'pg'
import {randomUUID} from 'node:crypto'
import bcrypt from 'bcrypt'
import {prepareProductionAdmin,prepareProductionBatch} from './initialize-production.mjs'
const enabled=/^hz_deploy_test_\d+$/.test(process.env.DB_DATABASE??'')
test('admin bootstrap uses the six-character policy and preserves the exact bcrypt input',async()=>{
 for(const password of ['abc123','ABC123','abc12!',' a123 ','a1'+'x'.repeat(70),'a1中'+'x'.repeat(67)]){
  let hash
  const client={async query(sql,params){if(sql.startsWith('INSERT INTO users'))hash=params[3];return {rows:sql.includes('pg_try_advisory_xact_lock')?[{locked:true}]:[]}}}
  const result=await prepareProductionAdmin(client,{email:'test@example.invalid',username:'test',password,organizationName:'Test'})
  assert.equal(result.created,true);assert.ok(await bcrypt.compare(password,hash))
 }
})
test('admin bootstrap rejects invalid passwords before writing anything',async()=>{
 const client={async query(){assert.fail('invalid password must not reach the database')}}
 for(const password of ['', 'ab123','abcdefghijk','123456789012','a1'+'x'.repeat(71),'a1中'+'x'.repeat(68),null,123456]){
  await assert.rejects(prepareProductionAdmin(client,{email:'test@example.invalid',username:'test',password,organizationName:'Test'}),/production_init_admin_input_invalid/)
 }
})
test('production bootstrap creates admin and empty batch idempotently without fake FOP bindings',{skip:!enabled},async()=>{
 const c=new Client({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USERNAME,password:process.env.DB_PASSWORD,database:process.env.DB_DATABASE});await c.connect()
 try{
  const email='deployment-'+randomUUID()+'@example.invalid',password=randomUUID()+'aA1!',username='bootstrap-'+randomUUID().slice(0,12)
  const admin=await prepareProductionAdmin(c,{email,username,password,organizationName:'生产组织'})
  assert.ok(admin.userId);assert.equal(admin.created,true)
  const row=(await c.query('SELECT * FROM users WHERE id=$1',[admin.userId])).rows[0]
  assert.equal(row.business_role,'admin');assert.equal(row.fop_binding_details,null);assert.equal(row.fop_user_id,null);assert.notEqual(row.password,password);assert.ok(await bcrypt.compare(password,row.password))
  assert.equal((await prepareProductionAdmin(c,{email,username,password:password+'changed',organizationName:'生产组织'})).created,false)
  const scope={tenantId:'deployment-isolated',companyId:'200001',orgNumber:'production-org',baseUrl:'https://fop.example.invalid'}
  const batch=await prepareProductionBatch(c,{...scope,adminEmail:email});assert.ok(batch.batchId);assert.equal(batch.created,true)
  const reused=await prepareProductionBatch(c,{...scope,adminEmail:email});assert.equal(reused.batchId,batch.batchId);assert.equal(reused.created,false)
  const data=(await c.query('SELECT * FROM hz_fop_collected_batches WHERE id=$1',[batch.batchId])).rows[0]
  assert.equal(data.row_count,0);assert.equal(data.metadata.productionPreparation.sourceCaptured,false);assert.equal(data.metadata.deploymentScope.environment,'production')
  assert.equal((await c.query('SELECT count(*)::int AS n FROM hz_fop_timestamp_state WHERE batch_id=$1',[batch.batchId])).rows[0].n,0)
  await assert.rejects(prepareProductionBatch(c,{...scope,companyId:'200002',adminEmail:email}),/scope_conflict/)
  await assert.rejects(prepareProductionAdmin(c,{email,username:username+'other',password,organizationName:'生产组织'}),/admin_conflict/)
 }finally{await c.end()}
})
