import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ConfigService } from '@nestjs/config'
import { DataSource, QueryRunner } from 'typeorm'
import { LocalWorkbenchService } from './local-workbench.service'
import { localLogisticsSql } from './local-workbench-logistics'
import { collectReplicaPages } from './collect-replica-pages'
import { buildFulfillmentWorkbook } from '../fop-data/fop-order-export'
import { Workbook } from 'exceljs'
import { UsersService } from '../users/users.service'

// Explicit opt-in, loopback-only and restricted database name; never uses the application database or FOP.
const database = process.env.LOCAL_WORKBENCH_TEST_DB
const integration = database?.startsWith('hz_ddl_validation_') ? describe : describe.skip
integration('local workbench PostgreSQL query integration', () => {
  let db: DataSource, runner: QueryRunner, service: LocalWorkbenchService
  let owner: string, connection: string, company: string, dataset: string
  let employeeIds: string[] | null = null
  beforeAll(async () => {
    db = await new DataSource({ type: 'postgres', host: '127.0.0.1', port: 55432, username: 'autoflow_demo', database,
      password: readFileSync(resolve(__dirname, '../../../../.runtime/local-demo/database-password'), 'utf8').trim(), entities: [], synchronize: false }).initialize()
    owner = (await db.query('SELECT id FROM users ORDER BY id LIMIT 1'))[0].id
  })
  afterAll(async () => { await db?.destroy() })
  beforeEach(async () => {
    runner = db.createQueryRunner(); await runner.connect(); await runner.startTransaction()
    await runner.query('SET CONSTRAINTS ALL DEFERRED')
    await runner.query('ALTER TABLE hz_fop_procurement_line_details ADD COLUMN IF NOT EXISTS sales_order_number varchar(200)')
    connection = randomUUID(); company = randomUUID(); dataset = randomUUID(); employeeIds = null
    await runner.query(`INSERT INTO hz_fop_connections (id,workspace_owner_id,name,environment,tenant_id,base_url,credential_ref,status) VALUES ($1,$2,'local-query-fixture','test','fixture','https://invalid.example','fixture-only','active')`, [connection, owner])
    await runner.query(`INSERT INTO hz_fop_companies (id,connection_id,source_company_id,company_number,enabled,verified_at,expires_at,active_dataset_id) VALUES ($1,$2,'100000','fixture',true,now(),now()+interval '60 seconds',$3)`, [company, connection, dataset])
    await runner.query(`INSERT INTO hz_fop_datasets (id,connection_id,company_id,state,validated_at,activated_at) VALUES ($1,$2,$3,'active',now(),now())`, [dataset, connection, company])
    for (const resource of ['orders','stock_orders','rma']) await runner.query(`INSERT INTO hz_fop_resource_grants (id,connection_id,company_id,resource_type,target_key,decision,verified_at,source_as_of,expires_at) VALUES ($1,$2,$3,$4,'*','allow',now(),now(),now()+interval '60 seconds')`, [randomUUID(),connection,company,resource])
    const account = { id: randomUUID(), role: 'admin', businessRole: 'none', organizationWorkspaceOwnerId: owner, workbenchRoles: [], accountDisabled: false }
    const users = { findById: async () => account, localWorkbenchOrganization: async () => ({ version: 'current-org', departments: [], members: [], employeeIds, employeeId: null, departmentId: null }) }
    const manager = { query: (sql: string, values?: unknown[]) => sql === 'SET TRANSACTION READ ONLY' ? Promise.resolve([]) : runner.query(sql.includes('FROM hz_fop_connections') ? sql.replace('WHERE c.workspace_owner_id = $1', `WHERE c.workspace_owner_id = $1 AND co.id = '${company}'`) : sql, values) }
    const transactionDb = { transaction: async (_isolation: string, run: (manager: any) => Promise<any>) => run(manager), query: manager.query }
    service = new LocalWorkbenchService(transactionDb as unknown as DataSource, users as unknown as UsersService, new ConfigService({WORKBENCH_READ_MODE:'local'}))
    jest.spyOn(service as any,'organization').mockImplementation(users.localWorkbenchOrganization)
  })
  afterEach(async () => { await runner.rollbackTransaction(); await runner.release() })
  async function order(source: string, employee: string, amount: string, quantity: number, classification = 'member', paid = '2026-11-10T00:00:00Z') {
    const id = randomUUID()
    await runner.query(`INSERT INTO hz_fop_source_documents (id,connection_id,company_id,dataset_id,entity_code,source_id,validation_state) VALUES ($1,$2,$3,$4,'hzkj_orders',$5,'verified')`, [id,connection,company,dataset,source])
    await runner.query(`INSERT INTO hz_fop_workbench_orders (document_id,connection_id,company_id,dataset_id,order_kind,order_number,owner_employee_id,total_amount,total_quantity,currency_code,customer_paid_at,projection_revision,readiness,published_at,ownership_verified_at,ownership_version,customer_payment_state,order_review_state) VALUES ($1,$2,$3,$4,'fulfillment',$5,$6,$7,$8,'USD',$9,1,'ready',now(),now(),'ownership-v1','paid','pending')`, [id,connection,company,dataset,'TO'+source,employee,amount,quantity,paid])
    await runner.query(`INSERT INTO hz_fop_fulfillment_orders(document_id,company_id,dataset_id,entity_code,raw_purchase_status,raw_delivery_status) VALUES($1,$2,$3,'hzkj_orders','2','0')`,[id,company,dataset])
    for(const queue of ['review','rma']) await runner.query(`INSERT INTO hz_fop_workbench_memberships (id,connection_id,company_id,dataset_id,order_document_id,queue_code,classification_state,projection_revision,rule_version,published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,1,1,now())`, [randomUUID(),connection,company,dataset,id,queue,classification])
    for(let i=0;i<2;i++) {
      const line=randomUUID()
      await runner.query(`INSERT INTO hz_fop_source_lines (id,connection_id,company_id,dataset_id,document_id,entry_entity,source_entry_id) VALUES ($1,$2,$3,$4,$5,'entry',$6)`,[line,connection,company,dataset,id,String(i)])
      await runner.query(`INSERT INTO hz_fop_workbench_order_lines (id,connection_id,company_id,dataset_id,order_document_id,source_line_id,sku_code,product_name,quantity,sequence,projection_revision) VALUES ($1,$2,$3,$4,$5,$6,$7,'Product',1,$8,1)`,[randomUUID(),connection,company,dataset,id,line,i===0?'MATCH':'OTHER',i])
    }
    return id
  }
  async function filterOrder(source: string, employee = '10') {
    const id = await order(source, employee, '12.30', 2)
    await runner.query(`UPDATE hz_fop_workbench_orders SET procurement_stage='alibaba_pending',purchase_coverage_state='ordered',platform_order_state='not_pushed',supplier_payment_state='unpaid' WHERE document_id=$1`, [id])
    for (const queue of ['allocation', 'allocation_review', 'procurement']) await runner.query(`INSERT INTO hz_fop_workbench_memberships(id,connection_id,company_id,dataset_id,order_document_id,queue_code,classification_state,projection_revision,rule_version,published_at) VALUES($1,$2,$3,$4,$5,$6,'member',1,1,now())`, [randomUUID(),connection,company,dataset,id,queue])
    return id
  }
  async function dispatchFor(id: string, status: string | null, trackingType?: string) {
    const dispatch = randomUUID()
    await runner.query(`INSERT INTO hz_fop_source_documents(id,connection_id,company_id,dataset_id,entity_code,source_id,validation_state,raw_bill_status) VALUES($1,$2,$3,$4,'hzkj_deliver_bill',$6,'verified',$5)`, [dispatch,connection,company,dataset,status,dispatch])
    await runner.query(`INSERT INTO hz_fop_dispatches(document_id,company_id,dataset_id,raw_delivery_status) VALUES($1,$2,$3,'FULFILLED')`, [dispatch,company,dataset])
    await runner.query(`INSERT INTO hz_fop_document_relations(id,connection_id,company_id,dataset_id,from_document_id,to_document_id,relation_type,holder_document_id,relation_grain,resolution_state) VALUES($1,$2,$3,$4,$5,$6,'dispatch',$6,'document','resolved')`, [randomUUID(),connection,company,dataset,id,dispatch])
    if (trackingType) await runner.query(`INSERT INTO hz_fop_tracking_numbers(id,connection_id,company_id,dataset_id,dispatch_document_id,tracking_type,number,source_version) VALUES($1,$2,$3,$4,$5,$6,'CURRENT-NUMBER',1)`, [randomUUID(),connection,company,dataset,dispatch,trackingType])
    return dispatch
  }
  it.each(['allocation','allocation_review'] as const)('filters %s by all current dispatch approvals, including valid unknown states', async queue => {
    for (const [source, statuses] of [['empty',[]],['draft',['A']],['submitted',['B']],['unknown',[null]],['mixed',['C','B']],['all-approved',['C','C']]] as [string,(string|null)[]][]) {
      const id = await filterOrder(source)
      for (const status of statuses) await dispatchFor(id,status)
    }
    const query = {queue,timeRange:'all' as const,page:1,pageSize:2}
    const complete = await service.getOrders(owner,{...query,taskStatus:'dispatch_complete'})
    expect(complete.total).toBe(1)
    expect(complete.items.map(item=>item.id)).toEqual(['all-approved'])
    const incomplete = await service.getOrders(owner,{...query,taskStatus:'dispatch_incomplete'})
    expect(incomplete.total).toBe(5)
    const ids:string[]=[]
    for (let page=1;page<=3;page++) ids.push(...(await service.getOrders(owner,{...query,taskStatus:'dispatch_incomplete',page})).items.map(item=>item.id))
    expect(ids.sort()).toEqual(['draft','empty','mixed','submitted','unknown'])
    expect((await service.getOrders(owner,{...query,taskStatus:'dispatch_incomplete',projection:'count'})).total).toBe(5)
    const exported=await collectReplicaPages<any>(page=>service.getOrders(owner,{...query,taskStatus:'dispatch_incomplete',page}) as any)
    const workbook=new Workbook()
    await workbook.xlsx.load(await buildFulfillmentWorkbook(exported.items,{...query,taskStatus:'dispatch_incomplete'} as any,'fop') as any)
    const values=JSON.stringify(workbook.getWorksheet('订单清单')!.getSheetValues())
    for(const source of ['draft','empty','mixed','submitted','unknown']) expect(values).toContain('TO'+source)
    expect(values).not.toContain('TOall-approved')
  })
  it('prepares only unpushed procurement needing a dispatch or a full logistics order number', async () => {
    await filterOrder('empty')
    await dispatchFor(await filterOrder('tail-only'),'C','last_mile')
    await dispatchFor(await filterOrder('first-only'),'B','first_mile')
    const ready=await filterOrder('ready')
    await dispatchFor(ready,'A','full'); await dispatchFor(ready,'B')
    const removed=await dispatchFor(await filterOrder('removed-number'),'C','full')
    await runner.query(`UPDATE hz_fop_tracking_numbers SET removed_at=now() WHERE dispatch_document_id=$1`,[removed])
    const notReady=await filterOrder('not-created')
    await runner.query(`UPDATE hz_fop_workbench_orders SET procurement_stage='purchase_order_pending',purchase_coverage_state='not_ordered' WHERE document_id=$1`,[notReady])
    const query={queue:'procurement' as const,timeRange:'all' as const,page:1,pageSize:20}
    const result=await service.getOrders(owner,{...query,taskStatus:'dispatch_preparation'})
    expect(result.total).toBe(4)
    expect(result.items.map(item=>item.id).sort()).toEqual(['empty','first-only','removed-number','tail-only'])
    expect((result.items.find(item=>item.id==='empty') as any)?.procurementProgress?.logisticsGate).toBe('pending_dispatch')
    expect((result.items.find(item=>item.id==='tail-only') as any)?.procurementProgress?.logisticsGate).toBe('pending_logistics')
    const alibaba=await service.getOrders(owner,{...query,taskStatus:'alibaba_pending'})
    expect(alibaba.items.map(item=>item.id)).toEqual(['ready'])
    expect((alibaba.items[0] as any).procurementProgress?.logisticsGate).toBe('satisfied')
    expect((await service.getOrders(owner,{...query,taskStatus:'dispatch_preparation',projection:'count'})).total).toBe(4)
  })
  it('ignores deleted and removed dispatches and keeps filters within order authorization and members', async () => {
    const visible=await filterOrder('visible'),hidden=await filterOrder('hidden','20'),denied=await filterOrder('denied')
    await dispatchFor(visible,'C')
    const deleted=await dispatchFor(visible,'B'),removed=await dispatchFor(visible,'B')
    await runner.query(`UPDATE hz_fop_source_documents SET deleted_at=now() WHERE id=$1`,[deleted])
    await runner.query(`UPDATE hz_fop_document_relations SET removed_at=now() WHERE to_document_id=$1`,[removed])
    await dispatchFor(hidden,'C');await dispatchFor(denied,'C')
    await runner.query(`INSERT INTO hz_fop_resource_grants(id,connection_id,company_id,resource_type,target_key,decision,verified_at,source_as_of,expires_at) VALUES($1,$2,$3,'orders','denied','deny',now(),now(),now()+interval '60 seconds')`,[randomUUID(),connection,company])
    employeeIds=['10']
    const result=await service.getOrders(owner,{queue:'allocation',taskStatus:'dispatch_complete',timeRange:'all',page:1,pageSize:20})
    expect(result.items.map(item=>item.id)).toEqual(['visible'])
    expect(result.total).toBe(1)
  })
  it.each(['unverified','pending-relation','missing-header'] as const)('rejects %s linked evidence before filtering or reporting zero', async state => {
    const id=await filterOrder('bad-evidence'),dispatch=await dispatchFor(id,'C','full')
    if(state==='unverified') await runner.query(`UPDATE hz_fop_source_documents SET validation_state='unverified' WHERE id=$1`,[dispatch])
    if(state==='pending-relation') await runner.query(`UPDATE hz_fop_document_relations SET resolution_state='pending' WHERE to_document_id=$1`,[dispatch])
    if(state==='missing-header') await runner.query(`DELETE FROM hz_fop_dispatches WHERE document_id=$1`,[dispatch])
    for(const [queue,taskStatus] of [['allocation','dispatch_complete'],['allocation_review','dispatch_incomplete'],['procurement','dispatch_preparation']] as const) await expect(service.getOrders(owner,{queue,taskStatus,timeRange:'all',page:1,pageSize:20,projection:'count'})).rejects.toMatchObject({response:{code:'workbench_replica_incomplete',total:null}})
  })
  it.each(['connection_id','company_id','dataset_id'] as const)('ignores dispatch relations from another %s in filters and display', async column => {
    const id=await filterOrder('scoped'),dispatch=await dispatchFor(id,'C','full')
    await runner.query(`UPDATE hz_fop_document_relations SET ${column}=$2 WHERE to_document_id=$1`,[dispatch,randomUUID()])
    const base={queue:'allocation' as const,timeRange:'all' as const,page:1,pageSize:20}
    expect((await service.getOrders(owner,{...base,taskStatus:'dispatch_complete'})).total).toBe(0)
    const incomplete=await service.getOrders(owner,{...base,taskStatus:'dispatch_incomplete'})
    expect(incomplete.total).toBe(1)
    expect((incomplete.items[0] as any).dispatchDocuments).toBeNull()
    expect((await service.getOrders(owner,{...base,queue:'procurement',taskStatus:'dispatch_preparation'})).total).toBe(1)
  })
  it('reads fulfillment purchase and outbound statuses instead of stale workbench projections', async () => {
    const id=await order('native-status','10','12.30',2)
    await runner.query(`UPDATE hz_fop_fulfillment_orders SET raw_purchase_status='3',raw_delivery_status='2' WHERE document_id=$1`,[id])
    await runner.query(`UPDATE hz_fop_workbench_orders SET purchase_coverage_state='ordered',supplier_shipment_state='pending',outbound_state='pending',allocation_created=true,allocation_review_state='approved',order_review_state='approved' WHERE document_id=$1`,[id])
    for(const queue of ['shipping','warehouse_completed','procurement_completed'])await runner.query(`INSERT INTO hz_fop_workbench_memberships(id,connection_id,company_id,dataset_id,order_document_id,queue_code,classification_state,projection_revision,rule_version,published_at) VALUES($1,$2,$3,$4,$5,$6,'member',1,1,now())`,[randomUUID(),connection,company,dataset,id,queue])
    const done=await service.getOrders(owner,{queue:'shipping',completed:true,timeRange:'all',page:1,pageSize:20})
    expect(done.items[0]).toMatchObject({sourcePurchaseStatus:'3',sourceOutboundStatus:'2',fulfillmentProgress:{outbound:'completed'}})
    expect((await service.getOrders(owner,{queue:'shipping',timeRange:'all',page:1,pageSize:20})).total).toBe(0)
    const purchased=await service.getOrders(owner,{queue:'procurement',completed:true,timeRange:'all',page:1,pageSize:20})
    expect(purchased.total).toBe(1);expect(purchased.items[0]).toMatchObject({sourcePurchaseStatus:'3'})
    await runner.query(`UPDATE hz_fop_fulfillment_orders SET raw_delivery_status='1' WHERE document_id=$1`,[id])
    const partial=await service.getOrders(owner,{queue:'shipping',taskStatus:'outbound_pending',timeRange:'all',page:1,pageSize:20})
    expect(partial.total).toBe(1);expect(partial.items[0]).toMatchObject({sourceOutboundStatus:'1',fulfillmentProgress:{outbound:'partial'}})
    await runner.query(`UPDATE hz_fop_fulfillment_orders SET raw_delivery_status=NULL WHERE document_id=$1`,[id])
    await expect(service.getOrders(owner,{queue:'shipping',timeRange:'all',page:1,pageSize:20})).rejects.toMatchObject({response:{code:'workbench_replica_incomplete'}})
  })

  it('filters employees and whole-order SKU search before totals and paging', async () => {
    await order('9007199254740993001','10','12.30',2)
    await order('2','20','500.00',2)
    employeeIds=['10']
    const response=await service.getOrders(owner,{queue:'review',search:'MATCH',page:1,pageSize:1})
    expect(response.total).toBe(1)
    expect((response.totals as any).amountsByCurrency).toEqual([{currency:'USD',amount:12.3}])
    expect(response.items[0].id).toBe('9007199254740993001')
    expect(response.items[0].items.map(item=>item.sku)).toEqual(['MATCH','OTHER'])
    expect(response.replica.sourceSyncedAt).toBeNull()
  })
  it('rejects unknown classification and an absent membership rather than reporting zero', async () => {
    await order('1','10','12.30',2,'unknown')
    await expect(service.getOrders(owner,{queue:'review',projection:'count',page:1,pageSize:1})).rejects.toMatchObject({response:{code:'workbench_replica_incomplete',total:null}})
    await runner.query('DELETE FROM hz_fop_workbench_memberships WHERE company_id=$1',[company])
    await expect(service.getOrders(owner,{queue:'review',page:1,pageSize:1})).rejects.toMatchObject({response:{code:'workbench_replica_incomplete'}})
  })
  it('honors an object deny over a resource wildcard and an empty member scope', async () => {
    await order('1','10','12.30',2)
    await runner.query(`INSERT INTO hz_fop_resource_grants (id,connection_id,company_id,resource_type,target_key,decision,verified_at,source_as_of,expires_at) VALUES ($1,$2,$3,'orders','1','deny',now(),now(),now()+interval '60 seconds')`,[randomUUID(),connection,company])
    expect((await service.getOrders(owner,{queue:'review',page:1,pageSize:1})).total).toBe(0)
    employeeIds=[]
    expect((await service.getOrders(owner,{queue:'review',page:1,pageSize:1})).total).toBe(0)
  })
  it('does not let a wildcard bypass an object grant with missing freshness evidence', async () => {
    await order('1','10','12.30',2)
    await runner.query(`INSERT INTO hz_fop_resource_grants (id,connection_id,company_id,resource_type,target_key,decision,verified_at,expires_at) VALUES ($1,$2,$3,'orders','1','allow',now(),now()+interval '60 seconds')`,[randomUUID(),connection,company])
    expect((await service.getOrders(owner,{queue:'review',page:1,pageSize:1})).total).toBe(0)
  })
  it('groups known unassigned procurement demands and pages group details locally', async () => {
    const id=await order('1','10','12.30',2)
    await runner.query(`INSERT INTO hz_fop_resource_grants (id,connection_id,company_id,resource_type,target_key,decision,verified_at,source_as_of,expires_at) VALUES ($1,$2,$3,'purchases','*','allow',now(),now(),now()+interval '60 seconds')`,[randomUUID(),connection,company])
    await runner.query(`INSERT INTO hz_fop_workbench_memberships (id,connection_id,company_id,dataset_id,order_document_id,queue_code,classification_state,projection_revision,rule_version,published_at) VALUES ($1,$2,$3,$4,$5,'procurement','member',1,1,now())`,[randomUUID(),connection,company,dataset,id])
    const line=(await runner.query('SELECT id FROM hz_fop_source_lines WHERE document_id=$1 ORDER BY source_entry_id LIMIT 1',[id]))[0].id
    await runner.query(`INSERT INTO hz_fop_workbench_procurement_demands (id,connection_id,company_id,dataset_id,order_document_id,order_line_id,effective_order_quantity,stock_covered_quantity,required_quantity,allocated_quantity,unassigned_quantity,calculation_state,projection_revision) VALUES ($1,$2,$3,$4,$5,$6,2,0,2,0,2,'known',1)`,[randomUUID(),connection,company,dataset,id,line])
    const response=await service.getPurchaseGroups(owner,{queue:'procurement',page:1,pageSize:20})
    expect(response.total).toBe(1)
    expect(response.items[0]).toMatchObject({id:'uncreated',kind:'uncreated',orderCount:1,quantity:2,pendingQuantity:2})
    const details=await service.getPurchaseGroupDetails(owner,'uncreated',{queue:'procurement',page:1,pageSize:20})
    expect(details.total).toBe(1)
    expect(details.items[0]).toMatchObject({orderNumber:'TO1'})
    expect(details.items[0].lines).toHaveLength(1)
  })
  it('uses whole purchase entries for SKU, quantity and sales-number counts independently of detail paging', async () => {
    const id=await order('purchase-whole','10','12.30',2), purchase=randomUUID()
    await runner.query(`INSERT INTO hz_fop_resource_grants(id,connection_id,company_id,resource_type,target_key,decision,verified_at,source_as_of,expires_at) VALUES($1,$2,$3,'purchases','*','allow',now(),now(),now()+interval '60 seconds')`,[randomUUID(),connection,company])
    for(const queue of ['procurement','procurement_completed'])await runner.query(`INSERT INTO hz_fop_workbench_memberships(id,connection_id,company_id,dataset_id,order_document_id,queue_code,classification_state,projection_revision,rule_version,published_at) VALUES($1,$2,$3,$4,$5,$6,'member',1,1,now())`,[randomUUID(),connection,company,dataset,id,queue])
    await runner.query(`INSERT INTO hz_fop_source_documents(id,connection_id,company_id,dataset_id,entity_code,source_id,document_number,validation_state) VALUES($1,$2,$3,$4,'hzkj_purorderbill','P-WHOLE','PO-WHOLE','verified')`,[purchase,connection,company,dataset])
    await runner.query(`INSERT INTO hz_fop_purchase_orders(document_id,company_id,dataset_id) VALUES($1,$2,$3)`,[purchase,company,dataset])
    await runner.query(`INSERT INTO hz_fop_platform_orders(id,connection_id,company_id,dataset_id,purchase_document_id,platform_code,external_order_id) VALUES($1,$2,$3,$4,$5,'1688','1688-WHOLE')`,[randomUUID(),connection,company,dataset,purchase])
    const sourceLine=(await runner.query('SELECT id FROM hz_fop_source_lines WHERE document_id=$1 ORDER BY source_entry_id LIMIT 1',[id]))[0].id
    await runner.query(`INSERT INTO hz_fop_workbench_procurement_demands(id,connection_id,company_id,dataset_id,order_document_id,order_line_id,effective_order_quantity,stock_covered_quantity,required_quantity,allocated_quantity,unassigned_quantity,calculation_state,projection_revision) VALUES($1,$2,$3,$4,$5,$6,5,0,5,5,0,'known',1)`,[randomUUID(),connection,company,dataset,id,sourceLine])
    for(const [index,sku,number,quantity,shipped] of [[0,'SAME','  SALE-A ',2,2],[1,'SAME','SALE-A',1,0],[2,'OTHER','SALE-B',2,1]] as const){
      const line=randomUUID()
      await runner.query(`INSERT INTO hz_fop_source_lines(id,connection_id,company_id,dataset_id,document_id,entry_entity,source_entry_id,sku_code,quantity) VALUES($1,$2,$3,$4,$5,'hzkj_billentry',$6,$7,$8)`,[line,connection,company,dataset,purchase,String(index),sku,quantity])
      await runner.query(`INSERT INTO hz_fop_procurement_line_details(line_id,company_id,dataset_id,ordered_quantity,supplier_shipped_quantity,cancelled_quantity,sales_order_number) VALUES($1,$2,$3,$4,$5,0,$6)`,[line,company,dataset,quantity,shipped,number])
      await runner.query(`INSERT INTO hz_fop_workbench_purchase_allocations(id,connection_id,company_id,dataset_id,order_document_id,order_line_id,purchase_document_id,purchase_line_id,allocated_requirement_quantity,supplier_shipped_quantity,cancelled_quantity,returned_quantity,allocation_state,projection_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0,'known',1)`,[randomUUID(),connection,company,dataset,id,sourceLine,purchase,line,index===2?1:quantity,shipped])
    }
    const result=await service.getPurchaseGroups(owner,{queue:'procurement',search:'MATCH',page:1,pageSize:20})
    expect(result.items[0]).toMatchObject({orderCount:2,skuCount:2,quantity:5,shippedQuantity:3,pendingQuantity:2,purchase:{platformOrderNumber:'1688-WHOLE'}})
    expect((await service.getPurchaseGroups(owner,{queue:'procurement',search:'PO-WHOLE',page:1,pageSize:20})).total).toBe(1)
    expect((await service.getPurchaseGroups(owner,{queue:'procurement',search:'1688-WHOLE',page:1,pageSize:20})).total).toBe(1)
    const details=await service.getPurchaseGroupDetails(owner,'purchase:'+purchase,{queue:'procurement',page:1,pageSize:20})
    expect(details.total).toBe(1)
    expect(new Set(details.items[0].lines.map((line:any)=>line.purchaseLineId)).size).toBe(3)
    expect(details.items[0].lines.every((line:any)=>line.purchaseLineId !== null)).toBe(true)
    expect(details.group.orderCount).toBe(2)
    const hidden=await order('purchase-hidden','20','12.30',2)
    const hiddenLine=(await runner.query('SELECT id FROM hz_fop_source_lines WHERE document_id=$1 LIMIT 1',[hidden]))[0].id
    const purchaseLine=(await runner.query('SELECT id FROM hz_fop_source_lines WHERE document_id=$1 LIMIT 1',[purchase]))[0].id
    const hiddenAllocation=randomUUID()
    await runner.query(`INSERT INTO hz_fop_workbench_purchase_allocations(id,connection_id,company_id,dataset_id,order_document_id,order_line_id,purchase_document_id,purchase_line_id,allocated_requirement_quantity,supplier_shipped_quantity,cancelled_quantity,returned_quantity,allocation_state,projection_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,0,0,0,'known',1)`,[hiddenAllocation,connection,company,dataset,hidden,hiddenLine,purchase,purchaseLine])
    employeeIds=['10']
    await expect(service.getPurchaseGroups(owner,{queue:'procurement',page:1,pageSize:20})).rejects.toMatchObject({response:{code:'workbench_replica_incomplete'}})
    await runner.query('DELETE FROM hz_fop_workbench_purchase_allocations WHERE id=$1',[hiddenAllocation])
    await runner.query('UPDATE hz_fop_procurement_line_details SET supplier_shipped_quantity=ordered_quantity WHERE company_id=$1',[company])
    const completed=await service.getPurchaseGroups(owner,{queue:'procurement',completed:true,timeRange:'1w',page:1,pageSize:20})
    expect(completed.items[0]).toMatchObject({quantity:5,shippedQuantity:5,pendingQuantity:0})
    expect((await service.getPurchaseGroups(owner,{queue:'procurement',page:1,pageSize:20})).total).toBe(0)
    await runner.query('UPDATE hz_fop_procurement_line_details SET sales_order_number=NULL WHERE company_id=$1',[company])
    await expect(service.getPurchaseGroups(owner,{queue:'procurement',completed:true,page:1,pageSize:20})).rejects.toMatchObject({response:{code:'workbench_replica_incomplete'}})
  })
  it('reads an unambiguous physical return by fulfillment order with independent grants', async () => {
    const id=await order('1','10','12.30',2),purchase=randomUUID(),ret=randomUUID(),retLine=randomUUID()
    for(const resource of ['purchases','purchase_returns']) await runner.query(`INSERT INTO hz_fop_resource_grants (id,connection_id,company_id,resource_type,target_key,decision,verified_at,source_as_of,expires_at) VALUES ($1,$2,$3,$4,'*','allow',now(),now(),now()+interval '60 seconds')`,[randomUUID(),connection,company,resource])
    for(const [doc,entity,source] of [[purchase,'hzkj_purorderbill','P1'],[ret,'hzkj_purrefundapplybill','R1']]) await runner.query(`INSERT INTO hz_fop_source_documents (id,connection_id,company_id,dataset_id,entity_code,source_id,document_number,validation_state) VALUES ($1,$2,$3,$4,$5,$6,$6,'verified')`,[doc,connection,company,dataset,entity,source])
    await runner.query(`INSERT INTO hz_fop_purchase_returns (document_id,company_id,dataset_id,purchase_source_id,return_kind) VALUES ($1,$2,$3,'P1','RETURN_REFUND')`,[ret,company,dataset])
    await runner.query(`INSERT INTO hz_fop_source_lines (id,connection_id,company_id,dataset_id,document_id,entry_entity,source_entry_id,sku_code,quantity) VALUES ($1,$2,$3,$4,$5,'entry','R1','MATCH',2)`,[retLine,connection,company,dataset,ret])
    await runner.query(`INSERT INTO hz_fop_return_line_details (line_id,company_id,dataset_id,requested_quantity,returned_quantity) VALUES ($1,$2,$3,2,1)`,[retLine,company,dataset])
    const sourceLine=(await runner.query('SELECT id FROM hz_fop_source_lines WHERE document_id=$1 ORDER BY source_entry_id LIMIT 1',[id]))[0].id
    await runner.query(`INSERT INTO hz_fop_document_relations (id,connection_id,company_id,dataset_id,from_document_id,from_line_id,to_document_id,to_line_id,relation_type,holder_document_id,relation_grain,resolution_state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'purchase_return',$7,'line_line','resolved')`,[randomUUID(),connection,company,dataset,id,sourceLine,ret,retLine])
    await runner.query(`INSERT INTO hz_fop_workbench_memberships (id,connection_id,company_id,dataset_id,order_document_id,queue_code,classification_state,projection_revision,rule_version,published_at) VALUES ($1,$2,$3,$4,$5,'purchase_returns','member',1,1,now())`,[randomUUID(),connection,company,dataset,id])
    const result=await service.getPurchaseReturns(owner,{workbenchRole:'procurement',paidAtOrder:'desc',search:'R1',page:1,pageSize:20})
    expect(result.total).toBe(1)
    expect((result.items[0] as any).purchaseReturns[0]).toMatchObject({number:'R1',status:'unknown',quantity:2,returnedQuantity:1})
    expect(result.items[0].items).toHaveLength(2)
    expect(result.totals).toMatchObject({returnCount:1,quantity:2,returnedQuantity:1})
  })
  it('queries independent RMA relations and keeps the complete source order products', async () => {
    const id=await order('1','10','12.30',2)
    const rma=randomUUID()
    await runner.query(`INSERT INTO hz_fop_source_documents (id,connection_id,company_id,dataset_id,entity_code,source_id,document_number,validation_state) VALUES ($1,$2,$3,$4,'hzkj_after_sale_orders','R1','RMA1','verified')`,[rma,connection,company,dataset])
    await runner.query(`INSERT INTO hz_fop_rma_orders (document_id,company_id,dataset_id,after_sale_type,is_open,refund_amount,refund_currency) VALUES ($1,$2,$3,'refund',true,3.25,'USD')`,[rma,company,dataset])
    await runner.query(`INSERT INTO hz_fop_document_relations (id,connection_id,company_id,dataset_id,from_document_id,to_document_id,relation_type,holder_document_id,relation_grain,resolution_state) VALUES ($1,$2,$3,$4,$5,$6,'rma',$6,'document','resolved')`,[randomUUID(),connection,company,dataset,id,rma])
    const response=await service.getRmaOrders(owner,{flowStatus:'active',type:'refund',search:'RMA1',page:1,pageSize:20})
    expect(response.total).toBe(1)
    expect((response.items[0] as any).rmaCases[0]).toMatchObject({number:'RMA1',refundAmount:3.25,refundCurrency:'USD'})
    expect(response.items[0].items).toHaveLength(2)
    const second=randomUUID()
    await runner.query(`INSERT INTO hz_fop_source_documents (id,connection_id,company_id,dataset_id,entity_code,source_id,document_number,validation_state) VALUES ($1,$2,$3,$4,'hzkj_after_sale_orders','R2','RMA2','verified')`,[second,connection,company,dataset])
    await runner.query(`INSERT INTO hz_fop_rma_orders (document_id,company_id,dataset_id,after_sale_type,is_open,refund_amount,refund_currency) VALUES ($1,$2,$3,'refund',true,1.50,'USD')`,[second,company,dataset])
    await runner.query(`INSERT INTO hz_fop_document_relations (id,connection_id,company_id,dataset_id,from_document_id,to_document_id,relation_type,holder_document_id,relation_grain,resolution_state) VALUES ($1,$2,$3,$4,$5,$6,'rma',$6,'document','resolved')`,[randomUUID(),connection,company,dataset,id,second])
    const firstPage=await service.getRmaOrders(owner,{flowStatus:'active',page:1,pageSize:1})
    const secondPage=await service.getRmaOrders(owner,{flowStatus:'active',page:2,pageSize:1})
    expect(firstPage.total).toBe(2)
    expect(firstPage.totals).toMatchObject({caseCount:2,orderCount:1,itemQuantity:2,amountsByCurrency:[{currency:'USD',amount:12.3}]})
    expect(firstPage.items).toHaveLength(1); expect(secondPage.items).toHaveLength(1)
    expect(firstPage.items[0].id).not.toBe(secondPage.items[0].id)
    expect([...(firstPage.items as any[]),...(secondPage.items as any[])].map(row=>row.refundAmounts[0].amount).sort()).toEqual([1.5,3.25])
    const exact=await service.getRmaOrders(owner,{flowStatus:'active',search:'RMA2',page:1,pageSize:20})
    expect(exact.total).toBe(1); expect((exact.items[0] as any).rmaCases[0].number).toBe('RMA2')
    await runner.query(`DELETE FROM hz_fop_resource_grants WHERE company_id=$1 AND resource_type='rma'`,[company])
    await expect(service.getRmaOrders(owner,{flowStatus:'active',page:1,pageSize:20})).rejects.toMatchObject({response:{code:'workbench_replica_authorization_stale'}})
  })
  it('uses dispatch delivery and actual route facts independently of order packages and bill approval', async () => {
    const id=await order('dispatch-source','10','12.30',2),dispatch=randomUUID()
    await runner.query(`INSERT INTO hz_fop_source_documents(id,connection_id,company_id,dataset_id,entity_code,source_id,document_number,validation_state,raw_bill_status,source_audited_at) VALUES($1,$2,$3,$4,'hzkj_deliver_bill','D1','FY1','verified','C',now())`,[dispatch,connection,company,dataset])
    await runner.query(`INSERT INTO hz_fop_dispatches(document_id,company_id,dataset_id,actual_channel_id,raw_delivery_status) VALUES($1,$2,$3,'dispatch-route','TRACKING_OBTAINED')`,[dispatch,company,dataset])
    await runner.query(`INSERT INTO hz_fop_reference_items(id,connection_id,company_id,resource_type,source_id,name) VALUES($1,$2,$3,'actual_channel','dispatch-route','Changed dispatch channel')`,[randomUUID(),connection,company])
    await runner.query(`INSERT INTO hz_fop_document_relations(id,connection_id,company_id,dataset_id,from_document_id,to_document_id,relation_type,holder_document_id,relation_grain,resolution_state) VALUES($1,$2,$3,$4,$5,$6,'dispatch',$6,'document','resolved')`,[randomUUID(),connection,company,dataset,id,dispatch])
    for(const queue of ['dispatch','dispatch_completed'])await runner.query(`INSERT INTO hz_fop_workbench_memberships(id,connection_id,company_id,dataset_id,order_document_id,queue_code,classification_state,projection_revision,rule_version,published_at) VALUES($1,$2,$3,$4,$5,$6,'member',1,1,now())`,[randomUUID(),connection,company,dataset,id,queue])
    for(const type of ['full','last_mile'])await runner.query(`INSERT INTO hz_fop_tracking_numbers(id,connection_id,company_id,dataset_id,dispatch_document_id,tracking_type,number,shopify_selected,source_version) VALUES($1,$2,$3,$4,$5,$6,$7,false,1)`,[randomUUID(),connection,company,dataset,dispatch,type,'000-'+type])
    const pending=await service.getOrders(owner,{queue:'dispatch',timeRange:'all',page:1,pageSize:20})
    expect(pending.total).toBe(1)
    expect(pending.items[0]).toMatchObject({dispatchTaskStatus:'dispatch_tracking',logisticsInfo:[{channelName:'Changed dispatch channel',trackingNumbers:[{type:'full',number:'000-full'},{type:'last_mile',number:'000-last_mile'}]}]})
    expect((await service.getOrders(owner,{queue:'dispatch',completed:true,timeRange:'all',page:1,pageSize:20})).total).toBe(0)
    await runner.query(`UPDATE hz_fop_dispatches SET raw_delivery_status='FULFILLED' WHERE document_id=$1`,[dispatch])
    expect((await service.getOrders(owner,{queue:'dispatch',timeRange:'all',page:1,pageSize:20})).total).toBe(0)
    const complete=await service.getOrders(owner,{queue:'dispatch',completed:true,timeRange:'all',page:1,pageSize:20})
    expect(complete.total).toBe(1); expect((complete.items[0] as any).dispatchApprovedAt).toBeTruthy()
  })


  it.each([false,true])('warehouse completed=%s keeps one fulfillment row and only approved dispatch logistics', async completed => {
    const id=await order('warehouse-logistics','10','12.30',2)
    await runner.query('UPDATE hz_fop_fulfillment_orders SET raw_delivery_status=$2 WHERE document_id=$1',[id,completed?'2':'0'])
    for(const queue of ['shipping','warehouse_completed'])await runner.query(`INSERT INTO hz_fop_workbench_memberships(id,connection_id,company_id,dataset_id,order_document_id,queue_code,classification_state,projection_revision,rule_version,published_at) VALUES($1,$2,$3,$4,$5,$6,'member',1,1,now())`,[randomUUID(),connection,company,dataset,id,queue])
    const docs:string[]=[]
    for(const [index,state] of ['C','C','B'].entries()) {
      const doc=randomUUID();docs.push(doc)
      await runner.query(`INSERT INTO hz_fop_source_documents(id,connection_id,company_id,dataset_id,entity_code,source_id,document_number,validation_state,raw_bill_status) VALUES($1,$2,$3,$4,'hzkj_deliver_bill',$5,$5,'verified',$6)`,[doc,connection,company,dataset,'FY'+index,state])
      await runner.query(`INSERT INTO hz_fop_dispatches(document_id,company_id,dataset_id,actual_channel_id) VALUES($1,$2,$3,$4)`,[doc,company,dataset,'route'+index])
      await runner.query(`INSERT INTO hz_fop_reference_items(id,connection_id,company_id,resource_type,source_id,name) VALUES($1,$2,$3,'actual_channel',$4,$5)`,[randomUUID(),connection,company,'route'+index,'Dispatch route '+index])
      await runner.query(`INSERT INTO hz_fop_document_relations(id,connection_id,company_id,dataset_id,from_document_id,to_document_id,relation_type,holder_document_id,relation_grain,resolution_state) VALUES($1,$2,$3,$4,$5,$6,'dispatch',$6,'document','resolved')`,[randomUUID(),connection,company,dataset,id,doc])
      for(const type of ['full','last_mile'])await runner.query(`INSERT INTO hz_fop_tracking_numbers(id,connection_id,company_id,dataset_id,dispatch_document_id,tracking_type,number,shopify_selected,source_version) VALUES($1,$2,$3,$4,$5,$6,$7,false,1)`,[randomUUID(),connection,company,dataset,doc,type,'TRACK-'+index+'-'+type])
    }
    const query={queue:'shipping' as const,completed,timeRange:'all' as const,page:1,pageSize:20}
    const page=await service.getOrders(owner,query)
    expect(page.total).toBe(1);expect(page.items).toHaveLength(1);expect(page.items[0].items).toHaveLength(2)
    expect((page.items[0] as any).logisticsInfo).toMatchObject([0,1].map(i=>({channelName:'Dispatch route '+i,trackingNumbers:[{type:'full',number:'TRACK-'+i+'-full'},{type:'last_mile',number:'TRACK-'+i+'-last_mile'}]})))
    await runner.query(`UPDATE hz_fop_source_documents SET raw_bill_status='B' WHERE id=$1`,[docs[0]])
    await runner.query(`UPDATE hz_fop_document_relations SET removed_at=now() WHERE to_document_id=$1`,[docs[1]])
    const cleared=await service.getOrders(owner,query)
    expect(cleared.total).toBe(1);expect((cleared.items[0] as any).logisticsInfo).toEqual([])
  })

  it('hides deleted or unlinked dispatch tracking and reads only recreated dispatch numbers', async () => {
    const orderId=await order('tracking-lifecycle','10','12.30',2), packageId=randomUUID()
    await runner.query(`INSERT INTO hz_fop_order_packages(id,connection_id,company_id,dataset_id,order_document_id,source_package_key,provider_id,expected_active,source_version) VALUES($1,$2,$3,$4,$5,'1','provider',true,1)`,[packageId,connection,company,dataset,orderId])
    const addDispatch=async (source:string,number:string) => {
      const doc=randomUUID(), relation=randomUUID()
      await runner.query(`INSERT INTO hz_fop_source_documents(id,connection_id,company_id,dataset_id,entity_code,source_id,validation_state) VALUES($1,$2,$3,$4,'hzkj_deliver_bill',$5,'verified')`,[doc,connection,company,dataset,source])
      await runner.query(`INSERT INTO hz_fop_dispatches(document_id,company_id,dataset_id,raw_delivery_status) VALUES($1,$2,$3,'TRACKING_OBTAINED')`,[doc,company,dataset])
      await runner.query(`INSERT INTO hz_fop_document_relations(id,connection_id,company_id,dataset_id,from_document_id,to_document_id,relation_type,holder_document_id,relation_grain,resolution_state) VALUES($1,$2,$3,$4,$5,$6,'dispatch',$6,'document','resolved')`,[relation,connection,company,dataset,orderId,doc])
      await runner.query(`INSERT INTO hz_fop_tracking_numbers(id,connection_id,company_id,dataset_id,dispatch_document_id,package_id,tracking_type,number,provider_id,shopify_selected,source_version) VALUES($1,$2,$3,$4,$5,$6,'full',$7,'provider',true,1)`,[randomUUID(),connection,company,dataset,doc,packageId,number])
      return {doc,relation}
    }
    const read=async()=> (await runner.query(`SELECT ${localLogisticsSql} AS packages FROM hz_fop_workbench_orders o WHERE o.document_id=$1`,[orderId]))[0].packages[0].shopifyTracking
    const old=await addDispatch('old','OLD-NUMBER')
    expect(await read()).toEqual({type:'full',number:'OLD-NUMBER'})
    await runner.query('UPDATE hz_fop_document_relations SET removed_at=now() WHERE id=$1',[old.relation])
    expect(await read()).toBeNull()
    await runner.query('UPDATE hz_fop_document_relations SET removed_at=NULL WHERE id=$1',[old.relation])
    await runner.query("UPDATE hz_fop_source_documents SET deleted_at=now(),validation_state='deleted' WHERE id=$1",[old.doc])
    expect(await read()).toBeNull()
    await addDispatch('new','NEW-NUMBER')
    expect(await read()).toEqual({type:'full',number:'NEW-NUMBER'})
  })

  it('approved sales reads current tracking without excluding later business stages', async () => {
    const orderId=await order('approved-sales','10','12.30',2), packageId=randomUUID(), dispatch=randomUUID()
    await runner.query(`INSERT INTO hz_fop_workbench_memberships(id,connection_id,company_id,dataset_id,order_document_id,queue_code,classification_state,projection_revision,rule_version,published_at) VALUES($1,$2,$3,$4,$5,'sales_completed','member',1,1,now())`,[randomUUID(),connection,company,dataset,orderId])
    expect((await service.getOrders(owner,{queue:'review',completed:true,timeRange:'all',page:1,pageSize:20})).total).toBe(0)
    await runner.query(`UPDATE hz_fop_workbench_orders SET order_review_state='approved',customer_payment_state='unpaid',cancelled=true WHERE document_id=$1`,[orderId])
    const missing=await service.getOrders(owner,{queue:'review',completed:true,timeRange:'all',page:1,pageSize:20})
    expect(missing.total).toBe(1);expect(missing.items[0]).toMatchObject({trackingNumber:null})
    await runner.query(`INSERT INTO hz_fop_order_packages(id,connection_id,company_id,dataset_id,order_document_id,source_package_key,provider_id,expected_active,source_version) VALUES($1,$2,$3,$4,$5,'1','provider',true,1)`,[packageId,connection,company,dataset,orderId])
    await runner.query(`INSERT INTO hz_fop_source_documents(id,connection_id,company_id,dataset_id,entity_code,source_id,validation_state) VALUES($1,$2,$3,$4,'hzkj_deliver_bill','approved-dispatch','verified')`,[dispatch,connection,company,dataset])
    await runner.query(`INSERT INTO hz_fop_document_relations(id,connection_id,company_id,dataset_id,from_document_id,to_document_id,relation_type,holder_document_id,relation_grain,resolution_state) VALUES($1,$2,$3,$4,$5,$6,'dispatch',$6,'document','resolved')`,[randomUUID(),connection,company,dataset,orderId,dispatch])
    await runner.query(`INSERT INTO hz_fop_tracking_numbers(id,connection_id,company_id,dataset_id,dispatch_document_id,package_id,tracking_type,number,provider_id,shopify_selected,source_version) VALUES($1,$2,$3,$4,$5,$6,'full','APPROVED-TRACK','provider',true,1)`,[randomUUID(),connection,company,dataset,dispatch,packageId])
    expect((await service.getOrders(owner,{queue:'review',completed:true,timeRange:'all',page:1,pageSize:20})).items[0]).toMatchObject({trackingNumber:'APPROVED-TRACK'})
  })

  it('reads allocation approval and audit time from the live allocation document', async()=>{
    const id=await order('allocation-approved','10','12.30',2),allocation=randomUUID()
    await runner.query(`UPDATE hz_fop_workbench_orders SET order_review_state='approved',allocation_created=true,allocation_review_state='approved' WHERE document_id=$1`,[id])
    await runner.query(`INSERT INTO hz_fop_workbench_memberships(id,connection_id,company_id,dataset_id,order_document_id,queue_code,classification_state,projection_revision,rule_version,published_at,phase_completed_at) VALUES($1,$2,$3,$4,$5,'allocation_completed','member',1,1,now(),'2000-01-01')`,[randomUUID(),connection,company,dataset,id])
    await runner.query(`INSERT INTO hz_fop_source_documents(id,connection_id,company_id,dataset_id,entity_code,source_id,validation_state,raw_bill_status,source_audited_at) VALUES($1,$2,$3,$4,'hzkj_alloc_bill','AO1','verified','C','2026-11-10T08:00:00Z')`,[allocation,connection,company,dataset])
    await runner.query(`INSERT INTO hz_fop_allocations(document_id,company_id,dataset_id) VALUES($1,$2,$3)`,[allocation,company,dataset])
    await runner.query(`INSERT INTO hz_fop_document_relations(id,connection_id,company_id,dataset_id,from_document_id,to_document_id,relation_type,holder_document_id,relation_grain,resolution_state) VALUES($1,$2,$3,$4,$5,$6,'allocation',$6,'document','resolved')`,[randomUUID(),connection,company,dataset,id,allocation])
    const result=await service.getOrders(owner,{queue:'allocation_review',completed:true,timeRange:'all',page:1,pageSize:20})
    expect(result.items[0]).toMatchObject({allocationApprovedAt:'2026-11-10T08:00:00.000Z',fulfillmentProgress:{allocationReview:'approved'}})
    await runner.query(`UPDATE hz_fop_source_documents SET raw_bill_status='B',source_audited_at=NULL WHERE id=$1`,[allocation])
    expect((await service.getOrders(owner,{queue:'allocation_review',completed:true,timeRange:'all',page:1,pageSize:20})).total).toBe(0)
  })

  it('reads review channel names without returning stale package tracking', async()=>{
    const id=await order('package-only','10','12.30',2)
    await runner.query(`INSERT INTO hz_fop_reference_items(id,connection_id,company_id,resource_type,source_id,name) VALUES($1,$2,$3,'actual_channel','package-route','Package channel')`,[randomUUID(),connection,company])
    await runner.query(`INSERT INTO hz_fop_order_packages(id,connection_id,company_id,dataset_id,order_document_id,source_package_key,channel_id,tracking_number,expected_active,source_version) VALUES($1,$2,$3,$4,$5,'1','package-route','000PKG',true,1)`,[randomUUID(),connection,company,dataset,id])
    const result=await service.getOrders(owner,{queue:'review',page:1,pageSize:20})
    expect(result.items[0]).toMatchObject({logisticsInfo:[{channelName:'Package channel'}],dispatchDocuments:null,trackingNumber:null})
    expect(JSON.stringify(result.items[0])).not.toContain('000PKG')
  })

})
