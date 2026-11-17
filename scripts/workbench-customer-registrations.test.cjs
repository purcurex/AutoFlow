const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {loadCustomerRegistrationCapture,importCustomerRegistrations}=require('./workbench-customer-registrations-import.cjs')
require('ts-node').register({project:path.resolve('backend/tsconfig.json'),transpileOnly:true})
const {normalizeCustomerRegistration}=require('../backend/src/modules/fop-data/collected-customer-registration')
const {dashboardAnalyticsQuery}=require('../backend/src/modules/workbench-replica/dashboard-analytics-query')
const expected={tenantId:'fixture-tenant',companyId:'100000',userId:'800'}
const connection={subject:{tenantId:expected.tenantId,userId:expected.userId},currentOrganization:{id:expected.companyId}}
const row=(id,owner='700',time='2026-11-01 00:00:00',company='100000')=>({id,createorg_id:company,hzkj_biz_user_id:owner,hzkj_biz_user_name:'Same Name',createtime:time})
test('confirmed Huazhi catalogue imports time-only source filters, including an empty window, without widening tenant or row scope',async()=>{
 const {captureRegistrations}=await import('./workbench-customer-registrations-capture.mjs')
 for(const [tenant,rows,complete] of [['hyperzone.test',[row('1')],true],['hyperzone.test',[],true],['other',[row('1')],false],['hyperzone.test',[row('1','700',undefined,'200000')],false],['hyperzone.test',[{...row('1'),createorg_id:null}],false]]){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'registration-confirmed-company-'))
  const context={...expected,tenantId:tenant}, connection={subject:{tenantId:tenant,userId:expected.userId},currentOrganization:{id:'100000'}}
  try{
   const m=await captureRegistrations({directory,connection,context,from:'2026-11-01 00:00:00',toExclusive:'2026-12-01 00:00:00',query:async()=>({report:{success:true},raw:JSON.stringify({status:true,errorCode:'0',data:{filter:"[createtime >= '2026-11-01 00:00:00' AND createtime < '2026-12-01 00:00:00']",pageNo:1,pageSize:100,totalCount:rows.length,lastPage:true,rows}})})})
   assert.equal(m.complete,complete,`${tenant}: ${m.error}`)
   if(complete){
    assert.equal(m.scopeProof.basis,'user_confirmed_company_catalogue')
    assert.equal((await loadCustomerRegistrationCapture(directory,context)).rows.length,rows.length)
    const saved=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));saved.scopeProof.tenantId='other';fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(saved))
    await assert.rejects(()=>loadCustomerRegistrationCapture(directory,context),/source_scope_unverified/)
   }
  }finally{fs.rmSync(directory,{recursive:true,force:true})}
 }
})
async function fixture(rows){
 const {captureRegistrations}=await import('./workbench-customer-registrations-capture.mjs')
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'customer-registration-fixture-'))
 const manifest=await captureRegistrations({directory,connection,context:{tenantId:expected.tenantId,userId:expected.userId},from:'2026-11-01 00:00:00',toExclusive:'2026-12-01 00:00:00',pageSize:2,query:async args=>({report:{success:true},raw:JSON.stringify({status:true,errorCode:'0',data:{filter:"(createtime >= '2026-11-01 00:00:00' and createtime < '2026-12-01 00:00:00') and createorg in (100000)",pageNo:args.pageNo,pageSize:2,totalCount:rows.length,lastPage:args.pageNo*2>=rows.length,rows:rows.slice((args.pageNo-1)*2,args.pageNo*2)}})})})
 return {directory,manifest}
}
test('offline capture/import proves pagination and hashes, retains unknown owners, scopes explicit source company',async()=>{
 const f=await fixture([row('1'),row('2',null),row('3','701')])
 try{
  assert.equal(f.manifest.complete,true);assert.equal(f.manifest.sourceRowCount,3);assert.equal(f.manifest.rowCount,3)
  const c=await loadCustomerRegistrationCapture(f.directory,expected)
  assert.equal(c.rows.length,3);assert.equal(c.rows[1].hzkj_biz_user_id,null)
  await assert.rejects(()=>loadCustomerRegistrationCapture(f.directory,{...expected,tenantId:'other'}),/invalid_manifest/)
  fs.appendFileSync(path.join(f.directory,'page-0001.json'),' ')
  await assert.rejects(()=>loadCustomerRegistrationCapture(f.directory,expected),/capture_hash_mismatch/)
 }finally{fs.rmSync(f.directory,{recursive:true,force:true})}
})
test('capture rejects duplicate/out-of-order IDs and changing totals; date windows reject invalid calendars',async()=>{
 const {validateRegistrationPage,registrationWindow}=await import('./workbench-customer-registrations-capture.mjs')
 const p=rows=>({status:true,errorCode:'0',data:{pageNo:1,pageSize:2,totalCount:2,lastPage:true,rows}})
 assert.throws(()=>validateRegistrationPage(p([row('2'),row('1')]),1,2,undefined,new Set()),/invalid_id_order/)
 assert.throws(()=>validateRegistrationPage(p([row('1'),row('1')]),1,2,undefined,new Set()),/invalid_id_order/)
 assert.throws(()=>validateRegistrationPage(p([row('1'),row('2')]),1,2,3,new Set()),/unstable_total/)
 assert.throws(()=>registrationWindow('2026-02-30 00:00:00','2026-03-01 00:00:00'),/invalid_creation_window/)
 assert.deepEqual(registrationWindow('2026-11-01 00:00:00','2026-12-01 00:00:00'),{start:'2026-10-31T16:00:00.000Z',end:'2026-11-30T16:00:00.000Z'})
})
test('failed one-shot capture records HTTP diagnostics without becoming an importable dataset',async()=>{
 const {captureRegistrations}=await import('./workbench-customer-registrations-capture.mjs')
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'customer-registration-failure-'))
 try{
  const m=await captureRegistrations({directory,connection,context:{tenantId:expected.tenantId,userId:expected.userId},from:'2026-11-01 00:00:00',toExclusive:'2026-12-01 00:00:00',query:async()=>({report:{success:false,httpStatus:519,errorCategory:'upstream-rejected'}})})
  assert.equal(m.complete,false);assert.deepEqual(m.sourceFailure,{httpStatus:519,category:'upstream-rejected',pageNo:1})
  await assert.rejects(()=>loadCustomerRegistrationCapture(directory,expected),/invalid_manifest/)
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
})
test('company completeness requires authenticated connection and an explicit conjunctive source company filter on every page',async()=>{
 const {registrationScopeProof,registrationConnectionProof,captureRegistrations,sha}=await import('./workbench-customer-registrations-capture.mjs')
 assert.deepEqual(registrationScopeProof("((createorg in (100000)) and createtime >= '2026-11-01 00:00:00')"),{companyId:'100000',basis:'native_response_createorg_conjunction'})
 assert.equal(registrationScopeProof("createorg = '100000'").companyId,'100000')
 for(const filter of [undefined,'', 'createorg in (200000)', 'createorg in (100000,200000)', "createorg in (100000) or name = 'any'", 'not (createorg in (100000))', "name = 'createorg in (100000)'", 'createorg in (100000) and createorg = 200000', 'createorg in (100000) and hzkj_biz_user = 700'])assert.throws(()=>registrationScopeProof(filter),/source_scope_unverified/)
 assert.throws(()=>registrationConnectionProof({...connection,currentOrganization:{id:'200000'}},expected),/connection_mismatch/)
 const f=await fixture([])
 try{
  const m=JSON.parse(fs.readFileSync(path.join(f.directory,'manifest.json'),'utf8'))
  const filename=path.join(f.directory,'page-0001.json'),envelope=JSON.parse(fs.readFileSync(filename,'utf8'))
  envelope.data.filter='createorg in (200000)';const raw=JSON.stringify(envelope);fs.writeFileSync(filename,raw);m.pages[0].sha256=sha(raw);fs.writeFileSync(path.join(f.directory,'manifest.json'),JSON.stringify(m))
  await assert.rejects(()=>loadCustomerRegistrationCapture(f.directory,expected),/source_scope_unverified/)
 }finally{fs.rmSync(f.directory,{recursive:true,force:true})}
 const wrong=await fixture([row('1','700',undefined,'200000')])
 try{assert.equal(wrong.manifest.complete,false);assert.equal(wrong.manifest.error,'source_scope_mismatch')}finally{fs.rmSync(wrong.directory,{recursive:true,force:true})}
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'customer-registration-no-scope-'))
 try{
  const m=await captureRegistrations({directory,connection,context:expected,from:'2026-11-01 00:00:00',toExclusive:'2026-12-01 00:00:00',query:async()=>({report:{success:true},raw:JSON.stringify({status:true,errorCode:'0',data:{pageNo:1,pageSize:100,totalCount:0,lastPage:true,rows:[]}})})})
  assert.equal(m.complete,false);assert.equal(m.error,'source_scope_unverified')
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
})
test('import rejects out-of-window rows before connecting or mutating a database',async()=>{
 const f=await fixture([row('1','700','2026-12-01 00:00:00')])
 try{
  const c=await loadCustomerRegistrationCapture(f.directory,expected)
  await assert.rejects(()=>importCustomerRegistrations({transaction:()=>assert.fail('must not begin transaction')},'batch',c,normalizeCustomerRegistration),/row_outside_creation_window/)
 }finally{fs.rmSync(f.directory,{recursive:true,force:true})}
})
test('isolated PostgreSQL import and permissions: current ID binding, department, unknown owner, boundaries, zero window and rollback',{skip:process.env.CUSTOMER_REGISTRATION_PG_TEST!=='true'},async()=>{
 const {execFileSync}=require('node:child_process'),{DataSource}=require('typeorm')
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'customer-registration-pg-')),data=path.join(root,'data')
 const run=(file,args)=>execFileSync(file,args,{stdio:'pipe'})
 let db,started=false
 try{
  run('initdb',['-D',data,'-A','trust','--no-locale','-U','registration_test'])
  run('pg_ctl',['-D',data,'-l',path.join(root,'server.log'),'-o',`-F -p 55489 -k ${root} -c listen_addresses=''`,'-w','start']);started=true
  db=new DataSource({type:'postgres',host:root,port:55489,username:'registration_test',database:'postgres',logging:false});await db.initialize()
  await db.query('CREATE TABLE hz_fop_collected_batches (id uuid PRIMARY KEY,state text,company_id text,tenant_id text,metadata jsonb NOT NULL)')
  const {CollectedCustomerRegistrations1794830000000}=require('../backend/src/database/migrations/1794830000000-CollectedCustomerRegistrations')
  await new CollectedCustomerRegistrations1794830000000().up({query:(...args)=>db.query(...args)})
  const batch='00000000-0000-0000-0000-000000000001'
  await db.query("INSERT INTO hz_fop_collected_batches VALUES($1,'active','100000',$2,'{}')",[batch,expected.tenantId])
  const f=await fixture([row('1'),row('2','701','2026-11-30 23:59:59'),row('3',null),row('4','999'),row('5','700',null)])
  try{
   const c=await loadCustomerRegistrationCapture(f.directory,expected)
   assert.equal((await importCustomerRegistrations(db,batch,c,normalizeCustomerRegistration)).rowCount,5)
   const opts={batchId:batch,companyId:'100000',employeeIds:null,members:[{employeeId:'70',fopUserId:'700',departmentId:'d1',departmentName:'Dept 1',name:'Same Name'},{employeeId:'71',fopUserId:'701',departmentId:'d2',departmentName:'Dept 2',name:'Same Name'}],start:c.window.start,end:c.window.end,chartId:'registrations',summaryOnly:false}
   const query=async overrides=>{const q=dashboardAnalyticsQuery({...opts,...overrides});return (await db.query(q.sql,q.params))[0].analytics}
   const admin=await query({});assert.deepEqual(admin.rows.filter(r=>r.dimension==='day').map(r=>[r.id,r.registrationCount]),[['2026-11-01',3],['2026-11-30',1]]);assert.equal(admin.registrationCount,4);assert.equal(admin.unmatchedOwnerCount,2);assert.equal(admin.missingCreatedAtCount,1)
   const own=await query({employeeIds:['70']});assert.equal(own.registrationCount,1);assert.equal(own.unmatchedOwnerCount,0);assert.equal(own.missingCreatedAtCount,1)
   assert.equal((await query({employeeIds:[]})).registrationCount,0)
   const department=await query({employeeIds:['71'],summaryOnly:true});assert.equal(department.registrationCount,1);assert.deepEqual(department.rows.map(r=>r.dimension),['department'])
   assert.equal((await query({end:'2026-11-30T15:59:59.000Z'})).registrationCount,3)
   assert.equal((await query({start:'2026-10-31T16:00:00.001Z'})).registrationCount,1)
   assert.equal((await query({employeeIds:['70'],members:[...opts.members,{...opts.members[0],employeeId:'72'}]})).registrationCount,0)
   await db.query("CREATE FUNCTION fixture_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$")
   await db.query('CREATE TRIGGER fixture_failure BEFORE INSERT ON hz_fop_collected_customer_registrations FOR EACH ROW EXECUTE FUNCTION fixture_fail_insert()')
   await assert.rejects(()=>importCustomerRegistrations(db,batch,c,normalizeCustomerRegistration),/fixture failure/)
   assert.equal((await query({})).registrationCount,4)
   await db.query('DROP TRIGGER fixture_failure ON hz_fop_collected_customer_registrations')
   assert.equal((await importCustomerRegistrations(db,batch,c,normalizeCustomerRegistration)).rowCount,5)
  }finally{fs.rmSync(f.directory,{recursive:true,force:true})}
  const empty=await fixture([])
  try{await importCustomerRegistrations(db,batch,await loadCustomerRegistrationCapture(empty.directory,expected),normalizeCustomerRegistration);assert.equal((await db.query('SELECT count(*)::int n FROM hz_fop_collected_customer_registrations'))[0].n,0)}finally{fs.rmSync(empty.directory,{recursive:true,force:true})}
 }finally{if(db?.isInitialized)await db.destroy();if(started)run('pg_ctl',['-D',data,'-m','fast','-w','stop']);fs.rmSync(root,{recursive:true,force:true})}
})
