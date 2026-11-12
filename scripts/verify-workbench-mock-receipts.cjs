require('reflect-metadata')
require('ts-node').register({project:'backend/tsconfig.json',transpileOnly:true})
const assert=require('node:assert/strict'),fs=require('node:fs'),{DataSource}=require('typeorm'),{ConfigService}=require('@nestjs/config'),dotenv=require('dotenv')
const {LocalWorkbenchService}=require('../backend/src/modules/workbench-replica/local-workbench.service')
const {assertMockDatabase}=require('../backend/src/modules/workbench-replica/workbench-mock')
global.fetch=()=>{throw new Error('External access forbidden during local verification')}
;(async()=>{
 const values={...dotenv.parse(fs.readFileSync('backend/.env.workbench.local')),NODE_ENV:'test',FOP_QUERIES_PAUSED:'true'}
 const db=await new DataSource({type:'postgres',host:values.DB_HOST,port:Number(values.DB_PORT),username:values.DB_USERNAME,password:values.DB_PASSWORD,database:values.DB_DATABASE,logging:false}).initialize()
 try{
  assertMockDatabase(db)
  const users={findById:async id=>{const [u]=await db.query('SELECT * FROM users WHERE id=$1',[id]);if(!u)return null;return {...u,organizationWorkspaceOwnerId:u.organization_workspace_owner_id,accountDisabled:u.account_disabled,businessRole:u.business_role,businessDepartmentId:u.business_department_id,businessEmployeeId:u.business_employee_id,workbenchRoles:u.workbench_roles,dataDisplayScope:u.data_display_scope,sessionVersion:u.session_version}}}
  const local=new LocalWorkbenchService(db,users,new ConfigService(values))
  const [admin]=await db.query("SELECT id FROM users WHERE email='admin@hzdrop.com'")
  const page=await local.getReceiptNotices(admin.id,{page:1,pageSize:100})
  assert.equal(page.total,40);assert.equal(page.items.length,40)
  assert.equal(new Set(page.items.map(r=>r.id)).size,40)
  assert.equal(page.totals.quantity,160);assert.equal(page.totals.inboundQuantity,40);assert.equal(page.totals.pendingQuantity,120)
  for(const row of page.items){assert.ok(row.pendingQuantity>0);assert.equal(row.lines.length,2);assert.ok(row.shippedAt);assert.ok(row.trackingNumber)}
  const partial=await local.getReceiptNotices(admin.id,{page:1,pageSize:20,status:'partial'})
  assert.equal(partial.total,20);assert.ok(partial.items.every(r=>r.status==='partial'))
  const search=await local.getReceiptNotices(admin.id,{page:1,pageSize:20,search:page.items[0].lines[0].sku})
  assert.equal(search.total,40);assert.ok(search.items.every(r=>r.lines.length===2))
  const p1=await local.getReceiptNotices(admin.id,{page:1,pageSize:20}),p2=await local.getReceiptNotices(admin.id,{page:2,pageSize:20})
  assert.equal(new Set([...p1.items,...p2.items].map(r=>r.id)).size,40)
  const [employee]=await db.query("SELECT b.employee_master_id AS id FROM organization_employees e JOIN hz_fop_employee_bindings b ON b.local_account_id=e.account_id JOIN hz_fop_workbench_receipt_notices p ON b.employee_master_id=ANY(p.owner_employee_ids) WHERE e.archived_at IS NULL LIMIT 1")
  const scoped=await local.getReceiptNotices(admin.id,{page:1,pageSize:100,ownerId:employee.id})
  assert.equal(scoped.total,2)
  const warehouse=await local.getReceiptNotices(admin.id,{page:1,pageSize:100,warehouseCode:page.items[0].warehouseCode})
  assert.ok(warehouse.items.every(r=>r.warehouseCode===page.items[0].warehouseCode))
  const none=await local.getReceiptNotices(admin.id,{page:1,pageSize:20,search:"%' OR 1=1 --"});assert.equal(none.total,0)
  console.log(JSON.stringify({source:'mock',total:page.total,partial:partial.total,pendingQuantity:page.totals.pendingQuantity,personalScope:scoped.total,pagination:'passed',wholeNoticeSkuSearch:'passed'}))

 }finally{await db.destroy()}
})().catch(e=>{console.error(e.message);process.exitCode=1})
