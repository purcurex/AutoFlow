/* Opt-in, local mock database only. Does not call FOP. */
require('reflect-metadata')
require('ts-node').register({ project: 'backend/tsconfig.json', transpileOnly: true })
const fs=require('node:fs'),assert=require('node:assert/strict'),{DataSource}=require('typeorm'),{ConfigService}=require('@nestjs/config')
const {seedWorkbenchMock}=require('../seed-workbench-mock')
const {LocalWorkbenchService}=require('../../modules/workbench-replica/local-workbench.service')
const {MockWorkbenchCapabilities}=require('../../modules/workbench-replica/mock-workbench-capabilities')
;(async()=>{
 const config=new ConfigService({NODE_ENV:'test',WORKBENCH_READ_MODE:'local',WORKBENCH_MOCK_ENABLED:'true',DB_HOST:'127.0.0.1',DB_DATABASE:'autoflow_workbench_mock',FOP_QUERIES_PAUSED:'true'})
 const db=await new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database:'autoflow_workbench_mock',password:fs.readFileSync('.runtime/local-demo/database-password','utf8').trim(),logging:false}).initialize()
 try{
  await seedWorkbenchMock(db)
  const users={findById:async id=>{const [u]=await db.query('SELECT * FROM users WHERE id=$1',[id]);if(!u)return null;return {...u,organizationWorkspaceOwnerId:u.organization_workspace_owner_id,accountDisabled:u.account_disabled,businessRole:u.business_role,businessDepartmentId:u.business_department_id,businessEmployeeId:u.business_employee_id,workbenchRoles:u.workbench_roles,dataDisplayScope:u.data_display_scope,sessionVersion:u.session_version}}}
  const local=new LocalWorkbenchService(db,users,config)
  const [admin]=await db.query("SELECT id,session_version FROM users WHERE email='admin@hzdrop.com'")
  for(const queue of ['unpaid','review','exceptions','dispatch','procurement','procurement_shipping','allocation','allocation_review','shipping']){
   const page=await local.getOrders(admin.id,{queue,page:1,pageSize:20});assert.equal(page.source,'mock');assert.ok(page.total>0,queue)
  }
  for(const queue of ['review','dispatch','procurement','allocation_review','shipping'])assert.ok((await local.getOrders(admin.id,{queue,completed:true,timeRange:'1w',page:1,pageSize:20})).total>0,'completed '+queue)
  const search=await local.getOrders(admin.id,{queue:'review',search:'HZ-BAG-001',page:1,pageSize:20});assert.ok(search.items.length>0);assert.equal(search.items[0].items.length,2)
  assert.ok(search.shippingCountries?.includes('GB'),'Review country options must come from authorized results')
  assert.ok((await local.getOrders(admin.id,{queue:'review',warehouseCode:'HZ',page:1,pageSize:20})).total>0)
  assert.ok((await local.getStockOrders(admin.id,{queue:'all',page:1,pageSize:20})).total>0)
  assert.ok((await local.getRmaOrders(admin.id,{flowStatus:'active',page:1,pageSize:20})).total>0)
  assert.ok((await local.getPurchaseReturns(admin.id,{workbenchRole:'procurement',page:1,pageSize:20})).total>0)
  for(const status of ['pending_outbound','in_transit','received','completed'])assert.ok((await local.getPurchaseReturns(admin.id,{workbenchRole:'procurement',status,page:1,pageSize:20})).total>0,status)
  assert.ok((await local.getPurchaseGroups(admin.id,{queue:'procurement',page:1,pageSize:20})).total>1)
  for(const purchaseStage of ['uncreated','placement_pending','payment_pending','refund_pending'])assert.ok((await local.getPurchaseGroups(admin.id,{queue:'procurement',purchaseStage,page:1,pageSize:20})).total>0,purchaseStage)
  const groups=await local.getPurchaseGroups(admin.id,{queue:'procurement_shipping',page:1,pageSize:20});assert.ok(groups.items.some(row=>row.purchase.payment==='paid'&&row.purchase.paidAt))
  for(const [method,query]of [['exportOrders',{queue:'review'}],['exportStockOrders',{}],['exportRmaOrders',{flowStatus:'active'}],['exportPurchaseGroups',{queue:'procurement'}],['exportPurchaseReturns',{workbenchRole:'procurement'}]]){
   const buffer=await local[method](admin.id,{...query,mode:'filtered'},admin.session_version);assert.equal(buffer.slice(0,2).toString(),'PK',method)
  }
  const [employee]=await db.query("SELECT id FROM users WHERE email='alex@hzdrop.com'")
  const personal=await local.getOrders(employee.id,{queue:'review',page:1,pageSize:100});assert.ok(personal.total>0);assert.ok(personal.total<search.total)
  assert.equal(new Set(personal.items.map(row=>row.owner.id)).size,1)
  const employeeSession=(await users.findById(employee.id)).sessionVersion
  await assert.rejects(()=>local.exportOrders(employee.id,{queue:'review',mode:'selected',orderIds:search.items.filter(row=>row.id!==personal.items[0].id).slice(0,1).map(row=>row.id)},employeeSession),/scope|Selected/)
  const instant=new MockWorkbenchCapabilities(db,local)
  const draft=personal.items[0]
  await db.query("UPDATE hz_fop_source_documents SET raw_bill_status='A' WHERE source_id=$1 AND entity_code='hzkj_orders'",[draft.id])
  assert.equal((await instant.preview(admin.id,{queue:'review',orderIds:[draft.id]},admin.session_version)).items[0].eligible,false,'Draft documents cannot be approved')
  await db.query("UPDATE hz_fop_source_documents SET raw_bill_status='B' WHERE source_id=$1 AND entity_code='hzkj_orders'",[draft.id])
  const employeeVersion=(await users.findById(employee.id)).sessionVersion
  const beforeRevoke=await instant.preview(employee.id,{queue:'review',orderIds:[draft.id]},employeeVersion)
  const raceDb={options:db.options,query:db.query.bind(db),transaction:async run=>{
   await db.query("UPDATE users SET workbench_roles='{}'::text[] WHERE id=$1",[employee.id])
   return db.transaction(run)
  }}
  const savedRoles=(await db.query('SELECT workbench_roles FROM users WHERE id=$1',[employee.id]))[0].workbench_roles
  try{await assert.rejects(()=>new MockWorkbenchCapabilities(raceDb,local).submit(employee.id,{queue:'review',requestId:require('node:crypto').randomUUID(),items:[{orderId:draft.id,version:beforeRevoke.items[0].version}]},employeeVersion),/权限|scope|authorization/i)}
  finally{await db.query('UPDATE users SET workbench_roles=$2 WHERE id=$1',[employee.id,savedRoles])}
  const inventory=await instant.stockInventory(admin.id,{orderIds:[(await local.getStockOrders(admin.id,{page:1,pageSize:20})).items[0].id],page:1,pageSize:50})
  assert.equal(inventory.source,'mock');assert.ok(inventory.items.length===2);assert.ok(inventory.asOf)
  await db.query("UPDATE hz_fop_resource_grants SET decision='deny' WHERE resource_type='stock_inventory'")
  await assert.rejects(()=>instant.stockInventory(admin.id,{page:1,pageSize:50}),/inventory.*authorization/i)
  await db.query("UPDATE hz_fop_resource_grants SET decision='allow' WHERE resource_type='stock_inventory'")
  const allocationSearch={mode:'search',queue:'allocation',search:'HZ-BAG',page:1,pageSize:50}
  assert.ok((await instant.allocationInventory(admin.id,allocationSearch)).total>0)
  await db.query("UPDATE hz_fop_resource_grants SET decision='deny' WHERE resource_type='allocation_inventory'")
  await assert.rejects(()=>instant.allocationInventory(admin.id,allocationSearch),/inventory.*authorization/i)
  await db.query("UPDATE hz_fop_resource_grants SET decision='allow' WHERE resource_type='allocation_inventory'")
  const preview=await instant.preview(admin.id,{queue:'review',orderIds:[search.items[0].id]},admin.session_version)
  assert.ok(preview.items[0].eligible)
  const request={queue:'review',requestId:require('node:crypto').randomUUID(),items:[{orderId:search.items[0].id,version:preview.items[0].version}]}
  const approved=await instant.submit(admin.id,request,admin.session_version);assert.equal(approved.items[0].status,'approved')
  assert.deepEqual(await instant.submit(admin.id,request,admin.session_version),approved)
  assert.equal((await local.getOrders(admin.id,{queue:'review',search:search.items[0].orderNumber,page:1,pageSize:20})).total,0)
  assert.ok((await local.getPurchaseGroups(admin.id,{queue:'procurement',page:1,pageSize:20})).total>0,'Procurement projections remain consistent after sales approval')
  const allocation=(await local.getOrders(admin.id,{queue:'allocation_review',page:1,pageSize:20})).items[0]
  const allocationPreview=await instant.preview(admin.id,{queue:'allocation_review',orderIds:[allocation.id]},admin.session_version);assert.ok(allocationPreview.items[0].eligible)
  const allocationResult=await instant.submit(admin.id,{queue:'allocation_review',requestId:require('node:crypto').randomUUID(),items:[{orderId:allocation.id,version:allocationPreview.items[0].version}]},admin.session_version)
  assert.equal(allocationResult.items[0].status,'approved')
  const remaining=(await local.getOrders(admin.id,{queue:'review',page:1,pageSize:20})).items.slice(0,3)
  const batchPreview=await instant.preview(admin.id,{queue:'review',orderIds:remaining.map(row=>row.id)},admin.session_version)
  const entries=batchPreview.items.map(row=>({orderId:row.orderId,version:row.version}))
  const batches=await Promise.all([instant.submit(admin.id,{queue:'review',requestId:require('node:crypto').randomUUID(),items:entries.slice(0,2)},admin.session_version),instant.submit(admin.id,{queue:'review',requestId:require('node:crypto').randomUUID(),items:entries.slice(1,3)},admin.session_version)])
  assert.ok(batches.every(batch=>batch.items.every(row=>['approved','already_approved'].includes(row.status))))
  const group=(await local.getPurchaseGroups(admin.id,{queue:'procurement',page:1,pageSize:20})).items[0]
  const getDetails=local.getPurchaseGroupDetails.bind(local);let detailReads=0
  local.getPurchaseGroupDetails=async(...args)=>{const result=await getDetails(...args);detailReads++;if(detailReads>1)result.items=result.items.map(row=>({...row,customerName:'Changed during export'}));return result}
  await assert.rejects(()=>local.exportPurchaseGroups(admin.id,{queue:'procurement',mode:'selected',groupIds:[group.id]},admin.session_version),/Data or permissions changed/)
  local.getPurchaseGroupDetails=getDetails
  assert.ok(detailReads>=2,'Purchase export rechecks detail rows')
  assert.equal((await db.query('SELECT count(*)::int n FROM hz_fop_inventory_balances'))[0].n,0)
  assert.equal((await db.query("SELECT count(*)::int n FROM users WHERE email='ruth@hzdrop.com'"))[0].n,0)
  console.log(JSON.stringify({status:'passed',source:'mock',queues:9,completed:5,skuWholeOrder:true,personalScope:true,excelTemplates:5,countryOptions:true,purchaseStages:4,returnStages:4,approval:['draftRejected','scopeRevocationRejected','idempotent','membershipRemoval','dependencyRevisions','concurrentBatches'],inventoryAuthorization:true,groupExportDetailsRechecked:true,inventoryLedgerRows:0}))
 }finally{await db.destroy()}
})().catch(e=>{console.error(e.message);process.exitCode=1})
