import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { DataSource, EntityManager } from 'typeorm'
import type { LocalWorkbenchService } from './local-workbench.service'
import { assertMockDatabase } from './workbench-mock'
import { publicStockInventory } from '../fop-data/fop-stock'
import { ApprovalPreviewDto, ApprovalSubmitDto } from '../fop-data/fop-approval.dto'
import { ApprovalQueue, approvalVersion, ApprovalTarget, ApprovalRowResult, ApprovalStatus } from '../fop-data/fop-approval.types'
import type { FopOrder } from '../fop-data/fop-data.types'

type Row = Record<string, any>
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export async function collectMockPages(read: (page: number) => Promise<{items: any[]; total: number; replica?: {revision: string}}>): Promise<any[]> {
  const rows:any[]=[];let total=0,revision:string|undefined
  for(let page=1;page<=101;page++){
    const result=await read(page)
    if(page===1){total=result.total;revision=result.replica?.revision}
    if(result.total!==total || result.replica?.revision!==revision)throw new ConflictException('Mock data changed during the query; refresh and retry')
    rows.push(...result.items)
    if(rows.length>=total)return rows
    if(!result.items.length || rows.length>10000)break
  }
  throw new BadRequestException('Mock result exceeds the test dataset limit')
}

/** Test double for ON-DEMAND source APIs. Never serves real FOP or maintains a local inventory ledger. */
export class MockWorkbenchCapabilities {
  constructor(private readonly db: DataSource, private readonly local: LocalWorkbenchService) {
    assertMockDatabase(db)
    if(!local.mock)throw new Error('Mock capabilities are disabled')
  }
  private async scopedOrders(userId:string,query:Row,stock:boolean){
    return collectMockPages(page=>stock?this.local.getStockOrders(userId,{queue:query.queue==='procurement'?'procurement':'all',departmentId:query.departmentId,ownerId:query.ownerId,page,pageSize:100}):this.local.getOrders(userId,{queue:query.queue==='shipping'?'shipping':'allocation',page,pageSize:100}))
  }
  private async inventoryGrants(resource:string,targets:string[]):Promise<string>{
    const grants:Row[]=await this.db.query(`SELECT g.target_key,g.decision,g.grant_version,g.verified_at,g.source_as_of,g.expires_at FROM hz_fop_resource_grants g JOIN hz_fop_connections c ON c.id=g.connection_id JOIN hz_fop_companies co ON co.id=g.company_id WHERE c.credential_ref='local-mock-only' AND c.status='active' AND co.enabled IS TRUE AND g.resource_type=$1 ORDER BY g.id`,[resource])
    const now=Date.now(),fresh=(g:Row)=>Date.parse(g.verified_at)<=now&&Date.parse(g.verified_at)>=now-60000&&Date.parse(g.source_as_of)<=now&&Date.parse(g.source_as_of)>=now-60000&&Date.parse(g.expires_at)>now
    for(const id of targets.length?targets:['*']){
      const matching=grants.filter(g=>g.target_key==='*'||g.target_key===id)
      if(matching.some(g=>g.decision==='deny')||!matching.some(g=>g.decision==='allow'&&fresh(g))||matching.some(g=>g.target_key===id&&!fresh(g)))throw new ForbiddenException('Independent inventory resource authorization is required')
    }
    return hash(grants.map(({verified_at:_v,source_as_of:_s,expires_at:_e,...g})=>g))
  }
  async stockInventory(userId:string,query:Row) {
    const authorization=await this.authorization(this.db)
    const rows=await this.scopedOrders(userId,query,true)
    const selected=query.orderIds?rows.filter(row=>query.orderIds.includes(row.id)):rows
    if(query.orderIds && new Set(selected.map(row=>row.id)).size!==query.orderIds.length)throw new ForbiddenException('Selected stock orders are outside the current scope')
    const [user]=await this.db.query('SELECT role,business_role FROM users WHERE id=$1',[userId])
    const [binding]=await this.db.query("SELECT employee_master_id FROM hz_fop_employee_bindings WHERE local_account_id=$1 AND enabled IS TRUE AND state='directory_verified'",[userId])
    const scoped=selected.filter(row=>query.orderIds || user?.role==='admin' || user?.business_role==='admin' || row.owner.id===binding?.employee_master_id)
    const mapped=new Map<string,any>(),search=(query.search??'').toLowerCase(),customerSearch=(query.customerSearch??'').toLowerCase()
    for(const order of scoped)for(const item of order.items){
      if(query.customerId && order.customerId!==query.customerId || query.warehouseCode && order.warehouseCode!==query.warehouseCode || search && !`${item.sku} ${item.name}`.toLowerCase().includes(search) || customerSearch&&!order.customerName.toLowerCase().includes(customerSearch))continue
      const id=JSON.stringify([order.customerId,item.sku,order.warehouseCode]),n=parseInt(hash(id).slice(0,4),16)
      mapped.set(id,publicStockInventory({...order,tenantId:'local-mock',id,customerCode:order.customerId,sku:item.sku,name:item.name,imageUrl:item.imageUrl,fullPayment:{available:n%60,locked:n%5},deposit:{available:n%30,locked:n%3}}))
    }
    const items=[...mapped.values()].sort((a,b)=>a.id.localeCompare(b.id)),page=query.page??1,pageSize=query.pageSize??50
    const grants=await this.inventoryGrants('stock_inventory',items.map(item=>item.id))
    const asOf=new Date().toISOString()
    if(grants!==await this.inventoryGrants('stock_inventory',items.map(item=>item.id)))throw new ForbiddenException('Inventory authorization changed')
    if(authorization!==await this.authorization(this.db))throw new ForbiddenException('Inventory scope changed')
    return {source:'mock',asOf,refreshedAt:asOf,customerId:query.customerId??null,items:items.slice((page-1)*pageSize,page*pageSize),total:items.length,page,pageSize}
  }
  async stockCustomers(userId:string,query:Row){
    const orders=await this.scopedOrders(userId,query,true),items=[...new Map(orders.filter(row=>!query.search||row.customerName.toLowerCase().includes(query.search.toLowerCase())).map(row=>[row.customerId,{id:row.customerId,code:row.customerId,name:row.customerName}])).values()]
    return {source:'mock',items,total:items.length}
  }
  async allocationInventory(userId:string,query:Row){
    const authorization=await this.authorization(this.db)
    if(!['selected','search'].includes(query.mode) || query.mode==='search'&&!query.search?.trim())throw new BadRequestException('Select orders or enter a SKU')
    const rows=await this.scopedOrders(userId,query,false),selected=query.mode==='selected'?rows.filter(row=>query.orderIds?.includes(row.id)):rows
    if(query.mode==='selected'&&(!query.orderIds?.length||selected.length!==query.orderIds.length))throw new ForbiddenException('Selected orders are outside the current scope')
    const mapped=new Map<string,any>()
    for(const order of selected)for(const item of order.items){
      if(query.warehouseCode&&order.warehouseCode!==query.warehouseCode || query.mode==='search'&&!item.sku.toLowerCase().includes(query.search.toLowerCase()))continue
      for(const customer of [null,{id:order.customerId,name:order.customerName}]){
        const id=JSON.stringify([item.sku,order.warehouseCode,customer?.id??null]),n=parseInt(hash(id).slice(0,4),16),onHand=n%100,occupied=Math.min(onHand,n%7)
        mapped.set(id,{id,sku:item.sku,name:item.name,warehouseCode:order.warehouseCode,warehouse:order.warehouse,customer,onHand,occupied,free:onHand-occupied})
      }
    }
    const items=[...mapped.values()].sort((a,b)=>a.id.localeCompare(b.id)),page=query.page??1,pageSize=query.pageSize??50
    const grants=await this.inventoryGrants('allocation_inventory',items.map(item=>item.id))
    if(grants!==await this.inventoryGrants('allocation_inventory',items.map(item=>item.id)))throw new ForbiddenException('Inventory authorization changed')
    if(authorization!==await this.authorization(this.db))throw new ForbiddenException('Inventory scope changed')
    return {source:'mock',asOf:new Date().toISOString(),items:items.slice((page-1)*pageSize,page*pageSize),total:items.length,page,pageSize}
  }
  private async target(userId:string,queue:ApprovalQueue,orderId:string){
    if(!['review','allocation_review'].includes(queue))throw new BadRequestException('Invalid approval queue')
    const [source]=await this.db.query('SELECT document_number,source_version FROM hz_fop_source_documents WHERE entity_code=$1 AND source_id=$2 AND deleted_at IS NULL',['hzkj_orders',orderId])
    if(!source)throw new ForbiddenException('Order is outside the current scope')
    let response=await this.local.getOrders(userId,{queue,search:source.document_number,page:1,pageSize:100})
    let order=(response.items as FopOrder[]).find(row=>row.id===orderId)
    const inQueue=!!order
    if(!order){response=await this.local.getOrders(userId,{queue,completed:true,timeRange:'all' as any,search:source.document_number,page:1,pageSize:100});order=(response.items as FopOrder[]).find(row=>row.id===orderId)}
    if(!order)throw new ForbiddenException('Order is outside the current scope')
    const [document]=await this.db.query(`SELECT sd.* FROM hz_fop_source_documents sd WHERE ${queue==='review' ? "sd.entity_code='hzkj_orders' AND sd.source_id=$1" : "sd.id=(SELECT r.to_document_id FROM hz_fop_document_relations r JOIN hz_fop_source_documents original ON original.id=r.from_document_id WHERE original.source_id=$1 AND original.entity_code='hzkj_orders' AND r.relation_type='allocation' AND r.resolution_state='resolved' AND r.removed_at IS NULL)"}`,[orderId])
    if(!document)throw new ConflictException('The linked approval document is missing')
    const eligible=!!(inQueue&&document.raw_bill_status==='B'&&order.paymentStatus==='paid'&&!order.cancelled&&order.shipmentInterceptStatus!=='intercepted'&&(queue==='review'||order.fulfillmentProgress.stockReadiness==='ready'&&order.dispatchDocuments?.every(d=>d.status==='approved')&&!!order.dispatchDocuments?.length))
    const target:ApprovalTarget={tenantId:'local-mock',orderId,id:document.source_id,number:document.document_number,entity:document.entity_code,version:hash([document.source_version,source.source_version]),status:document.raw_bill_status,eligible,reason:eligible?null:'单据已审核或审核条件不满足'}
    return {order,document,target,inQueue,originalVersion:source.source_version}
  }
  private async session(userId:string,version:number){
    const [user]=await this.db.query('SELECT account_disabled,session_version FROM users WHERE id=$1',[userId])
    if(!user||user.account_disabled||Number(user.session_version??0)!==version)throw new UnauthorizedException('Session expired')
  }
  async preview(userId:string,query:ApprovalPreviewDto,sessionVersion=0){
    await this.session(userId,sessionVersion)
    const items=[]
    for(const id of query.orderIds){const {order,target}=await this.target(userId,query.queue,id);items.push({orderId:id,orderNumber:order.orderNumber,version:approvalVersion([target]),eligible:target.eligible,documents:[{id:target.id,number:target.number,status:target.status,eligible:target.eligible,reason:target.reason}]})}
    return {source:'mock',queue:query.queue,items}
  }
  private async authorization(manager:Pick<EntityManager,'query'>):Promise<string>{
    const accounts=await manager.query('SELECT id,role,business_role,workbench_roles,business_department_id,business_employee_id,organization_workspace_owner_id,data_display_scope,account_disabled,session_version FROM users ORDER BY id')
    const nodes=await manager.query('SELECT id,owner_user_id,parent_id,kind FROM organization_nodes ORDER BY id')
    const employees=await manager.query('SELECT id,owner_user_id,department_id,account_id,archived_at FROM organization_employees ORDER BY id')
    const bindings=await manager.query('SELECT id,connection_id,local_account_id,employee_master_id,person_record_id,employee_number,state,enabled,directory_verified_at FROM hz_fop_employee_bindings ORDER BY id')
    const grants=await manager.query('SELECT id,connection_id,company_id,resource_type,target_key,decision,grant_version FROM hz_fop_resource_grants ORDER BY id')
    const companies=await manager.query('SELECT co.id,co.active_dataset_id,co.enabled,co.scope_version,c.status FROM hz_fop_companies co JOIN hz_fop_connections c ON c.id=co.connection_id ORDER BY co.id')
    return hash([accounts,nodes,employees,bindings,grants,companies])
  }
  async submit(userId:string,query:ApprovalSubmitDto,sessionVersion=0):Promise<{source:'mock';requestId:string;items:ApprovalRowResult[];completedAt:string}>{
    await this.session(userId,sessionVersion)
    if(!query.items.length)throw new BadRequestException('Select at least one order')
    const fingerprint=hash(query),authorization=await this.authorization(this.db)
    const contexts:(Awaited<ReturnType<MockWorkbenchCapabilities['target']>>&{selected:ApprovalSubmitDto['items'][number]})[]=[]
    for(const item of query.items)contexts.push({...await this.target(userId,query.queue,item.orderId),selected:item})
    return this.db.transaction(async m=>{
      // The mock has one small dataset. Serialize mutations, including resets, before any row locks.
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['schema-mock-write'])
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${userId}:${query.requestId}`])
      for(const table of ['users','organization_nodes','organization_employees','hz_fop_employee_bindings','hz_fop_resource_grants','hz_fop_companies','hz_fop_connections'])await m.query(`SELECT id FROM ${table} ORDER BY id FOR SHARE`)
      if(authorization!==await this.authorization(m))throw new ForbiddenException('Current authorization or organization scope changed')
      const [replay]=await m.query('SELECT parameters_hash,actor_binding_snapshot FROM hz_fop_action_requests WHERE actor_account_id=$1 AND client_request_key=$2',[userId,query.requestId])
      if(replay){if(replay.parameters_hash!==fingerprint)throw new ConflictException('Request ID conflict');return replay.actor_binding_snapshot.result}
      const results:ApprovalRowResult[]=[]
      for(const context of contexts){
        const {order,document,target,selected}=context
        const [locked]=await m.query('SELECT raw_bill_status,source_version FROM hz_fop_source_documents WHERE id=$1 FOR UPDATE',[document.id])
        const [currentOrder]=await m.query("SELECT o.*,sd.source_version AS original_version FROM hz_fop_workbench_orders o JOIN hz_fop_source_documents sd ON sd.id=o.document_id WHERE sd.source_id=$1 AND sd.entity_code='hzkj_orders' AND sd.deleted_at IS NULL FOR UPDATE OF o,sd",[order.id])
        const dispatches:Row[]=query.queue==='allocation_review'?await m.query("SELECT ds.raw_bill_status FROM hz_fop_document_relations r JOIN hz_fop_source_documents ds ON ds.id=r.to_document_id WHERE r.from_document_id=$1 AND r.relation_type='dispatch' AND r.resolution_state='resolved' AND r.removed_at IS NULL AND ds.deleted_at IS NULL FOR SHARE OF r,ds",[currentOrder?.document_id]):[]
        const currentEligible=currentOrder&&currentOrder.customer_payment_state==='paid'&&!currentOrder.cancelled&&currentOrder.intercept_status!=='intercepted'&&currentOrder.original_version===context.originalVersion&&(query.queue==='review'?currentOrder.order_review_state==='pending':currentOrder.order_review_state==='approved'&&currentOrder.stock_readiness_state==='ready'&&currentOrder.allocation_review_state==='pending'&&currentOrder.outbound_state==='pending'&&dispatches.length>0&&dispatches.every(d=>d.raw_bill_status==='C'))
        let status:ApprovalStatus='blocked',message='单据版本或审核条件已变化，请刷新'
        if(locked.raw_bill_status==='C'){status='already_approved';message='已审核'}
        else if(locked.raw_bill_status==='B'&&target.eligible&&currentEligible&&approvalVersion([target])===selected.version&&locked.source_version===document.source_version){
          const [current]=await m.query('SELECT account_disabled,session_version FROM users WHERE id=$1 FOR SHARE',[userId]);if(!current||current.account_disabled||Number(current.session_version??0)!==sessionVersion)throw new UnauthorizedException('Session expired')
          await m.query("UPDATE hz_fop_source_documents SET raw_bill_status='C',source_audited_at=now(),source_modified_at=now(),source_version=source_version+1 WHERE id=$1",[document.id])
          const [original]=await m.query("SELECT id FROM hz_fop_source_documents WHERE entity_code='hzkj_orders' AND source_id=$1",[order.id])
          const field=query.queue==='review'?'order_review_state':'allocation_review_state',completed=query.queue==='review'?'sales_completed':'allocation_completed'
          await m.query(`UPDATE hz_fop_workbench_orders SET ${field}='approved',published_at=now(),projection_revision=projection_revision+1 WHERE document_id=$1`,[original.id])
          await m.query('UPDATE hz_fop_workbench_memberships SET classification_state=CASE WHEN queue_code=$2 THEN \'non_member\' WHEN queue_code=$3 THEN \'member\' ELSE classification_state END,phase_completed_at=CASE WHEN queue_code=$3 THEN now() ELSE phase_completed_at END,projection_revision=projection_revision+1,published_at=now() WHERE order_document_id=$1',[original.id,query.queue,completed])
          if(query.queue==='allocation_review')await m.query("UPDATE hz_fop_workbench_memberships SET classification_state='member' WHERE order_document_id=$1 AND queue_code='shipping'",[original.id])
          await m.query('UPDATE hz_fop_workbench_order_lines SET projection_revision=projection_revision+1 WHERE order_document_id=$1',[original.id])
          for(const table of ['hz_fop_workbench_procurement_demands','hz_fop_workbench_purchase_allocations','hz_fop_projection_dependencies'])await m.query(`UPDATE ${table} SET projection_revision=projection_revision+1 WHERE order_document_id=$1`,[original.id])
          await m.query("UPDATE hz_fop_datasets SET applied_watermarks=jsonb_set(applied_watermarks,'{_local,projectionRevision}',to_jsonb((COALESCE(applied_watermarks->'_local'->>'projectionRevision','0')::bigint+1)::text)) WHERE id=$1",[document.dataset_id])
          status='approved';message='模拟审核成功'
        }
        results.push({orderId:order.id,orderNumber:order.orderNumber,status,message,documents:[{id:target.id,number:target.number,status,message,warning:null}]})
      }
      const result={source:'mock' as const,requestId:query.requestId,items:results,completedAt:new Date().toISOString()},first=contexts[0].document
      await m.query(`INSERT INTO hz_fop_action_requests(id,connection_id,company_id,dataset_id,actor_account_id,operation,client_request_key,actor_binding_snapshot,authorization_version,parameters_hash,state,finished_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'mock-v1',$9,'succeeded',now())`,[randomUUID(),first.connection_id,first.company_id,first.dataset_id,userId,query.queue==='review'?'audit_fulfillment':'audit_allocation',query.requestId,JSON.stringify({source:'mock',result}),fingerprint])
      return result
    })
  }
}
