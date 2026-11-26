import { defaultCollectedCompany } from './collected-company-default'
import { orderDocumentType } from '../fop-data/order-document-type'
import { readInboundStockGroups } from './inbound-stock-groups'
import { readOrderProgress } from './order-progress'
import { purchaseLogisticsSupplier } from '../fop-data/purchase-logistics-supplier'
import { LocalFreightDetailsDto, localFreightDetailsQuery } from './local-freight-details'
import { timestampRuntimeStatus } from './timestamp-runtime-status'
import { deliveryNoticeWmsTime } from './delivery-notice-time'
import { receiptLogistics } from './receipt-logistics'
import { ExceptionPageCache } from './exception-page-cache'
import { NativeSupplierContacts } from '../fop-data/native-supplier-contact'
import type { FopSupplierContext } from '../fop-data/fop-realtime.types'
import { KingdeeFopDataProvider } from '../fop-data/fop-kingdee.provider'
import { inventoryPages, reservedInventoryRow, customerInventoryPages, inventoryMaterial } from '../fop-data/native-inventory'
import { persistedExceptionDisplaySql } from './persisted-exception-read'
import { stockExceptionDisplay, canViewUnassignedStockExceptions } from './collected-stock-exceptions'
import { usesReservedStock } from '../fop-data/procurement-demand'
import { withProcurementSources } from '../fop-data/stock-consumption-source'
import { withProcurementSourceDocuments } from './collected-procurement-source-documents'
import { stockProcurementContactLinks, type SupplierPurchaseLink } from './stock-procurement-contact-links'
import { purchaseMatchesSourceSku } from '../fop-data/collected-purchase-association'
import { collectedMaterialReturnsQuery } from './collected-material-returns'
import { withSourceOrderNumber } from '../fop-data/source-order-number'
import { collectedOrderNotes } from '../fop-data/collected-order-notes'
import { warehouseCodes } from './warehouse-codes'
import { comparisonWindows, comparisonStatement, comparisonMetrics } from './analytics-comparison'
import { collectedExceptionPage } from './collected-exception-page'
import { collectedDispatchPage } from './collected-dispatch-page'
import { customerRegistrationWindow, verifiedCustomerRegistrationScope } from '../fop-data/collected-customer-registration'
import { withCollectedOrderLogistics } from '../fop-data/collected-actual-channel'
import { logisticsInfoText } from '../fop-data/logistics-info'
import { withCollectedRmaDetails } from '../fop-data/collected-rma'
import { STOCK_BILL_STATUS_LABELS } from '../fop-data/fop-stock.types'
import { singleSheetWorkbook, exportRowIdentity, exportProductRow } from '../workbench-export/single-sheet'
import { collectedProductLines } from './collected-product-display'
import { collectedInboundPage } from './collected-inbound-query'
import { withOrderBusinessStatus } from '../fop-data/order-business-status'
import { businessStatusLabel } from '../fop-data/fulfillment-source-status'
import { collectedOrganizationQuery } from './collected-organization-query'
import { timestampStatus, publishedTimestampTime } from './timestamp-status'
import { collectedOrderMoney } from '../fop-data/collected-order-money'
import { resolveChartAccess } from '../users/chart-permissions'
import { readCollectedChain } from './collected-chain-query'
import { scopedPurchaseGroup } from '../fop-data/collected-native-facts'
import { collectedAllocationDisplay } from './collected-allocation-query'
import { BadRequestException, NotFoundException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException, PayloadTooLargeException, HttpException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import Decimal from 'decimal.js'
import { createHash } from 'node:crypto'
import { Workbook } from 'exceljs'
import { UsersService } from '../users/users.service'
import { businessScope } from '../users/business-scope'
import { effectiveWorkbenchRoles, WorkbenchRole } from '../users/workbench-role'
import { FULFILLMENT_QUEUE_ROLES } from '../users/dto/workbench.dto'
import { buildReplicaOrganization } from './local-workbench-organization'
import { localDepartments, localEmployeeFilter, localOwnership, localSalespeople } from '../fop-data/local-workbench-scope'
import { publicStoreNameDisplay } from '../fop-data/collected-store-name'
import { collectedRmaWhere } from './collected-rma-query'
import { collectedStockWhere } from './collected-stock-query'
import { collectedWhere } from './collected-workbench-query'
import { collectReplicaPages } from './collect-replica-pages'
import { analyticsWindow, collectedAnalyticsQuery, ANALYTICS_QUEUES } from './collected-analytics-query'
import { collectedAnalyticsScope } from './collected-analytics-scope'
import { dashboardAnalyticsQuery } from './dashboard-analytics-query'
import { managerDashboardScope, combineDashboardStatements, withDepartmentSummary } from './manager-dashboard-scope'
import { dimensions, aggregateLocalFreight, localFreightQuery, LocalFreightQueryDto } from './local-freight'
import { DashboardAnalyticsQueryDto, DashboardTrendQueryDto, DashboardTrendFocus, CollectedAnalyticsQueryDto } from './collected-analytics.dto'
type Row=Record<string,any>
type CollectedRow=Row & {items:Row[]}
type CollectedPage={items:CollectedRow[];total:number;page:number;pageSize:number;[key:string]:any}
const exactNumber=(value:unknown):number|null=>{if(value==null)return null;const n=Number(value);return Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER&&new Decimal(String(n)).eq(String(value))?n:null}
/** SKU consumption is aggregate evidence, never an allocation to the original fulfillment rows. */
function uncreatedPurchaseLines(display:Row,parent:Row):Row[]{
 const items:Row[]=display.items??[],byId=new Map(items.map(l=>[String(l.id),l]))
 const rawById=new Map<string,Row>((parent.hzkj_orders_billentry??[]).map((l:Row)=>[String(l.id),l]))
 const states=new Map<string,string>((display.businessStatus?.lines??[]).map((l:Row)=>[String(l.id),l.purchase]))
 const pending=(id:string)=>['unpurchased','purchasing'].includes(states.get(id)??'')
 const seen=new Set<string>(),result:Row[]=[]
 for(const item of items){
  const id=String(item.id),raw=rawById.get(id)??{},source=raw.procurementSource
  if(!pending(id)||usesReservedStock(raw))continue
  if(source?.lineIds?.length>1){
   const ids:string[]=source.lineIds.map(String),key=JSON.stringify(ids)
   if(seen.has(key))continue
   seen.add(key)
   // A mixed-stage SKU may include already purchased demand; its pending share is not known.
   const quantity=source.complete&&ids.every(lineId=>byId.has(lineId)&&pending(lineId))?exactNumber(source.directQuantity):null
   result.push({...item,id:undefined,skuId:source.skuId,quantity,fulfillmentLineId:null,fulfillmentLineIds:ids,skuAggregated:true,purchaseLineId:null,shippedQuantity:null})
  }else{
   const quantity=source?(source.complete?exactNumber(source.directQuantity):null):display.procurementSources?null:item.quantity
   result.push({...item,quantity,fulfillmentLineId:item.id,purchaseLineId:null,shippedQuantity:null})
  }
 }
 return result
}
const missingDatasets=['allocation','dispatch','procurement','stock_orders','rma','receipt_notices','inventory','interception']
const sourceCaptureFallback=(batch:Row)=>batch.metadata?.productionPreparation?.sourceCaptured===false?null:batch.source_as_of
const orderCaptureTime=(batch:Row)=>publishedTimestampTime(batch.metadata?.timestampSync,sourceCaptureFallback(batch),['hzkj_orders'])
@Injectable()
export class CollectedWorkbenchService {
 constructor(private readonly db:DataSource,private readonly users:UsersService,private readonly config:ConfigService){}
 get enabled(){return this.config.get<string>('WORKBENCH_COLLECTED_ENABLED')==='true'}
 private readonly inboundPages=new ExceptionPageCache<Row>(()=>Date.now(),30_000)
 private readonly procurementReads=new ExceptionPageCache<Row[]>(()=>Date.now(),30_000)
 private readonly warehouseReads=new ExceptionPageCache<Row[]>(()=>Date.now(),30_000)
 private readonly salesReads=new ExceptionPageCache<Row[]>(()=>Date.now(),30_000)
 private readonly exceptionPages=new ExceptionPageCache<Row>(()=>Date.now(),30_000)
 private readonly analyticsTrendReads=new ExceptionPageCache<Row[]>(()=>Date.now(),30_000,64)
 private nativeInventory?: KingdeeFopDataProvider
 private nativeSupplier?: KingdeeFopDataProvider
 async supplierContacts(userId:string,query:FopSupplierContext,launch?:{contactVersion:string;purchaseOrderId?:string}):Promise<any>{
  const role:WorkbenchRole=query.context==='purchase_return'?query.workbenchRole:'procurement'
  const filters=query.context==='purchase_group'?query.filters:{}
  const c=await this.context(userId,role,filters)
  if(this.config.get('FOP_MANUAL_SUPPLIER_CONTACT_ENABLED')!=='true')throw new ServiceUnavailableException({code:'fop_supplier_contacts_not_configured',message:'供应商联系人查询尚未启用'})
  const orgNumber=this.config.get<string>('FOP_KINGDEE_SUPPLIER_ORG_NUMBER')
  if(!orgNumber)throw new ServiceUnavailableException('Supplier company is not configured')
  this.nativeSupplier??=new KingdeeFopDataProvider(this.config)
  const reader=new NativeSupplierContacts((kind,body)=>this.nativeSupplier!.queryManualSupplierSource(kind,body),c.batch.company_id,orgNumber)
  let orderId:string,orderNumber:string,items:Row[]
  try {
  // Authorize the root in the local replica before any source lookup; callers never supply a 1688 ID.
  if(query.context==='purchase_return'){
   const orders:Row[]=await this.db.query('SELECT display FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id=$2 AND ($3::text[] IS NULL OR owner_employee_id=ANY($3::text[]))',[c.batch.id,query.orderId,c.filter.employeeIds])
   if(orders.length!==1)throw new NotFoundException('Order outside current scope')
   orderId=query.orderId;orderNumber=orders[0].display.orderNumber
   const returns:Row[]=await this.db.query("SELECT display FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='purchase_material_return' AND source_id=$2",[c.batch.id,query.returnId])
   const d=returns[0]?.display,lines=(d?.lines??[]).filter((l:Row)=>l.orderNumber===orderNumber)
   if(returns.length!==1||!lines.length)throw new NotFoundException('Return does not belong to this order')
   items=await reader.returned({...d,lines},orderNumber)
  }else if(query.context==='purchase_group'){
   if(query.filters.queue!=='procurement_shipping')throw new BadRequestException('Follow-up requires pending supplier shipment')
   const page=await this.purchaseGroups(userId,query.filters,query.groupId)
   const purchase=page.group?.purchase,sourceOrder=page.items?.[0]
   if(!purchase||!sourceOrder)throw new NotFoundException('Purchase not in current queue')
   orderId=query.groupId;orderNumber=purchase.number
   items=[await reader.purchase(purchase,sourceOrder.orderNumber)]
  }else if(query.context==='fulfillment'){
   const q=collectedWhere(c.batch.id,c.filter.employeeIds,{queue:'procurement_shipping'})
   const orders:Row[]=await this.db.query(`SELECT source_id,display,raw FROM hz_fop_collected_orders WHERE ${q.where} AND source_id=$${q.params.length+1}`,[...q.params,query.orderId])
   if(orders.length!==1)throw new NotFoundException('Order not in current queue')
   orderId=query.orderId;orderNumber=orders[0].display.orderNumber
   const groups:Row[]=await this.db.query("SELECT display,raw FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='purchase' AND display->>'stage' IN ('supplier_pending','supplier_partial') AND display->'association'->>'state'='verified' AND EXISTS(SELECT 1 FROM jsonb_array_elements(display->'rows') r WHERE r->>'orderId'=$2)",[c.batch.id,orderId])
   const parent=orders[0].raw??{id:orderId,billno:orderNumber},products:Row[]=orders[0].display.items??[]
   const sources:Row[]=products.map(item=>item.procurementSource).filter(Boolean)
   const links:SupplierPurchaseLink[]=groups.flatMap(g=>{
    const direct=sources.filter(s=>Number(s.directQuantity)>0&&(g.raw?.hzkj_billentry??[]).some((line:Row)=>purchaseMatchesSourceSku(line,parent,s.skuId)))
    // Once quantities are known, fully stocked SKUs cannot select an unrelated direct purchase.
    if(sources.length&&!direct.length)return []
    return [{purchase:g.display.purchase,shipmentStatus:g.display.stage==='supplier_partial'?'partial':'pending',references:direct.length?direct.map(s=>({sourceType:'direct' as const,parent,skuId:s.skuId,sku:s.sku})): [{sourceType:'direct' as const,parent}]}]
   })
   links.push(...await stockProcurementContactLinks(this.db,{id:c.batch.id,company_id:c.batch.company_id},parent,products))
   const purchases=new Map<string,SupplierPurchaseLink>()
   for(const link of links){const prior=purchases.get(link.purchase.id);if(prior){
    if(prior.purchase.number!==link.purchase.number||prior.purchase.platformOrderNumber!==link.purchase.platformOrderNumber)throw new ConflictException('采购关联已变化，请刷新后重试')
    prior.references.push(...link.references)
   }else purchases.set(link.purchase.id,link)}
   if(purchases.size>10)throw new BadRequestException('关联采购单较多，请在 FOP 逐单联系供应商')
   items=[];for(const link of purchases.values()){
    const contact=await reader.purchaseSources(link.purchase,link.references)
    items.push({...contact,shipmentStatus:link.shipmentStatus,contactVersion:createHash('sha256').update(JSON.stringify([orderId,contact.contactVersion])).digest('hex')})
   }
  }else throw new ServiceUnavailableException({code:'fop_supplier_contacts_not_configured',message:'备货采购联系人关联待接入'})
  if((await this.context(userId,role,filters)).signature!==c.signature)throw new ConflictException('权限或数据已变化，请刷新后重试')
  if(launch){
   const matches=items.filter(i=>i.contactVersion===launch.contactVersion&&(!launch.purchaseOrderId||i.purchaseOrderId===launch.purchaseOrderId))
   if(matches.length!==1)throw new ConflictException('供应商信息已变化，请刷新后重新选择')
   const contact=matches[0];if(contact.availability!=='ready'||!contact.url)throw new ConflictException('旺旺账号尚未提供，请在 FOP 核对采购单')
   return {source:'fop',mode:'live',orderId,purchaseOrderId:contact.purchaseOrderId,wangwangAccount:contact.supplier.wangwangAccount,url:contact.url}
  }
  return {source:'fop',orderId,orderNumber,refreshedAt:new Date().toISOString(),items:items.map(({url,...item})=>item)}
  } catch(error) {
   if(error instanceof HttpException)throw error
   throw new ServiceUnavailableException({code:'supplier_contact_unverified',message:'暂未核实采购单与供应商联系人，请刷新重试；若仍失败，请在 FOP 检查原采购单、1688单号及旺旺账号。'})
  }
 }
 async inventory(userId:string,query:Row,kind:'reserved'|'current'){
  const role:WorkbenchRole=kind==='current'?(query.queue==='shipping'?'warehouse':'allocation'):(query.queue==='procurement'?'procurement':'sales')
  const c=await this.context(userId,role,query)
  if(this.config.get('FOP_MANUAL_INVENTORY_ENABLED')!=='true')throw new ServiceUnavailableException({code:'fop_feature_not_configured',message:'库存查询暂不可用'})
  const members=c.org.members.filter(m=>c.filter.employeeIds===null||c.filter.employeeIds.includes(m.employeeId))
  const allowedUsers=members.filter(m=>m.fopUserId&&c.org.members.filter(x=>x.fopUserId===m.fopUserId).length===1).map(m=>m.fopUserId)
  const customerRows:Row[]=await this.db.query("SELECT source_id FROM hz_fop_collected_customer_registrations WHERE batch_id=$1 AND company_id=$2 AND source_owner_user_id=ANY($3::text[])",[c.batch.id,c.batch.company_id,allowedUsers])
  const customers=new Set(customerRows.map(r=>r.source_id))
  let selected:Row[]|undefined
  if(query.orderIds){
   const table=kind==='reserved'?"hz_fop_collected_entities":"hz_fop_collected_orders"
   selected=await this.db.query(`SELECT source_id,display,raw FROM ${table} WHERE batch_id=$1 AND source_id=ANY($2::text[]) AND ($3::text[] IS NULL OR owner_employee_id=ANY($3::text[])) ${kind==='reserved'?"AND entity_type='stock_orders'":''}`,[c.batch.id,query.orderIds,c.filter.employeeIds])
   if(selected?.length!==query.orderIds.length)throw new ForbiddenException('Inventory selection outside current scope')
  }
  if(query.customerId&&!customers.has(query.customerId))throw new ForbiddenException('Customer outside current scope')
  this.nativeInventory??=new KingdeeFopDataProvider(this.config)
  let requests=0
  const read=(k:'reserved'|'current',body:unknown)=>{if(++requests>20)throw new BadRequestException({code:'fop_inventory_result_too_large',message:'请缩小库存查询范围'});return this.nativeInventory!.queryManualInventory(k,body)}
  const orgNumber=this.config.get<string>('FOP_KINGDEE_INVENTORY_ORG_NUMBER')
  if(!orgNumber)throw new ServiceUnavailableException('Inventory company is not configured')
  let items:Row[]
  try{
   if(kind==='reserved'){
    const pairs=selected?new Set(selected.flatMap(r=>(r.display.items??[]).map((l:Row)=>JSON.stringify([r.display.customerId,l.sku])))):null
    // The published API requires a customer. Resolve that scope locally before any FOP request.
    const requestedCustomers=query.customerId?[query.customerId]:selected?[...new Set(selected.map(r=>r.display.customerId))].filter(id=>customers.has(id)):[...customers]
    if(requestedCustomers.length>20)throw new BadRequestException({code:'fop_inventory_scope_required',message:'请选择客户或勾选备货订单后查询库存'})
    const raw:Row[]=[],seen=new Set<string>()
    for(const customerId of requestedCustomers){
     const rows=await inventoryPages(read,kind,c.batch.company_id,orgNumber,{hzkj_customer_id:customerId})
     if(rows.some(r=>r.hzkj_customer_id!==customerId))throw new ServiceUnavailableException({code:'fop_inventory_filter_unverified',message:'库存查询的客户范围未能核实，请稍后重试'})
     for(const row of rows){if(seen.has(row.id))throw Error('Duplicate inventory across customers');seen.add(row.id);raw.push(row)}
    }
    items=raw.filter(r=>r.status==='C'&&customers.has(r.hzkj_customer_id)).map(reservedInventoryRow).filter(r=>(!pairs||pairs.has(JSON.stringify([r.customerId,r.sku])))&&(!query.customerId||r.customerId===query.customerId)&&(!query.search||[r.sku,r.name].some(v=>v.toLowerCase().includes(query.search.toLowerCase())))&&(!query.customerSearch||[r.customerName,r.customerCode].some(v=>v.toLowerCase().includes(query.customerSearch.toLowerCase()))))
   }else{
    if(query.mode==='selected'&&!selected?.length||query.mode==='search'&&!query.search?.trim())throw new BadRequestException('SKU or selected orders required')
    const skus=new Map<string,{sku:string;name:string;code:string}>()
    const lines:Row[]=selected?selected.flatMap(r=>r.raw.hzkj_orders_billentry??[]):(await this.db.query("SELECT DISTINCT l AS entry FROM hz_fop_collected_orders CROSS JOIN LATERAL jsonb_array_elements(coalesce(raw->'hzkj_orders_billentry','[]'::jsonb)) l WHERE batch_id=$1 AND ($2::text[] IS NULL OR owner_employee_id=ANY($2::text[])) AND position(lower($3) in lower(coalesce(l->'hzkj_local_sku'->>'number',l->>'hzkj_local_sku_number')))>0 LIMIT 101",[c.batch.id,c.filter.employeeIds,query.search.trim()])).map((r:Row)=>r.entry)
    if(!selected&&lines.length>100)throw new BadRequestException({code:'fop_inventory_result_too_large',message:'请减少所选商品后查询库存'})
    for(const line of lines){
     let material:ReturnType<typeof inventoryMaterial>
     try{material=inventoryMaterial(line)}catch{throw new ServiceUnavailableException({code:'fop_inventory_material_missing',message:'所选商品的库存信息暂不可查询，请联系管理员'})}
     if(skus.has(material.id)&&skus.get(material.id)!.sku!==material.sku)throw Error('Ambiguous material mapping')
     const code=line.hzkj_material?.number??line.hzkj_material_number??line.hzkj_local_sku?.hzkj_material?.number
     if(typeof code!=='string'||!code.trim())throw new ServiceUnavailableException({code:'fop_inventory_material_missing',message:'所选商品的库存信息暂不可查询，请联系管理员'})
     skus.set(material.id,{...material,code})
    }
    if(skus.size>20)throw new BadRequestException({code:'fop_inventory_result_too_large',message:'请减少所选商品后查询库存'})
    items=[]
    for(const [id,sku] of skus){
     // New API omits customer/company IDs; retain the existing restricted-reader guard.
     if(c.filter.employeeIds!==null)throw new ServiceUnavailableException({code:'fop_inventory_scope_unavailable',message:'暂时无法核实库存查看范围，请联系管理员'})
     const rows=await customerInventoryPages(read,sku.code)
     items.push(...rows.map(r=>({...r,sku:sku.sku,name:sku.name})))
    }
   }
  }catch(error){
   if(error instanceof HttpException)throw error
   const upstreamCode=(error as {code?:string})?.code
   const code=upstreamCode==='fop_endpoint_not_published'?'fop_inventory_endpoint_unavailable':upstreamCode==='fop_api_not_authorized'?'fop_inventory_api_not_authorized':'fop_inventory_unavailable'
   throw new ServiceUnavailableException({code,message:'库存查询暂不可用，请联系管理员'})
  }
  const latest=await this.context(userId,role,query)
  if(latest.signature!==c.signature)throw new ForbiddenException('Inventory permission changed')
  if(kind==='reserved'){
   const current=await this.db.query("SELECT source_id FROM hz_fop_collected_customer_registrations WHERE batch_id=$1 AND company_id=$2 AND source_owner_user_id=ANY($3::text[])",[c.batch.id,c.batch.company_id,allowedUsers])
   const ids=new Set(current.map((r:Row)=>r.source_id));items=items.filter(r=>ids.has(r.customerId))
  }
  if(kind==='current'&&query.warehouseCode)throw new ServiceUnavailableException({code:'fop_inventory_scope_unavailable',message:'暂时无法核实仓库筛选范围，请联系管理员'})
  if(query.warehouseCode)items=items.filter(r=>warehouseCodes(query.warehouseCode).includes(r.warehouseCode))
  items.sort((a,b)=>String(a.customerId??'').localeCompare(String(b.customerId??''))||a.sku.localeCompare(b.sku)||String(a.warehouseCode??a.warehouse??'').localeCompare(String(b.warehouseCode??b.warehouse??''))||a.id.localeCompare(b.id))
  const page=query.page??1,pageSize=query.pageSize??50,asOf=new Date().toISOString()
  return {items:items.slice((page-1)*pageSize,page*pageSize),total:items.length,page,pageSize,source:'fop',asOf,refreshedAt:asOf,customerId:query.customerId??null}
 }
 private listReader(userId:string,role:WorkbenchRole,c:Awaited<ReturnType<CollectedWorkbenchService['context']>>,query:Row){
  const cache=role==='warehouse'?this.warehouseReads:role==='procurement'?this.procurementReads:this.salesReads
  return {query:(sql:string,params:any[]=[])=>cache.read(JSON.stringify([role,userId,c.signature,sql,params]),()=>this.db.query(sql,params),query.refresh===true)}
 }
 private async productDisplay<T extends Row>(batchId:string,records:T[],field='items',reader:{query:(sql:string,params:any[])=>Promise<Row[]>}=this.db):Promise<T[]>{
  const sets=await collectedProductLines(reader,batchId,records.map(record=>record[field]??[]))
  return records.map((record,index)=>({...publicStoreNameDisplay(record),[field]:sets[index]}))
 }
 private async context(userId:string,role?:WorkbenchRole,query:Row={},managerAnalytics=false){
  const user=await this.users.findById(userId)
  if(!user||user.accountDisabled)throw new UnauthorizedException()
  const business=businessScope(user)
  if(business.role==='none')throw new ForbiddenException()
  const roles=effectiveWorkbenchRoles(user)
  if(role&&!roles.includes(role))throw new ForbiddenException('Workbench access denied')
  const linked:Row[]=await this.db.query('SELECT owner_user_id,archived_at FROM organization_employees WHERE account_id=$1 LIMIT 2',[userId])
  if(linked.length>1||linked[0]?.archived_at||linked[0]&&user.organizationWorkspaceOwnerId&&linked[0].owner_user_id!==user.organizationWorkspaceOwnerId)throw new ForbiddenException('Invalid local organization assignment')
  const owner=linked[0]?.owner_user_id??user.organizationWorkspaceOwnerId??(user.role==='admin'?user.id:null)
  if(!owner)throw new ForbiddenException('Local organization required')
  const tenant=this.config.get<string>('FOP_REPLICA_TENANT_ID'),company=this.config.get<string>('FOP_REPLICA_COMPANY_ID')
  if(!tenant||!company)throw new ServiceUnavailableException('Collected source scope is not configured')
  const batches:Row[]=await this.db.query("SELECT *,coalesce((SELECT revision FROM hz_fop_exception_versions v WHERE v.batch_id=hz_fop_collected_batches.id),0) AS exception_data_revision FROM hz_fop_collected_batches WHERE workspace_owner_id=$1 AND tenant_id=$2 AND company_id=$3 AND state='active'",[owner,tenant,company])
  if(batches.length!==1)throw new ServiceUnavailableException({code:'workbench_collected_not_initialized',message:'尚无完成入库的 API 采集批次'})
  if(batches[0].metadata?.timestampOwnershipPending&&user.role!=='admin')throw new ServiceUnavailableException({code:'timestamp_ownership_projection_pending',message:'关联归属投影待重算，暂不能按旧归属读取；管理员可核查同步任务。'})
  const nodes=await this.db.query('SELECT id,parent_id,name,kind FROM organization_nodes WHERE owner_user_id=$1 ORDER BY id',[owner])
  const employees=await this.db.query(collectedOrganizationQuery,[owner,tenant,company])
  const org=buildReplicaOrganization(user,owner,nodes,employees,{tenant_id:tenant,source_company_id:company},{managerAnalytics})
  const filter=localEmployeeFilter(org,org.analyticsPeers?{ownerId:query.ownerId}:query),batch=defaultCollectedCompany(batches[0])
  const signature=JSON.stringify([user.sessionVersion,user.role,user.dataDisplayScope,roles,org.version,org.employeeIds,filter.employeeIds,user.chartPermissions,batch.id,batch.source_as_of,batch.metadata?.moneyCaptureUpdatedAt,batch.exception_data_revision,batch.metadata?.entityCaptures,batch.metadata?.analyticsCaptures,batch.metadata?.timestampSync,batch.metadata?.businessStatusProjection,batch.metadata?.manualApprovalReadbackAt,batch.metadata?.receiptSupplement])
  return {user,org,filter,batch,signature,searchOwnerIds:org.members.filter(m=>query.search?.trim()&&m.name.toLowerCase().includes(query.search.trim().toLowerCase())).map(m=>m.employeeId)}
 }
 private metadata(batch:Row,unavailable=false){const timestamp=timestampStatus(batch.metadata?.timestampSync);const revision=batch.id+':'+createHash('sha256').update(JSON.stringify([batch.exception_data_revision,batch.metadata?.entityCaptures??{},batch.metadata?.moneyCaptureUpdatedAt??null,batch.metadata?.timestampSync??null,batch.metadata?.businessStatusProjection,batch.metadata?.manualApprovalReadbackAt??null])).digest('hex').slice(0,16);const missing=missingDatasets.filter(x=>!batch.metadata?.entityCaptures?.[x]);return {
  source:'fop',refreshedAt:new Date().toISOString(),
  replica:{readMode:'local',datasetId:batch.id,revision,sourceSyncedAt:orderCaptureTime(batch),dataMode:'collected',complete:false,missingDatasets:missing,...timestamp?{timestampSync:timestamp}:{}},
  dataAvailability:{mode:'collected',complete:false,...(unavailable?{missingDatasets:missing}:{}),reason:batch.metadata?.productionPreparation?.sourceCaptured===false&&orderCaptureTime(batch)===null?'生产查询库已准备，尚未完成来源数据初始化；空白不代表业务零。':unavailable?'此数据集尚未接入，暂时留空；不代表没有业务数据。':timestamp?.projectionPending?'时间增量事实已入库，关联展示投影待完成；有关联快照的工作台仍展示原采集批次，不能视为已刷新到增量水位。':'已采集 API 数据已入本地库；缺失字段留空，下游状态待核查。'},
 }}
 async status(userId:string){
  const c=await this.context(userId),count=await this.db.query(`SELECT count(*)::int AS total FROM hz_fop_collected_orders WHERE batch_id=$1${c.filter.employeeIds===null?'':' AND owner_employee_id = ANY($2::text[])'}`,c.filter.employeeIds===null?[c.batch.id]:[c.batch.id,c.filter.employeeIds])
  return {...this.metadata(c.batch),initialized:orderCaptureTime(c.batch)!==null,state:'collected',dataMode:'collected',readMode:'local',...timestampRuntimeStatus(key=>this.config.get<string>(key),c.batch.metadata?.timestampSchedule),sourceSyncedAt:publishedTimestampTime(c.batch.metadata?.timestampSync,sourceCaptureFallback(c.batch),['hzkj_orders','hzkj_alloc_bill','hzkj_deliver_bill','hzkj_deliver_order']),datasetId:c.batch.id,revision:this.metadata(c.batch).replica.revision,collected:{batchId:c.batch.id,sourceAsOf:orderCaptureTime(c.batch),rowCount:count[0].total,pageCount:c.batch.page_count,missingDatasets:this.metadata(c.batch).replica.missingDatasets}}
 }
 async analyticsCacheScope(userId:string){
  // Do not enable chart timers for remote providers or revive suspended FOP calls.
  if(!this.enabled||this.config.get<string>('WORKBENCH_READ_MODE')!=='local')return {cacheable:false}
  const c=await this.context(userId)
  const version=createHash('sha256').update(JSON.stringify(['manager-chart-grants-v2',c.user.id,c.user.sessionVersion,c.user.dataDisplayScope,effectiveWorkbenchRoles(c.user),c.org.version,c.user.chartPermissions,c.batch.id,c.batch.source_as_of,c.batch.metadata?.analyticsCaptures,c.batch.metadata?.entityCaptures,c.batch.metadata?.moneyCaptureUpdatedAt,c.batch.metadata?.timestampSync,c.batch.metadata?.businessStatusProjection,c.batch.metadata?.manualApprovalReadbackAt])).digest('hex')
  return {cacheable:true,version}
 }
 async freightAnalytics(userId:string,query:LocalFreightQueryDto):Promise<Row>{
  if(!this.enabled||this.config.get<string>('WORKBENCH_READ_MODE')!=='local')throw new ServiceUnavailableException('Local freight is not enabled')
  const c=await this.context(userId,undefined,query)
  const scope=collectedAnalyticsScope(c.user,c.org,query,'freight')
  const access=resolveChartAccess(c.user).find(p=>p.chartId==='freight')
  if(!access?.visible)throw new ForbiddenException('Freight access denied')
  const capture=c.batch.metadata?.analyticsCaptures?.dispatch
  if(capture?.nativeOwnership!==true||capture.companyId!==c.batch.company_id||!Number.isFinite(Date.parse(capture.capturedAt)))throw new ServiceUnavailableException('Freight data is not ready')
  const employeeIds=scope.employeeIds??c.org.members.map(m=>m.employeeId)
  const statement=localFreightQuery(c.batch.id,c.batch.company_id,employeeIds,query)
  const [result]=await this.db.query(statement.sql,statement.params)
  if((await this.context(userId,undefined,query)).signature!==c.signature)throw new ConflictException('Permission or data changed; reload')
  if(!result)throw new ServiceUnavailableException('Freight aggregate unavailable')
  const members=c.org.members.map(m=>({...m,departmentName:c.org.departments.find(d=>d.id===m.departmentId)?.name}))
  const aggregates=query.allDimensions?Object.fromEntries(dimensions.map(d=>[d,aggregateLocalFreight(result.buckets.filter((b:{dimension:string})=>b.dimension===d),{...query,dimension:d},undefined,members)])):undefined
  const current=aggregates?.[query.dimension??'carrier']??aggregateLocalFreight(result.buckets,query,undefined,members)
  return {...current,...(aggregates?{dimensionSeries:Object.fromEntries(Object.entries(aggregates).map(([d,a])=>[d,{series:a.series,departmentSeries:a.departmentSeries}]))}:{}),asOf:capture.capturedAt,
   quality:{missingCurrencyCount:result.missing_currency,missingDateCount:result.missing_date},
   currencies:result.currencies,warehouses:result.warehouses,warehouseOptions:result.warehouse_options,chartAccess:{...access,canViewDetails:(query.currency??'CNY')==='CNY',canExport:(query.currency??'CNY')==='CNY'},
   canViewDetails:(query.currency??'CNY')==='CNY',canExport:(query.currency??'CNY')==='CNY'}
 }
 async freightDetails(userId:string,query:LocalFreightDetailsDto,exportAll=false):Promise<Row>{
  if(!this.enabled||this.config.get<string>('WORKBENCH_READ_MODE')!=='local')throw new ServiceUnavailableException('Local freight is not enabled')
  const c=await this.context(userId,undefined,query)
  const scope=collectedAnalyticsScope(c.user,c.org,query,'freight')
  const access=resolveChartAccess(c.user).find(p=>p.chartId==='freight')
  if(!access?.visible)throw new ForbiddenException('Freight access denied')
  const capture=c.batch.metadata?.analyticsCaptures?.dispatch
  if(capture?.nativeOwnership!==true||capture.companyId!==c.batch.company_id||!Number.isFinite(Date.parse(capture.capturedAt)))throw new ServiceUnavailableException('Freight data is not ready')
  let excludedIds:string[]|undefined
  if(query.dimensionId==='__others'){
   const chart=await this.freightAnalytics(userId,{...query,allDimensions:false})
   if(!chart.series.some((s:Row)=>s.id==='__others'))throw new BadRequestException('Other groups are not present in this scope')
   excludedIds=chart.series.filter((s:Row)=>s.id!=='__others').map((s:Row)=>s.id)
  }
  const statement=localFreightDetailsQuery(c.batch.id,c.batch.company_id,scope.employeeIds??c.org.members.map(m=>m.employeeId),query,undefined,excludedIds,exportAll)
  const [result]=await this.db.query(statement.sql,statement.params)
  if((await this.context(userId,undefined,query)).signature!==c.signature)throw new ConflictException('Permission or data changed; reload')
  if(!result)throw new ServiceUnavailableException('Freight details unavailable')
  if(exportAll&&result.total>10000)throw new PayloadTooLargeException('单次最多导出 10,000 笔发运单，请缩小筛选范围')
  return {...result,source:'local',currency:'CNY',asOf:capture.capturedAt,from:statement.from,to:statement.to,page:statement.page,pageSize:statement.pageSize,canExport:true,...(exportAll?{signature:c.signature}:{})}
 }
 async exportFreightDetails(userId:string,query:LocalFreightDetailsDto):Promise<Buffer>{
  const result=await this.freightDetails(userId,query,true)
  const wb=new Workbook(),sheet=wb.addWorksheet('运费发运单明细')
  const columns=[['发运单号','documentNumber',26],['来源ID','id',24],['运费确认时间 UTC+8','confirmedAt',26],['实际运费','amount',24],['币种','currency',10],['有效计费重量 kg','weightKg',24],['原生履约单号','orderNumber',26],['物流跟踪号','trackingNumber',28],['物流服务商','carrierName',26],['物流渠道','channelName',32],['业务员','ownerName',22],['原生业务部门','departmentName',22],['国家','country',16],['仓库','warehouseName',22],['客户','customerName',28]]
  sheet.columns=columns.map(([header,key,width])=>({header:String(header),key:String(key),width:Number(width)}))
  sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true}
  for(const row of result.items)sheet.addRow({...row,confirmedAt:new Date(Date.parse(row.confirmedAt)+8*3600_000).toISOString().slice(0,19).replace('T',' ')})
  sheet.addRow({documentNumber:`合计 · ${result.total} 张发运单`,amount:result.amount,currency:'CNY'})
  const notes=wb.addWorksheet('说明');notes.addRows([['范围',`${result.from} — ${result.to}`],['采集时间',result.asOf],['口径','当前权限内已审核且实际运费为正、币种及确认时间明确的本地发运单；金额和重量以精确文本保留。'],['缺口','商品明细、成本退款及完整源单追溯待提供；原生履约单号不代表关联已核验，空值表示未提供。']])
  const buffer=Buffer.from(await wb.xlsx.writeBuffer())
  if((await this.context(userId,undefined,query)).signature!==result.signature)throw new ConflictException('Permission or data changed; reload')
  return buffer
 }
 async dashboardShell(userId:string):Promise<Row>{
  if(!this.enabled)throw new ServiceUnavailableException('Local collected mode is not enabled')
  const c=await this.context(userId)
  const chartAccess=resolveChartAccess(c.user)
  const registrationWindow=chartAccess.some(chart=>chart.chartId==='registrations'&&chart.visible)
   ?customerRegistrationWindow(c.batch.metadata?.analyticsCaptures?.registrations,{companyId:c.batch.company_id,tenantId:c.batch.tenant_id}):undefined
  if((await this.context(userId)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  const queues={review:null,dispatch:null,procurement:null,allocation:null,shipping:null}
  return {source:'fop',updatedAt:orderCaptureTime(c.batch),analyticsConfigured:false,localAnalytics:true,chartAccess,registrationWindow,
   queues,queueStates:Object.fromEntries(Object.keys(queues).map(key=>[key,'not_configured'])),tasks:[],integratedQueues:[],
   rates:[],registrations:[],registrationDepartments:[],exceptions:[],
   receipts:{currency:'USD',months:[],departments:[]},departmentReceipts:{currency:'USD',months:[],departments:[]},
   dataAvailability:{mode:'collected',complete:false,reason:'Dashboard按本地订单事实查询，业绩采用订单金额；来源缺失保留空状态。'}}
 }
 async dashboardTrend(userId:string,query:DashboardTrendQueryDto):Promise<Row>{
  const {dimension,id,grain,...base}=query
  if(base.comparison||base.ownerId)throw new BadRequestException('Trend uses one selected period and chart scope')
  const money=['department_receipts','salesperson_receipts'].includes(query.chartId)
  const result=await this.dashboardAnalytics(userId,{...base,...money?{currency:'USD'}:{}},{dimension,id,grain})
  return {source:'local',chartId:query.chartId,dimension,id,grain,from:query.from,to:query.to,asOf:result.asOf,timeBasis:result.timeBasis,summaryOnly:result.summaryOnly,
   orderCount:result.orderCount,registrationCount:result.registrationCount,totalQuantity:result.totalQuantity,
   currency:money?'USD':null,amount:money?(result.missingAmountCount?null:result.amountsByCurrency?.find((r:Row)=>r.currency==='USD')?.amount??'0'):null,
   missingAmountCount:result.missingAmountCount??0,missingPaidAtCount:result.missingPaidAtCount??0,
   points:(result.rows??[]).map((r:Row)=>({period:r.id,orderCount:r.orderCount,registrationCount:r.registrationCount,quantity:r.quantity,amount:r.amount}))}
 }
 async dashboardAnalytics(userId:string,query:DashboardAnalyticsQueryDto,trend?:DashboardTrendFocus):Promise<Row>{
  if(!this.enabled)throw new ServiceUnavailableException('Local analytics is not enabled')
  let window=analyticsWindow(query);const c=await this.context(userId,undefined,query,true)
  const access=resolveChartAccess(c.user).find(p=>p.chartId===query.chartId)
  if(!access?.visible)throw new ForbiddenException('Chart access denied')
  const manager=managerDashboardScope(c.user,c.org,query,query.chartId)
  const scope=manager??collectedAnalyticsScope(c.user,c.org,query,query.chartId)
  if(manager&&query.chartId==='department_receipts')scope.summaryOnly=true
  if(trend){
   const supported:Record<string,string[]>={registrations:['department','person'],department_receipts:['department'],salesperson_receipts:['department','person'],order_volume:['department','person','country','warehouse'],customer_orders:['department','person','customer']}
   if(!supported[query.chartId]?.includes(trend.dimension)||!['day','month'].includes(trend.grain)||!trend.id||trend.id.length>128)throw new BadRequestException('Unsupported trend dimension')
   if(scope.summaryOnly&&!['department','country','warehouse'].includes(trend.dimension))throw new ForbiddenException('Department trend aggregates only')
   const ids=manager&&trend.dimension==='department'?manager.summaryEmployeeIds:scope.employeeIds
   const members=(manager?.directory??c.org).members.filter(m=>ids===null||ids.includes(m.employeeId))
   if(trend.dimension==='person'&&!members.some(m=>m.employeeId===trend.id)||trend.dimension==='department'&&!members.some(m=>m.departmentId===trend.id))throw new ForbiddenException('Trend target is outside the chart scope')
  }
  const registrations=query.chartId==='registrations'
  if(registrations&&(query.warehouseCode||query.currency||query.entityType))throw new BadRequestException('Registration analytics does not use order, warehouse or currency filters')
  const entity=registrations?'registrations':query.entityType??'fulfillment',capture=c.batch.metadata?.analyticsCaptures?.[entity]
  if(capture?.companyId!==c.batch.company_id||capture.coverage!==(registrations?'company_creation_window':'full_company_scan')||!Number.isFinite(Date.parse(capture.capturedAt)))throw new ServiceUnavailableException({code:'local_analytics_capture_unavailable',message:registrations?'客户档案尚未完成本地采集，注册统计暂时留空。':'Local analytics capture is unavailable'})
  if(registrations&&(!verifiedCustomerRegistrationScope(capture.scopeProof,{companyId:c.batch.company_id,tenantId:c.batch.tenant_id})||capture.connectionProof?.basis!=='authenticated_connection_context'||capture.connectionProof.tenantId!==c.batch.tenant_id||capture.connectionProof.companyId!==c.batch.company_id||!capture.connectionProof.userId))throw new ServiceUnavailableException({code:'local_analytics_capture_unavailable',message:'客户档案采集范围尚未核验，注册统计暂时留空。'})
  const periods=query.comparison?comparisonWindows(query.comparison,query.to,capture.capturedAt):undefined
  if(periods)window=periods.current
  if(registrations&&(!Number.isFinite(Date.parse(capture.start))||!Number.isFinite(Date.parse(capture.end))||Date.parse(capture.start)>Date.parse(window.start)||Date.parse(capture.end)<Date.parse(window.end)))throw new ServiceUnavailableException({code:'registration_window_not_captured',message:'Local registration capture does not cover the requested creation-time window'})
  const directory=manager?.directory??c.org
  const members=directory.members.map(m=>({...m,departmentName:directory.departments.find(d=>d.id===m.departmentId)?.name}))
  const previousCovered=!!periods&&periods.previous.from>='2026-01-01'&&(!registrations||(Date.parse(capture.start)<=Date.parse(periods.previous.start)&&Date.parse(capture.end)>=Date.parse(periods.previous.end)))
  const aggregate=(period:{start:string;end:string},summary=false)=>dashboardAnalyticsQuery({batchId:c.batch.id,companyId:c.batch.company_id,
   employeeIds:manager&&(summary||scope.summaryOnly)?manager.summaryEmployeeIds:scope.employeeIds,members,start:period.start,end:period.end,chartId:query.chartId,
   summaryOnly:summary||scope.summaryOnly,warehouseCode:query.warehouseCode,currency:query.currency,entityType:entity,
   customerOwnershipScope:!!manager,recordEmployeeIds:manager?.recordEmployeeIds,trend})
  const q=aggregate(window,!!trend&&trend.dimension==='department'&&!!manager),prior=periods&&previousCovered?aggregate(periods.previous):undefined
  const mixed=!!manager&&!scope.summaryOnly&&!trend
  const statement=mixed?combineDashboardStatements([{key:'analytics',...q},...(prior?[{key:'previous',...prior}]:[]),
   {key:'departmentSummary',...aggregate(window,true)},...(prior?[{key:'previousDepartmentSummary',...aggregate(periods!.previous,true)}]:[])]):prior?comparisonStatement(q,prior):q
  // Cache only SQL aggregates; every caller still validates current chart/target access and rechecks the revision below.
  const read=()=>this.db.query(statement.sql,statement.params)
  const [result]=trend?await this.analyticsTrendReads.read(JSON.stringify([userId,c.signature,statement.sql,statement.params]),read):await read()
  if((await this.context(userId,undefined,query,true)).signature!==c.signature)throw new ConflictException('Permission or source changed; reload')
  if(!result?.analytics||mixed&&!result.departmentSummary)throw new ServiceUnavailableException('Local aggregate unavailable')
  const current=mixed?withDepartmentSummary(result.analytics,result.departmentSummary,query.chartId==='customer_orders'):result.analytics
  const previous=mixed&&result.previous?withDepartmentSummary(result.previous,result.previousDepartmentSummary,query.chartId==='customer_orders'):result.previous
  const optionScope=manager??collectedAnalyticsScope(c.user,c.org,{},query.chartId)
  const policy=c.user.role==='admin'?undefined:c.user.chartPermissions?.find(p=>p.chartId===query.chartId)
  const departments=manager?.departments??localDepartments(c.org).filter(d=>{
   if(optionScope.summaryOnly){
    try{collectedAnalyticsScope(c.user,c.org,{departmentId:d.id},query.chartId);return true}
    catch(error){if(error instanceof ForbiddenException)return false;throw error}
   }
   return !policy||policy.dataScope==='inherit'||c.org.members.some(m=>optionScope.employeeIds?.includes(m.employeeId)&&c.org.departments.find(x=>x.id===m.departmentId)?.pathIds.includes(d.id))
  })
  const defaultDepartmentId=manager?.defaultDepartmentId??departments.find(d=>d.id===c.org.departmentId)?.id??departments.find(d=>d.name==='营销中心')?.id??departments[0]?.id??null
  return {...current,...(periods?{comparison:{...periods,available:previousCovered&&!!previous,previousData:previous??null,
   metrics:previousCovered&&previous?comparisonMetrics(current,previous,query.chartId):[],
   ...mixed&&result.previousDepartmentSummary?{departmentMetrics:comparisonMetrics(result.departmentSummary,result.previousDepartmentSummary,query.chartId)}:{}}}:{}),
   departments,defaultDepartmentId,...manager?{personalDepartmentId:manager.personalDepartmentId}:{},window,chartId:query.chartId,summaryOnly:scope.summaryOnly||!!trend&&trend.dimension==='department'&&!!manager&&trend.id!==manager.personalDepartmentId,source:'local',asOf:capture.capturedAt,
   amountBasis:registrations?null:'order_amount',timeBasis:registrations?'customer_created_at':'customer_paid_at',canExport:false,canViewDetails:false}

 }
 async orderProgress(userId:string,number:string){
  if(!this.enabled)throw new ServiceUnavailableException('Local data is not enabled')
  if(typeof number!=='string'||!number.trim()||number.trim().length>100)throw new BadRequestException('请输入有效订单编号')
  const c=await this.context(userId,'sales')
  const result=await readOrderProgress(this.db,c.batch,c.filter.employeeIds,number.trim(),effectiveWorkbenchRoles(c.user))
  if((await this.context(userId,'sales')).signature!==c.signature)throw new ConflictException('Permission or source changed; reload')
  return result
 }
 async businessChain(userId:string,orderId:string):Promise<Row>{
  if(!this.enabled)throw new ServiceUnavailableException('Collected business chain is not enabled')
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(orderId))throw new BadRequestException('Invalid source order ID')
  const c=await this.context(userId)
  if(c.user.role!=='admin'&&businessScope(c.user).role!=='admin'&&!effectiveWorkbenchRoles(c.user).length)throw new ForbiddenException('Workbench access denied')
  const result=await readCollectedChain(this.db,c.batch,c.filter.employeeIds,orderId)
  if((await this.context(userId)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  return result
 }
 async analytics(userId:string,query:CollectedAnalyticsQueryDto):Promise<Row>{
  if(!this.enabled)throw new ServiceUnavailableException({code:'workbench_collected_not_initialized',message:'Local analytics requires collected mode'})
  const window=analyticsWindow(query),c=await this.context(userId,undefined,query)
  const scope=collectedAnalyticsScope(c.user,c.org,query),captures=c.batch.metadata?.analyticsCaptures??{}
  const entityTypes=['fulfillment','stock','purchase','dispatch','receipt']
  const availableEntities=entityTypes.filter(entity=>captures[entity]?.companyId===c.batch.company_id&&captures[entity]?.coverage==='full_company_scan'&&Number.isFinite(Date.parse(captures[entity]?.capturedAt)))
  if(!availableEntities.includes('fulfillment'))throw new ServiceUnavailableException({code:'workbench_analytics_not_initialized',message:'Analytics capture is not verified for the current company'})
  const availableQueues=ANALYTICS_QUEUES.filter(queue=>{
   if(['unpaid','review','exceptions'].includes(queue))return true
   const key=['allocation','allocation_review'].includes(queue)?'allocation':queue==='procurement_shipping'?'procurement':queue
   const capture=c.batch.metadata?.entityCaptures?.[key]
   return capture?.companyId===c.batch.company_id&&(capture.coverage==='full_parent_scan'||key==='allocation'&&capture.coverage==='full_company_scan')
  })
  let freightAvailable=!scope.summaryOnly&&availableEntities.includes('dispatch'),freightEmployeeIds:readonly string[]|null=[]
  if(freightAvailable){try{freightEmployeeIds=collectedAnalyticsScope(c.user,c.org,query,'freight').employeeIds}catch(error){if(!(error instanceof ForbiddenException))throw error;freightAvailable=false}}
  const q=collectedAnalyticsQuery({batchId:c.batch.id,companyId:c.batch.company_id,employeeIds:scope.employeeIds,members:c.org.members,window,summaryOnly:scope.summaryOnly,availableQueues,availableEntities,freightAvailable,freightEmployeeIds})
  const rows:Row[]=await this.db.query(q.sql,q.params)
  if((await this.context(userId,undefined,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  if(rows.length!==1||!rows[0].analytics)throw new ServiceUnavailableException('Local analytics aggregate is unavailable')
  const asOf={currentOrders:orderCaptureTime(c.batch),...Object.fromEntries(availableEntities.map(entity=>[entity,captures[entity].capturedAt]))}
  const meta=this.metadata(c.batch)
  return {...meta,...rows[0].analytics,window,asOf,nonconsistentSnapshot:true,
   scope:{summaryOnly:scope.summaryOnly,canViewDetails:false,canExport:false,departmentId:query.departmentId??null,ownerFiltered:!!query.ownerId},
   replica:{...meta.replica,revision:c.batch.id+':analytics:'+createHash('sha256').update(JSON.stringify([c.batch.metadata?.entityCaptures,captures])).digest('hex').slice(0,16)},
   dataAvailability:{mode:'collected',complete:false,provesBusinessZero:false,executionAvailable:false,missingDatasets:entityTypes.filter(entity=>!availableEntities.includes(entity)),reason:'仅汇总本地已采集且当前授权范围内的事实；客户付款窗口不限制当前待办。金额及数量保留十进制字符串，未知字段不补零，独立采集非一致快照。'}}
 }
 async orders(userId:string,query:Row,role:WorkbenchRole,unavailable=false):Promise<CollectedPage>{
  const c=await this.context(userId,role,query),page=Math.max(1,Number(query.page)||1),pageSize=Math.min(1000,Math.max(1,Number(query.pageSize)||100))
  if(query.queue==='rma')return this.rmaOrders(userId,query,role,c)
  if(unavailable&&query.queue!=='rma')return this.stockOrders(userId,query,role,c)
  const allocationCapture=c.batch.metadata?.entityCaptures?.allocation
  const allocationReady=['allocation','allocation_review'].includes(query.queue)&&['full_company_scan','full_parent_scan'].includes(allocationCapture?.coverage)&&allocationCapture?.companyId===c.batch.company_id
  const nativeCapture=c.batch.metadata?.entityCaptures?.[['procurement','procurement_shipping'].includes(query.queue)?'procurement':query.queue]
  const nativeReady=['dispatch','procurement','procurement_shipping','shipping'].includes(query.queue)&&nativeCapture?.coverage==='full_parent_scan'&&nativeCapture?.companyId===c.batch.company_id
  const downstream=! ['unpaid','review','exceptions','shipping','dispatch'].includes(query.queue)
  if(unavailable||downstream&&!allocationReady&&!nativeReady||query.queue==='shipping'&&!query.completed&&!nativeReady){const result=await this.diagnostic(c,query);if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload');return result}
  const q=collectedWhere(c.batch.id,c.filter.employeeIds,{...query,searchOwnerIds:c.searchOwnerIds})
  const pageQuery=query.queue==='exceptions'?collectedExceptionPage(c.batch.id,c.filter.employeeIds,{...query,searchOwnerIds:c.searchOwnerIds},page,pageSize,{includeStock:true,includeUnassigned:canViewUnassignedStockExceptions(c,query)}):query.queue==='dispatch'&&query.completed?collectedDispatchPage(c.batch.id,c.filter.employeeIds,{...query,searchOwnerIds:c.searchOwnerIds},page,pageSize):null
  const loadPage=async()=>pageQuery?(await this.db.query(pageQuery.sql,pageQuery.params))[0]:null
  const cacheable=!!pageQuery&&c.batch.exception_data_revision!=null
  const cacheKey=JSON.stringify([userId,role,c.signature,c.filter.employeeIds,pageQuery?.params,pageQuery?.sql])
  const combinedPage=cacheable?await this.exceptionPages.read(cacheKey,loadPage,query.refresh===true):await loadPage()
  const readPageSql=this.listReader(userId,role,c,query).query
  const projection=allocationReady?collectedAllocationDisplay(!!query.completed,query.queue==='allocation_review'):query.queue==='shipping'?"display || jsonb_build_object('logisticsInfo',display->'warehouseLogistics')":query.queue==='dispatch'?"display || jsonb_build_object('logisticsInfo',display->'dispatchLogistics')":'display'
  const countryQuery=collectedWhere(c.batch.id,c.filter.employeeIds,{...query,searchOwnerIds:c.searchOwnerIds,shippingCountryCode:undefined})
  const [totalRows,rows,countries]:[Row[],Row[],Row[]]=await Promise.all([
   combinedPage?[combinedPage]:readPageSql(`SELECT count(*)::int AS total, CASE WHEN count(total_quantity)=count(*) AND count(*)>0 THEN sum(total_quantity) END AS quantity FROM hz_fop_collected_orders WHERE ${q.where}`,q.params),
   combinedPage?combinedPage.rows:query.projection==='count'?[]:readPageSql(`SELECT (${projection}) || jsonb_build_object('exception',(${persistedExceptionDisplaySql()})->'exception') AS display,raw FROM hz_fop_collected_orders WHERE ${q.where} ORDER BY ${q.orderBy} LIMIT $${q.params.length+1} OFFSET $${q.params.length+2}`,[...q.params,pageSize,(page-1)*pageSize]),
   combinedPage?combinedPage.countries.map((country_code:string)=>({country_code})):readPageSql(`SELECT DISTINCT country_code FROM hz_fop_collected_orders WHERE ${countryQuery.where} AND country_code IS NOT NULL ORDER BY country_code`,countryQuery.params)
  ])
  const totals=totalRows[0]
  if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  const sourceSyncedAt=publishedTimestampTime(c.batch.metadata?.timestampSync,(nativeCapture??allocationCapture)?.capturedAt??sourceCaptureFallback(c.batch),['hzkj_orders',...(['dispatch','shipping','allocation','allocation_review'].includes(query.queue)?['hzkj_deliver_bill']:[]),...(['shipping','allocation','allocation_review'].includes(query.queue)?['hzkj_alloc_bill']:[])])
  const resolvedItems=await this.productDisplay(c.batch.id,rows.map(row=>localOwnership(row.documentKind==='stock_order'?stockExceptionDisplay(row.display,row.raw,true):withOrderBusinessStatus(withCollectedOrderLogistics(collectedOrderMoney(withSourceOrderNumber({...row.display,...collectedOrderNotes(row.raw),rawBillStatus:row.raw.billstatus??null},row.raw),row.raw,c.batch.company_id),row.raw,c.batch.company_id,query),row.raw,c.batch.company_id,{persistedExceptions:true}),c.org) as CollectedRow),'items',{query:readPageSql})
  if(query.queue==='shipping'&&resolvedItems.length){
   const notices:Row[]=await readPageSql(`SELECT display->>'sourceOrderId' order_id,raw->>'billstatus' billstatus,raw->>'auditdate' auditdate FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='delivery_notice' AND display->'association'->>'state'='verified' AND display->>'sourceOrderId'=ANY($2::text[])`,[c.batch.id,resolvedItems.map(item=>item.id)])
   const grouped=new Map<string,Row[]>()
   for(const notice of notices){const group=grouped.get(notice.order_id)??[];group.push(notice);grouped.set(notice.order_id,group)}
   for(const item of resolvedItems)item.wmsCreatedAt=deliveryNoticeWmsTime(grouped.get(item.id)??[])
  }
  // Sync snapshots are internal provenance, not list fields; keep source facts intact in the database.
  const sourcedItems=await withProcurementSourceDocuments({query:readPageSql},{id:c.batch.id,company_id:c.batch.company_id},resolvedItems,rows.map(row=>row.raw)) as CollectedRow[]
  const items=query.queue==='exceptions'?sourcedItems.map(({timestampProjection,...item})=>item):sourcedItems
  if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  return {...this.metadata(c.batch),...((nativeReady||allocationReady)?{replica:{...this.metadata(c.batch).replica,sourceSyncedAt}}:{}),...(allocationReady?{dataAvailability:{mode:'collected',complete:false,queueAvailable:true,capturedAt:allocationCapture.capturedAt,reason:'按完整履约扫描关联的有效配货单的原生齐套及审核状态展示；非一致快照，执行前仍需实时核验。'}}:{}),...(nativeReady?{dataAvailability:{mode:'collected',complete:false,queueAvailable:true,capturedAt:nativeCapture.capturedAt,coverage:'full_parent_scan',executionAvailable:false,reason:'已采集完整履约扫描关联事实，本地按当前权限分类；不代表独立单据公司全集。未知状态保留核查，缺失字段留空。'}}:{}),...(query.queue==='shipping'?{dataAvailability:{mode:'collected',complete:false,queueAvailable:true,missingFields:query.completed?['dispatchDocuments']:['shipmentInterceptStatus','dispatchDocuments'],reason:query.completed?'按本单原生已出库状态展示；缺失物流关联留空。':'按真实已齐套且已审核配货单、有效审核发运单关联展示待出库；拦截状态未知，执行仍须 FOP 实时门禁。'}}:{}),items,total:totals.total,page,pageSize,queueState:'ready',departments:localDepartments(c.org),salespeople:localSalespeople(c.org,query),shippingCountries:countries.map(row=>row.country_code),totals:{orderCount:totals.total,itemQuantity:exactNumber(totals.quantity),amountsByCurrency:[],complete:false}}
 }
 async rmaDetail(userId:string,caseId:string){
  if(typeof caseId!=='string'||!caseId.trim()||caseId.length>128)throw new BadRequestException('Invalid RMA case ID')
  const result=await this.orders(userId,{queue:'rma',rmaFlowStatus:'all',caseId,page:1,pageSize:20},'sales',true)
  if(!result.dataAvailability.queueAvailable)throw new ServiceUnavailableException('RMA capture is not available')
  if(result.total!==1||result.items.length!==1)throw new NotFoundException('RMA case not found in current local scope')
  const {items,...metadata}=result;return {...metadata,item:items[0]}
 }
 private async rmaOrders(userId:string,query:Row,role:WorkbenchRole,c:Awaited<ReturnType<CollectedWorkbenchService['context']>>):Promise<CollectedPage>{
  const reader=this.listReader(userId,role,c,query)
  const capture=c.batch.metadata?.entityCaptures?.rma
  if(!capture||capture.companyId!==c.batch.company_id){const result=await this.diagnostic(c,query);if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload');return result}
  const q=collectedRmaWhere(c.batch.id,c.filter.employeeIds,{...query,searchOwnerIds:c.searchOwnerIds,includeAssociationExceptions:c.user.role==='admin'}),page=Math.max(1,Number(query.page)||1),pageSize=Math.min(1000,Math.max(1,Number(query.pageSize)||100))
  const [counts]=await reader.query(`SELECT count(*)::int AS total,count(DISTINCT display->>'sourceOrderId')::int AS order_count FROM hz_fop_collected_entities WHERE ${q.where}`,q.params)
  // Amount and product quantities belong to each RMA case; only order_count deduplicates parents.
  const monies:Row[]=await reader.query(`SELECT display->>'currency' AS currency,CASE WHEN count(display->>'amount')=count(*) THEN sum((display->>'amount')::numeric)::text END AS amount FROM (SELECT display FROM hz_fop_collected_entities WHERE ${q.where}) scoped GROUP BY display->>'currency'`,q.params)
  const [quantity]=await reader.query(`SELECT CASE WHEN count(*) FILTER(WHERE
   jsonb_typeof(raw->'case'->'hzkj_after_entryentity') IS DISTINCT FROM 'array'
   OR (line IS NOT NULL AND qty.value IS NULL))=0 THEN coalesce(sum(qty.value),0)::text END AS quantity
   FROM hz_fop_collected_entities
   LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(raw->'case'->'hzkj_after_entryentity')='array' THEN raw->'case'->'hzkj_after_entryentity' ELSE '[]'::jsonb END) line ON true
   LEFT JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(line->'hzkj_qty') IN ('number','string') AND line->>'hzkj_qty' ~ '^[0-9]+([.][0-9]+)?$'
     THEN CASE WHEN (line->>'hzkj_qty')::numeric <= 9007199254740991 THEN (line->>'hzkj_qty')::numeric END END AS value) qty ON true
   WHERE ${q.where}`,q.params)
  const rows:Row[]=query.projection==='count'?[]:await reader.query(`SELECT display,raw->'case' AS raw FROM hz_fop_collected_entities WHERE ${q.where} ORDER BY ${q.orderBy} LIMIT $${q.params.length+1} OFFSET $${q.params.length+2}`,[...q.params,pageSize,(page-1)*pageSize])
  const parentIds=rows.filter(r=>r.display.rmaAssociation?.state==='verified').map(r=>r.display.sourceOrderId).filter(Boolean)
  const parents:Row[]=parentIds.length?await reader.query('SELECT source_id,raw FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id=ANY($2::text[]) AND ($3::text[] IS NULL OR owner_employee_id=ANY($3::text[]))',[c.batch.id,parentIds,c.filter.employeeIds]):[]
  const parentTypes=new Map(parents.map(r=>[r.source_id,orderDocumentType(r.raw)]))
  for(const row of rows)row.display={...row.display,...(parentTypes.get(row.display.sourceOrderId)??{orderTypeCode:null,orderTypeName:null})}
  if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  const meta=this.metadata(c.batch)
  return {...meta,replica:{...meta.replica,sourceSyncedAt:capture.capturedAt},items:await this.productDisplay(c.batch.id,rows.map(row=>localOwnership(withCollectedRmaDetails(row.display,row.raw),c.org) as CollectedRow),'items',reader),total:counts.total,page,pageSize,queueState:'ready',departments:localDepartments(c.org),salespeople:localSalespeople(c.org,query),shippingCountries:[],totals:{caseCount:counts.total,orderCount:counts.order_count,itemQuantity:exactNumber(quantity.quantity),amountsByCurrency:monies.filter(m=>m.currency&&exactNumber(m.amount)!==null).map(m=>({currency:m.currency,amount:exactNumber(m.amount)})),complete:counts.total>0&&exactNumber(quantity.quantity)!==null&&monies.length>0&&monies.every(m=>!!m.currency&&exactNumber(m.amount)!==null)},dataAvailability:{mode:'collected',complete:false,queueAvailable:true,capturedAt:capture.capturedAt,coverage:capture.coverage,provesBusinessZero:false,executionAvailable:false,reason:'已采集付款客户范围内的真实售后单；当前为部分客户覆盖，计数仅指当前权限和筛选内已采集记录，不代表公司全部售后或业务零。仅展示业务归属已核验的记录；此售后采集范围尚未纳入时间增量，执行仍须 FOP 实时接口。'}}
 }
 private async stockOrders(userId:string,query:Row,role:WorkbenchRole,c:Awaited<ReturnType<CollectedWorkbenchService['context']>>):Promise<CollectedPage>{
  const reader=this.listReader(userId,role,c,query)
  const q=collectedStockWhere(c.batch.id,c.filter.employeeIds,{...query,searchOwnerIds:c.searchOwnerIds}),page=Math.max(1,Number(query.page)||1),pageSize=Math.min(1000,Math.max(1,Number(query.pageSize)||100))
  const table=await reader.query("SELECT to_regclass('public.hz_fop_collected_entities') AS name")
  if(!table[0].name)return this.empty(c,query)
  const initialized=c.batch.metadata?.entityCaptures?.stock_orders
  if(!initialized)return this.empty(c,query)
  const totals=await reader.query(`SELECT count(*)::int AS total FROM hz_fop_collected_entities WHERE ${q.where}`,q.params)
  const warehouses=await reader.query(`SELECT DISTINCT display->>'warehouseCode' AS code,display->>'warehouse' AS name FROM hz_fop_collected_entities WHERE ${q.where} ORDER BY code`,q.params)
  const aggregates=await reader.query(`SELECT display->>'currency' AS currency,CASE WHEN count(display->>'amount')=count(*) AND count(display->>'currency')=count(*) THEN sum((display->>'amount')::numeric)::text END AS amount FROM hz_fop_collected_entities WHERE ${q.where} GROUP BY display->>'currency'`,q.params)
  const [quantity]=await reader.query(`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM hz_fop_collected_entities WHERE ${q.where} AND display->'dataQuality'->'missingFields' ? 'items') AND count(line->>'quantity')=count(*) THEN sum((line->>'quantity')::numeric)::text END AS quantity FROM hz_fop_collected_entities CROSS JOIN LATERAL jsonb_array_elements(display->'items') line WHERE ${q.where}`,q.params)
  const rows=query.projection==='count'?[]:await reader.query(`SELECT ${persistedExceptionDisplaySql('hz_fop_collected_entities')} AS display FROM hz_fop_collected_entities WHERE ${q.where} ORDER BY ${q.orderBy} LIMIT $${q.params.length+1} OFFSET $${q.params.length+2}`,[...q.params,pageSize,(page-1)*pageSize])
  if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  const meta=this.metadata(c.batch)
  return {...meta,replica:{...meta.replica,sourceSyncedAt:initialized.capturedAt},items:await this.productDisplay(c.batch.id,rows.map((r:Row)=>localOwnership(r.display,c.org) as CollectedRow),'items',reader),total:totals[0].total,page,pageSize,queueState:'ready',departments:localDepartments(c.org),salespeople:localSalespeople(c.org,query),warehouses,totals:{orderCount:totals[0].total,itemQuantity:exactNumber(quantity.quantity),amounts:aggregates.map((a:Row)=>({currency:a.currency,amount:exactNumber(a.amount)})),complete:quantity.quantity!==null&&aggregates.every((a:Row)=>a.amount!==null&&a.currency!==null)},dataAvailability:{mode:'collected',complete:false,reason:'备货订单已采集入库；缺失字段留空，此实体修改时间增量契约仍待核验。',capturedAt:initialized.capturedAt}}
 }
 private async diagnostic(c:Awaited<ReturnType<CollectedWorkbenchService['context']>>,query:Row){
  const gaps:Record<string,string[]>={procurement:['hzkj_purchase_status','stock_usage_requires_procurement'],procurement_shipping:['hzkj_purchase_status'],shipping:['allocationDocument','allocationReview','stockReadiness','shipmentInterceptStatus'],dispatch:['dispatchDocuments','hzkj_delivery_status'],allocation:['allocationDocument','hzkj_alloc_status'],allocation_review:['allocationDocument','billstatus'],rma:['rma_cases','salesperson_or_verified_parent_relation'],purchase_returns:['physical_return_document','hzkj_rf_kind','hzkj_rf_applyqty','returned_quantity','physical_return_status','return_logistics','verified_fulfillment_line_relation'],receipt_notices:['receipt_notice_entity','receipt_notice_status'],procurement_groups:['purchase_entity','authorized_fulfillment_relations']}
  const reasons:Record<string,string>={
   procurement:'履约采集未提供采购原生状态与备货库存使用事实；已发布采购查询本轮返回空，需 FOP 核验集成账号的公司查询范围、筛选与关联。',
   procurement_shipping:'履约采集未提供采购原生状态；已发布采购查询本轮返回空，需 FOP 核验集成账号的公司查询范围、筛选与供应商发货事实。',
   shipping:'待出库还需证明配货已审核、库存齐套及未拦截；履约采集未提供这些事实，不能将所有未出库订单列为待出库。',
   dispatch:'已发布发运查询本轮返回空，需 FOP 核验集成账号的公司查询范围、筛选与履约关联；履约采集不能证明制备、发运审核或 Shopify 履约状态。',
   allocation:'已发布配货查询本轮返回空，需 FOP 核验集成账号的公司查询范围、筛选与履约关联；履约采集未提供配货齐套事实。',
   allocation_review:'已发布配货查询本轮返回空，需 FOP 核验集成账号的公司查询范围、筛选与履约关联；履约采集未提供配货审核事实。',
   rma:'当前本地批次尚无已验证公司范围的售后采集。RMA 入库、归属关联、查询、详情与导出已实现；需要真实付款客户采集及同公司原单证据，部分覆盖不得解释为公司业务零。',
   purchase_returns:'已提供采购订单退款候选和采购退款申请查询；实物退货类型、进度、退货数量、物流及履约明细关联仍待提供。',
   receipt_notices:'已发布收货通知单查询本轮返回空，需 FOP 核验集成账号的公司查询范围、筛选及通知单入库状态。',
   procurement_groups:'已发布采购订单查询本轮返回空，需 FOP 核验集成账号的公司查询范围、筛选与有效采购分录关联。',
  }
  let candidates:Row={}
  if(!query.completed&&['procurement','procurement_shipping','shipping','dispatch','allocation','allocation_review'].includes(query.queue)){
   const params:unknown[]=[c.batch.id],clauses=["batch_id=$1","raw_delivery_status IS DISTINCT FROM '2'"]
   if(query.queue!=='shipping')clauses.push("raw_payment_status='1'")
   if(c.filter.employeeIds!==null){params.push(c.filter.employeeIds);clauses.push('owner_employee_id=ANY($2::text[])')}
   const [count]=await this.db.query(`SELECT count(*)::int AS total FROM hz_fop_collected_orders WHERE ${clauses.join(' AND ')}`,params)
   candidates={unclassifiedCount:count.total,unclassifiedCountMeaning:'候选履约记录数，不是本清单业务单据数'}
  }
  const result=this.empty(c,query)
  // A successful source response alone cannot enable a collected queue: this
  // transitional reader also needs an implemented importer and membership rules.
  const sourceState=query.queue==='rma'?'empty_legacy_rma_response':query.queue==='purchase_returns'?'source_contract_pending':query.queue==='shipping'?'linked_facts_not_captured':'successful_empty_legacy_response'
  return {...result,dataAvailability:{...result.dataAvailability,queueAvailable:false,missingFields:gaps[query.queue]??['source_entity_and_status'],...candidates,
   localImplementation:{state:['allocation','allocation_review','rma'].includes(query.queue)?'implemented_awaiting_scoped_capture':'not_implemented',required:['allocation','allocation_review','rma'].includes(query.queue)?[]:['source_normalization_and_import','independent_scope_and_relations','queue_classification_and_query','detail_and_export']},
   sourceEvidence:{state:sourceState,provesBusinessZero:false,provesAuthorizationFailure:false,evidence:'all-queues-integration-20261112'},
   reason:(reasons[query.queue]??'本清单来源实体与状态尚未采集，不能据此解释为业务零。')+(query.queue==='rma'?'': ['allocation','allocation_review'].includes(query.queue)?' 本地配货入库、分类查询及导出已实现，仍需核验身份、公司完整范围和有效关联后导入真实采集。':' 本项目采集过渡层还需实现对应来源入库、业务归属与明确关联、清单分类查询及详情导出；仅补源端数据不会自动开通本清单。')}}
 }
 private empty(c:Awaited<ReturnType<CollectedWorkbenchService['context']>>,query:Row){return {...this.metadata(c.batch,true),items:[],total:0,page:Number(query.page)||1,pageSize:Number(query.pageSize)||100,queueState:'ready',departments:localDepartments(c.org),salespeople:localSalespeople(c.org,query),warehouses:[],shippingCountries:[],totals:{orderCount:0,itemQuantity:null,amountsByCurrency:[],amounts:[],quantity:null,inboundQuantity:null,pendingQuantity:null,groupCount:null,purchaseCount:null,uncreatedCount:null,complete:false}}}
 async receiptNotices(userId:string,query:Row){
  const c=await this.context(userId,'warehouse',query)
  const capture=c.batch.metadata?.entityCaptures?.fulfillment_inbound
  const readSql=this.listReader(userId,'warehouse',c,query).query
  const loadWarehouses=()=>readSql(`SELECT CASE warehouse_code WHEN '01' THEN 'HZ' WHEN 'HNDGLB' THEN 'SZ' ELSE warehouse_code END code,max(display->>'warehouse') name FROM hz_fop_collected_orders WHERE batch_id=$1 AND ($2::text[] IS NULL OR owner_employee_id=ANY($2)) AND warehouse_code IS NOT NULL GROUP BY 1 ORDER BY 1`,[c.batch.id,c.filter.employeeIds])
  const page=Math.max(1,Number(query.page)||1),pageSize=Math.min(1000,Math.max(1,Number(query.pageSize)||100))
  const key=JSON.stringify([userId,c.signature,c.batch.metadata?.receiptSupplement,c.batch.metadata?.timestampSync,c.batch.metadata?.entityCaptures,{...query,refresh:undefined}])
  const readPage=async()=>{
   const q=collectedInboundPage(c.batch.id,c.filter.employeeIds,{...query,searchOwnerIds:c.searchOwnerIds},page,pageSize)
   const [dataRows,warehouses]=await Promise.all([this.db.query(q.sql,q.params),loadWarehouses()])
   const stockIds=[...new Set<string>((dataRows[0].parcels??[]).filter((p:Row)=>p.parcel_key.startsWith('stock:')).map((p:Row)=>p.parcel_key.slice(6)))]
   const stockGroups=await readInboundStockGroups(this.db,c.batch,stockIds,c.filter.employeeIds)
   return {...dataRows[0],warehouses,parcels:(dataRows[0].parcels??[]).map((p:Row)=>({...p,stockGroup:stockGroups.get(p.parcel_key.slice(6))??null}))}
  }
  const cached=await this.inboundPages.read(key,readPage,query.refresh===true)
  const warehouses=cached.warehouses,count=cached.counts,quality={unclassified:cached.unclassified},rows:Row[]=cached.rows
  const quantity=exactNumber
  const items=rows.map((row:Row)=>{
   const order=localOwnership(withOrderBusinessStatus(collectedOrderMoney(withSourceOrderNumber({...row.display,...collectedOrderNotes(row.raw),rawBillStatus:row.raw.billstatus??null},row.raw),row.raw,c.batch.company_id),row.raw,c.batch.company_id,{persistedExceptions:true}),c.org)
   const facts=new Map<string,Row>((row.inbound_lines??[]).map((line:Row)=>[line.id,line]))
   const lines=order.items.map((line:Row)=>({...line,purchaseQuantity:facts.get(line.id)?.purchaseQuantity??null,inboundQuantity:facts.get(line.id)?.inboundQuantity??null,pendingQuantity:facts.get(line.id)?.pendingQuantity??null,rawPurchaseStatus:facts.get(line.id)?.rawPurchaseStatus??null}))
   return {...order,number:order.orderNumber,noticeNumbers:row.notices.map((n:Row)=>n.number),status:row.status,lines,quantity:quantity(row.quantity),inboundQuantity:quantity(row.inbound_quantity),pendingQuantity:quantity(row.pending_quantity),supplier:null,logistics:receiptLogistics(row.notices),shippedAt:null,carrier:null,trackingNumber:null}
  })
  const unclassified=Number(quality?.unclassified)||0,available=count.total>0||(query.view==='parcel'&&cached.parcel_total>0)||unclassified===0
  const totalQuantity=(value:unknown)=>value==null?(available?0:null):exactNumber(value)
  const sourcedItems=await withProcurementSourceDocuments({query:readSql},{id:c.batch.id,company_id:c.batch.company_id},items.map(item=>({...item,items:item.lines})),rows.map(row=>row.raw))
  const displayedItems=await this.productDisplay(c.batch.id,sourcedItems.map(item=>({...item,lines:item.items})),'lines',{query:readSql})
  const stockDisplays=await this.productDisplay(c.batch.id,(cached.parcels??[]).filter((p:Row)=>p.stockGroup).map((p:Row)=>p.stockGroup),'products',{query:readSql})
  const stockDisplayMap=new Map(stockDisplays.map((s:Row)=>[s.id,s]))
  const parcels=(cached.parcels??[]).map((p:Row)=>({...p,stockGroup:p.stockGroup?stockDisplayMap.get(p.stockGroup.id):null}))
  if((await this.context(userId,'warehouse',query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  return {...this.metadata(c.batch),items:displayedItems,parcelGroups:query.view==='parcel'?parcels.map((p:Row)=>({id:p.parcel_key,carrier:p.carrier,trackingNumber:p.tracking_number,shippedAt:receiptLogistics([{id:p.parcel_key,shippedAt:p.shipped_at}])[0]?.shippedAt??null,noticeNumbers:p.notice_numbers??[],orderIds:p.order_ids,stockGroup:p.stockGroup??undefined})):undefined,total:query.view==='parcel'?cached.parcel_total:count.total,orderTotal:count.total,page,pageSize,view:query.view==='parcel'?'parcel':'fulfillment',departments:localDepartments(c.org),warehouses,
   totals:{quantity:totalQuantity(count.quantity),inboundQuantity:totalQuantity(count.inbound_quantity),pendingQuantity:totalQuantity(count.pending_quantity)},
   dataAvailability:{mode:'collected',complete:unclassified===0,queueAvailable:available,capturedAt:capture?.capturedAt??this.metadata(c.batch).replica.sourceSyncedAt,executionAvailable:false,unclassifiedCount:unclassified,
    missingFields:unclassified?['hzkj_orders_billentry.hzkj_entrypurc_status','hzkj_orders_billentry.hzkj_purcqty','hzkj_orders_billentry.hzkj_instock_qty']:[],
    reason:unclassified?'已发货订单的商品行入库信息尚未完整，缺失数量不按零处理。':'按履约订单采购发货状态与商品行采购、入库数量判断；全部商品已入库且数量一致后移出。'}}
 }

 async purchaseGroups(userId:string,query:Row,groupId?:string):Promise<any>{
  const c=await this.context(userId,'procurement',query),capture=c.batch.metadata?.entityCaptures?.procurement_groups
  if(!capture||capture.companyId!==c.batch.company_id)return this.unavailable(userId,{...query,queue:'procurement_groups'},'procurement',groupId)
  const reader=this.listReader(userId,'procurement',c,query)
  const params:unknown[]=[c.batch.id],permission=c.filter.employeeIds===null?'':` AND display->'association'->>'state' IS DISTINCT FROM 'conflict' AND EXISTS(SELECT 1 FROM jsonb_array_elements(display->'rows') r WHERE r->>'ownerEmployeeId'=ANY($2::text[]))`;if(c.filter.employeeIds!==null)params.push(c.filter.employeeIds)
  const source:Row[]=await reader.query(`SELECT display,raw FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type IN ('purchase','purchase_demand')${permission}`,params)
  let all=source.map(r=>scopedPurchaseGroup(r.display.purchase?{...r.display,purchase:{...r.display.purchase,supplier:purchaseLogisticsSupplier(r.raw??{})}}:r.display,c.filter.employeeIds)).filter(g=>g.rows.length>0||c.filter.employeeIds===null)
  if(!query.completed&&query.queue!=='procurement_shipping'){
   const scopedOrders:Row[]=await reader.query("SELECT source_id,display,raw FROM hz_fop_collected_orders WHERE batch_id=$1 AND raw_bill_status='C' AND raw_payment_status='1' AND raw_order_status IN ('1','2','3','4','5','no') AND display->'procurementQueueFlags'->>'pending'='true' AND ($2::text[] IS NULL OR owner_employee_id=ANY($2::text[]))",[c.batch.id,c.filter.employeeIds])
   const pendingOrders=new Map(scopedOrders.map(o=>[o.source_id,o]))
   all=all.filter(g=>g.kind!=='uncreated').map(g=>{
    const rows=g.rows.filter((r:Row)=>pendingOrders.has(r.orderId))
    const stages=rows.map((r:Row)=>pendingOrders.get(r.orderId)!.display.procurementStage)
    const stage=g.purchase?.platformOrderNumber&&g.purchase?.payment==='unpaid'&&stages.includes('payment_pending')?'payment_pending':stages.includes('dispatch_preparation')?'dispatch_preparation':'unknown'
    return scopedPurchaseGroup({...g,rows,stage},null)
   }).filter(g=>g.rows.length>0)
   for(const o of scopedOrders)if(o.display.procurementStage==='purchase_order_pending'){
    const d=o.display
    const sourced=withProcurementSources(o.raw,d.procurementSources)
    const lines=uncreatedPurchaseLines(d,sourced)
    if(!lines.length)continue
    all.push(scopedPurchaseGroup({id:'uncreated:'+o.source_id,kind:'uncreated',purchase:null,stage:'uncreated',association:{state:'verified'},rows:[{orderId:o.source_id,orderNumber:d.orderNumber,ownerEmployeeId:d.owner?.id,ownerName:d.owner?.name,departmentName:d.department?.name,customerName:d.customerName,storeName:d.storeName,warehouse:d.warehouse,paidAt:d.paidAt,lines}]},null))
   }
  }
  for(const g of all)g.rows=g.rows.map((r:Row)=>{const local:Row=localOwnership({owner:{id:r.ownerEmployeeId,name:r.ownerName}},c.org);return{...r,ownerName:local.owner?.name??null,departmentName:local.department?.name??null}})
  const unclassifiedCount=all.filter(g=>g.stage==='unknown'||g.association?.state==='conflict').length
  all=all.filter(g=>query.purchaseStage==='unknown'?g.stage==='unknown'||g.association?.state==='conflict':g.association?.state!=='conflict'&&(query.completed?g.stage==='shipped':query.queue==='procurement_shipping'?['supplier_pending','supplier_partial'].includes(g.stage):['uncreated','dispatch_preparation','payment_pending'].includes(g.stage)))
  if(query.purchaseStage&&query.purchaseStage!=='unknown')all=all.filter(g=>g.stage===query.purchaseStage)
  if(query.search?.trim()){const term=query.search.trim().toLowerCase();all=all.filter(g=>[g.purchase?.number,g.purchase?.platformOrderNumber,g.purchase?.supplier?.name,g.purchase?.supplier?.phone,...g.rows.flatMap((r:Row)=>[r.orderNumber,r.customerName,r.storeName,r.ownerName,...r.lines.map((l:Row)=>l.sku)])].some(v=>typeof v==='string'&&v.toLowerCase().includes(term)))}
  if(query.warehouseCode)all=all.filter(g=>g.rows.some((r:Row)=>warehouseCodes(query.warehouseCode).includes(r.warehouseCode)))
  const days:Row={'1w':7,'1m':30,'3m':90};if(days[query.timeRange])all=all.filter(g=>g.latestConsumerPaidAt&&Date.parse(g.latestConsumerPaidAt)>=Date.now()-days[query.timeRange]*86400000)
  if(query.mode==='selected')all=all.filter(g=>query.groupIds?.includes(g.id))
  all.sort((a,b)=>((a.latestConsumerPaidAt??'').localeCompare(b.latestConsumerPaidAt??'')||a.id.localeCompare(b.id))*(query.sortOrder==='asc'?1:-1))
  const page=Math.max(1,Number(query.page)||1),pageSize=Math.min(1000,Number(query.pageSize)||100),meta={...this.metadata(c.batch),replica:{...this.metadata(c.batch).replica,sourceSyncedAt:capture.capturedAt},departments:localDepartments(c.org),salespeople:localSalespeople(c.org,query),page,pageSize,dataAvailability:{mode:'collected',complete:false,queueAvailable:true,capturedAt:capture.capturedAt,coverage:capture.coverage,unclassifiedCount,executionAvailable:false,reason:'已采集履约关联采购单；按本地权限先裁剪关联行再汇总。供应商发货量未提供时留空，状态未知的单据可选择“待核查”查看，不计为采购完成。'}}
  if((await this.context(userId,'procurement',query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  if(groupId){
   const group=all.find(g=>g.id===groupId);if(!group)throw new NotFoundException('Purchase group not found in current result')
   const items=await this.productDisplay(c.batch.id,group.rows.slice((page-1)*pageSize,page*pageSize),'lines',reader)
   const facts:Row[]=items.length?await reader.query(`SELECT source_id,${persistedExceptionDisplaySql()} AS display,raw FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id=ANY($2::text[]) AND ($3::text[] IS NULL OR owner_employee_id=ANY($3::text[]))`,[c.batch.id,items.map((r:Row)=>r.orderId).filter(Boolean),c.filter.employeeIds]):[]
   const orderLabels=new Map(facts.map(r=>[r.source_id,{...orderDocumentType(r.raw),exception:withOrderBusinessStatus(r.display,r.raw,c.batch.company_id,{persistedExceptions:true}).exception}]))
   if((await this.context(userId,'procurement',query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
   return{...meta,group:{...group,rows:undefined},items:items.map((r:Row)=>({...r,...(orderLabels.get(r.orderId)??{orderTypeCode:null,orderTypeName:null,exception:null})})),total:group.rows.length}
  }
  return{...meta,items:query.projection==='count'?[]:all.slice((page-1)*pageSize,page*pageSize).map(g=>({...g,rows:undefined})),total:all.length,totals:{groupCount:all.length,purchaseCount:all.filter(g=>g.kind==='purchase').length,orderCount:new Set(all.flatMap(g=>g.rows.map((r:Row)=>r.orderId))).size,uncreatedCount:all.filter(g=>g.kind==='uncreated').length,pendingQuantity:null}}
 }
 private async exportPurchaseGroups(userId:string,query:Row,version:number):Promise<Buffer>{
  const c=await this.context(userId,'procurement',query);if((c.user.sessionVersion??0)!==version)throw new UnauthorizedException('Session expired')
  if(!['filtered','selected'].includes(query.mode)||query.mode==='selected'&&(!Array.isArray(query.groupIds)||!query.groupIds.length||query.groupIds.length>1000||new Set(query.groupIds).size!==query.groupIds.length)||query.mode==='filtered'&&query.groupIds!==undefined)throw new BadRequestException('Invalid export selection')
  const count=await this.purchaseGroups(userId,{...query,projection:'count'});if(count.total>10000)throw new PayloadTooLargeException('单次最多导出 10,000 张采购单')
  const result=await collectReplicaPages<any>(page=>this.purchaseGroups(userId,{...query,page,pageSize:100}));if(query.mode==='selected'&&result.items.length!==query.groupIds.length)throw new ForbiddenException('Selection outside current result')
  const wb=new Workbook(),sheet=wb.addWorksheet('采购单');sheet.columns=[['采购单号','number'],['供应商','supplier'],['联系电话','supplierPhone'],['采购渠道','purchaseType'],['平台单号','platformOrderNumber'],['支付状态','payment'],['下单状态','placement'],['供应商发货状态','shipment'],['履约笔数','orderCount'],['SKU数','skuCount'],['采购数量','quantity'],['供应商发货数量','shippedQuantity'],['未发数量','pendingQuantity']].map(([header,key])=>({header,key,width:24}));const lines=wb.addWorksheet('授权关联明细');lines.columns=[['采购单号','purchaseNumber'],['履约单号','orderNumber'],['业务员','ownerName'],['SKU','sku'],['商品名称','name'],['规格','variant'],['商品图片','imageUrl'],['数量','quantity'],['供应商发货数量','shippedQuantity']].map(([header,key])=>({header,key,width:24}));let lineCount=0
  for(const g of result.items){exportRowIdentity(sheet.addRow({...g,...g.purchase,supplier:g.purchase?.supplier?.name??null,supplierPhone:g.purchase?.supplier?.phone??null}),g.id);const details=await collectReplicaPages<any>(page=>this.purchaseGroups(userId,{...query,page,pageSize:100},g.id));for(const r of details.items)for(const l of r.lines){if(++lineCount>50000)throw new PayloadTooLargeException('单次最多导出 50,000 条明细');exportRowIdentity(exportProductRow(lines.addRow({...l,purchaseNumber:g.purchase?.number,orderNumber:r.orderNumber,ownerName:r.ownerName}),l),g.id)}}
  const notes=wb.addWorksheet('说明');notes.addRow(['模式','已采集履约关联覆盖，非一致快照；未知字段留空；仅含当前本地权限内明细与合计']);notes.addRow(['采集时间',c.batch.metadata.entityCaptures.procurement_groups.capturedAt]);await singleSheetWorkbook(wb,{main:'采购单',details:['授权关联明细']});const buffer=Buffer.from(await wb.xlsx.writeBuffer());if((await this.context(userId,'procurement',query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload');return buffer
 }
 async purchaseReturns(userId:string,query:Row):Promise<any>{
  const role=query.workbenchRole as WorkbenchRole,c=await this.context(userId,role,query)
  const reader=this.listReader(userId,role,c,query)
  const capture=c.batch.metadata?.entityCaptures?.purchase_material_return
  if(!capture||capture.companyId!==c.batch.company_id)return this.unavailable(userId,{...query,queue:'purchase_returns'},role)
  const q=collectedMaterialReturnsQuery(c.batch.id,c.filter.employeeIds,query)
  const page=Math.max(1,Number(query.page)||1),pageSize=Math.min(1000,Math.max(1,Number(query.pageSize)||100))
  const [countRows,rows]=await Promise.all([
   reader.query(`${q.cte} SELECT (SELECT count(*)::int FROM matched) total,(SELECT count(DISTINCT return_id)::int FROM linked) return_count,(SELECT sum((l->>'quantity')::numeric) FROM linked CROSS JOIN LATERAL jsonb_array_elements(document->'lines') l) quantity`,q.params),
   query.projection==='count'?Promise.resolve([]):reader.query(`${q.cte} SELECT o.display,o.raw,m.documents FROM matched m JOIN hz_fop_collected_orders o ON o.batch_id=$1 AND o.source_id=m.source_id ORDER BY o.paid_at ${query.paidAtOrder==='asc'?'ASC':'DESC'} NULLS LAST,o.source_id LIMIT $${q.params.length+1} OFFSET $${q.params.length+2}`,[...q.params,pageSize,(page-1)*pageSize])
  ])
  const counts=countRows[0]
  const sum=(values:(number|null)[])=>values.every(v=>v!==null)?values.reduce((a,b)=>a!+b!,0):null
  const items=rows.map((row:Row)=>{
   const order=localOwnership(collectedOrderMoney(withSourceOrderNumber(row.display,row.raw),row.raw,c.batch.company_id),c.org)
   const purchaseReturns=row.documents.map((d:Row)=>({...d,quantity:sum(d.lines.map((l:Row)=>l.quantity)),returnedQuantity:null,lines:d.lines.map((l:Row)=>({...l,sourceOrder:{id:order.id,number:order.orderNumber,kind:'fulfillment',customerName:order.customerName,owner:order.owner,department:order.department}}))}))
   const relatedPurchaseOrders=[...new Map<string,Row>(purchaseReturns.flatMap((d:Row)=>d.lines.flatMap((l:Row)=>(l.orderPurchases??[]).map((p:Row)=>[p.id,p] as [string,Row])))).values()]
   return {...order,purchaseReturns,relatedPurchaseOrders,returnQuantity:sum(purchaseReturns.map((d:Row)=>d.quantity)),returnedQuantity:null}
  })
  if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or data changed; reload')
  const meta=this.metadata(c.batch)
  return {...meta,replica:{...meta.replica,sourceSyncedAt:capture.capturedAt},items:await this.productDisplay(c.batch.id,items,'items',reader),total:counts.total,page,pageSize,departments:localDepartments(c.org),totals:{orderCount:counts.total,returnCount:counts.return_count,quantity:counts.quantity==null?null:Number(counts.quantity),returnedQuantity:null,itemQuantity:null,amountsByCurrency:[]},dataAvailability:{mode:'collected',queueAvailable:true,complete:false,executionAvailable:false,missingFields:['return_execution_status','return_logistics','purchase_order_relation','fulfillment_line_id'],capturedAt:capture.capturedAt}}
 }
 async unavailable(userId:string,query:Row,role:WorkbenchRole,groupId?:string){const c=await this.context(userId,role,query);const result=await this.diagnostic(c,{...query,queue:groupId?'procurement_groups':query.queue??(role==='warehouse'?'receipt_notices':'purchase_returns')});if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload');return {...result,...(groupId?{group:null}:{})}}
 async export(userId:string,query:Row,version:number,kind:string):Promise<Buffer>{
  if(kind==='groups')return this.exportPurchaseGroups(userId,query,version)
  const role=kind==='orders'?FULFILLMENT_QUEUE_ROLES[query.queue as keyof typeof FULFILLMENT_QUEUE_ROLES]:kind==='stock'?query.queue==='procurement'?'procurement':'sales':kind==='rma'?'sales':kind==='returns'?query.workbenchRole:'procurement'
  if(!role)throw new BadRequestException('Invalid queue')
  const c=await this.context(userId,role,query)
  if((c.user.sessionVersion??0)!==version)throw new UnauthorizedException('Session expired')
  const selectionIds=kind==='rma'?query.caseIds:query.orderIds
  if(!['selected','filtered'].includes(query.mode)||query.mode==='selected'&&(!Array.isArray(selectionIds)||!selectionIds.length||selectionIds.length>1000||new Set(selectionIds).size!==selectionIds.length)||query.mode==='filtered'&&selectionIds!==undefined)throw new BadRequestException('Invalid export selection')
  if(!['orders','stock','rma','returns'].includes(kind))throw new ServiceUnavailableException('该数据集尚未接入，无法导出')
  const read=(q:Row)=>kind==='returns'?this.purchaseReturns(userId,q):this.orders(userId,kind==='rma'?{...q,queue:'rma'}:q,role,kind==='stock')
  const count=await read({...query,projection:'count'})
  if(count.total>10000)throw new PayloadTooLargeException('单次最多导出 10,000 笔订单，请缩小筛选范围')
  const result=await collectReplicaPages<any>(page=>read({...query,page,pageSize:100,projection:undefined}))
  if(query.mode==='selected'&&(result.items.length!==selectionIds.length||result.items.some(row=>!selectionIds.includes(row.id))))throw new ForbiddenException('Selection outside current result')
  if(result.items.reduce((n,row)=>n+row.items.length,0)>50000)throw new PayloadTooLargeException('单次最多导出 50,000 条商品明细，请缩小范围')
  const wb=new Workbook(),sheet=wb.addWorksheet('已采集订单')
  const columns=[['订单号','orderNumber',30],['Shopify单号','shopifyOrderNumber',22],['客户','customerName',25],['店铺','storeName',25],['业务员','ownerName',20],['部门','departmentName',20],['仓库','warehouse',20],['国家','shippingCountryCode',12],['商品金额','productAmount',18],['订单总金额','amount',18],['结算币种','currency',15],['运费','shippingFee',18],['税费','taxFee',18],['优惠','discountFee',18],['付款状态','paymentStatus',16],['审核状态','reviewStatus',16],['已取消','cancelled',12],['客户付款时间 UTC+8','paidAtText',26],['C端付款时间 UTC+8','buyerPaidAtText',26],['审核时间 UTC+8','reviewedAtText',26],['收件人','recipientName',25],['联系电话','recipientPhone',22],['电子邮箱','recipientEmail',28],['收件地址','recipientAddress',48],['邮编','recipientPostalCode',16],['自定义渠道','customLogisticsChannelName',28],['待接入字段','missing',65]]
  if(kind==='orders'&&query.queue==='shipping')columns.splice(columns.findIndex(c=>c[1]==='reviewStatus'),0,['出库状态','outboundStatusText',20])
  if(['allocation','allocation_review'].includes(query.queue))columns.push(['配货单号','allocationNumbers',32],['配货原生齐套状态','allocationNativeStatuses',26],['配货原生审核状态','allocationNativeBillStatuses',26])
  if(kind==='returns')columns.push(['关联采购单','relatedPurchaseNumbers',40],['采购退料单','materialReturnNumbers',40],['退料单据状态','materialReturnStatuses',24],['退料数量','returnQuantity',18])
  if(kind==='orders')columns.push(['订单备注','orderRemark',48])
  if(kind==='orders'&&query.queue==='review')columns.push(['实际物流渠道','actualChannelNames',36])
  if(kind==='orders'&&query.queue==='exceptions')columns.push(['异常类型','exceptionTypeText',22],['异常原因','exceptionReason',50])
  if(kind==='orders'&&(['dispatch','shipping'].includes(query.queue)||query.queue==='review'&&query.completed))columns.push(['物流渠道 / 跟踪号','actualLogisticsText',48])
  if(kind==='orders'&&query.queue==='dispatch')columns.push(['履约状态','dispatchStatusText',22])
  if(kind==='orders'&&query.queue==='dispatch'&&query.completed)columns.push(['订单采购状态','sourcePurchaseStatusName',20])
  if(kind==='stock')columns.push(['备货类型','stockType',18],['备货订单状态','orderStatus',18],['单据状态','stockBillStatusText',18],['采购状态','purchaseStatus',20],['采购付款时间 UTC+8','procurementPaidAtText',26])
  if(kind==='rma')columns.push(['售后单号','rmaNumber',30],['原生售后类型','rmaRawType',18],['售后类型','rmaType',18],['原生流程状态','rmaRawStatus',18],['售后阶段','rmaStage',20],['售后原因','rmaReason',50],['退款金额','refundAmount',18],['退款币种','refundCurrency',18],['关联核查','associationState',25])
  if(kind==='orders'&&query.queue==='unpaid')columns.splice(columns.findIndex(c=>c[1]==='paidAtText'),1)
  if(kind==='rma')for(let i=columns.length-1;i>=0;i--)if(['productAmount','shippingFee','taxFee','discountFee'].includes(String(columns[i][1])))columns.splice(i,1)
  sheet.columns=columns.map(([header,key,width])=>({header:String(header),key:String(key),width:Number(width)}))
  const lines=wb.addWorksheet('商品明细');lines.columns=[{header:'订单号',key:'orderNumber',width:30},{header:'SKU',key:'sku',width:25},{header:'名称',key:'name',width:40},{header:'属性',key:'variant',width:35},{header:'数量',key:'quantity',width:15},{header:'图片',key:'imageUrl',width:50}]
  const sourceExport=kind==='orders'
  if(sourceExport)lines.columns=[...lines.columns,...[['采购来源核验','sourceState'],['SKU需求合计','sourceDemand'],['全款备货数量（SKU合计）','fullPaymentQuantity'],['押金备货数量（SKU合计）','depositQuantity'],['直接采购数量（SKU合计）','directQuantity']].map(([header,key])=>({header,key,width:25}))]
  const returnLines=kind==='returns'?wb.addWorksheet('退料明细'):undefined
  if(returnLines)returnLines.columns=[['订单号','orderNumber'],['退料单号','returnNumber'],['单据状态','billStatusName'],['供应商','supplier'],['SKU','sku'],['中文配货名','name'],['退料数量','quantity'],['原生数量','rawQuantity'],['来源单据','sourceDocumentNumber'],['备注','reason']].map(([header,key])=>({header,key,width:24}))
  const dateText=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(Date.parse(value)+8*3600_000).toISOString().slice(0,19).replace('T',' '):null
  for(const row of result.items){
   sheet.addRow({...row,outboundStatusText:businessStatusLabel(row.businessStatus?.outbound,'outbound'),...(kind==='stock'?{orderStatus:row.orderStatusName??row.orderStatus,purchaseStatus:row.purchaseStatusName??row.purchaseStatus}:{}),relatedPurchaseNumbers:row.relatedPurchaseOrders?.map((p:Row)=>p.number).join(' / '),materialReturnNumbers:row.purchaseReturns?.map((d:Row)=>d.number).join(' / '),materialReturnStatuses:row.purchaseReturns?.map((d:Row)=>d.billStatusName).filter(Boolean).join(' / '),actualChannelNames:[...new Set((row.logisticsChannels??[]).map((channel:Row)=>channel.name?.trim()).filter(Boolean))].join(' / ')||null,actualLogisticsText:logisticsInfoText(row.logisticsInfo,null,null,null,true),exceptionTypeText:({procurement_exception:'采购异常',dispatch_exception:'履约异常',allocation_exception:'配货异常',logistics_exception:'订单异常',outbound_exception:'\u51fa\u5e93\u5f02\u5e38',delivery_exception:'妥投异常'} as Record<string,string>)[row.exception?.type]??'待核查',exceptionReason:row.exception?.reason??null,dispatchStatusText:row.businessStatus?.order==='partial_fulfilled'?'部分履约':({dispatch_missing:'待建发运单',dispatch_pending:'已建单未取号',dispatch_tracking:'已取号未同步',dispatch_cancelled:'已取消',dispatch_synced:'已履约'} as Record<string,string>)[row.dispatchTaskStatus]??'待确认',stockBillStatusText:STOCK_BILL_STATUS_LABELS[row.rawBillStatus??'']??null,rmaNumber:row.rmaCases?.[0]?.number,rmaRawType:row.rmaCases?.[0]?.rawType,rmaType:row.rmaCases?.[0]?.type,rmaRawStatus:row.rmaCases?.[0]?.rawStatus,rmaStage:row.rmaCases?.[0]?.stage,rmaReason:row.rmaCases?.[0]?.reason,refundAmount:row.rmaCases?.[0]?.refundAmount,refundCurrency:row.rmaCases?.[0]?.refundCurrency,associationState:row.rmaAssociation?.state,allocationNumbers:row.allocationDocuments?.map((d:Row)=>d.number).join(' / '),allocationNativeStatuses:row.allocationDocuments?.map((d:Row)=>d.rawAllocationStatus??'unknown').join(' / '),allocationNativeBillStatuses:row.allocationDocuments?.map((d:Row)=>d.rawBillStatus??'unknown').join(' / '),orderNumber:row.orderNumber??row.stockNumber,ownerName:row.owner?.name??null,departmentName:row.department?.name??null,productAmount:row.amountBreakdown?.productAmount??null,shippingFee:row.amountBreakdown?.shippingFee??null,taxFee:row.amountBreakdown?.taxAmount??null,discountFee:row.amountBreakdown?.discountAmount??null,paidAtText:dateText(row.paidAt),buyerPaidAtText:dateText(row.sourceOrderPaidAt),reviewedAtText:dateText(row.reviewedAt),procurementPaidAtText:dateText(row.procurementPaidAt),recipientName:row.shippingRecipient?.name??null,recipientPhone:row.shippingRecipient?.phone??null,recipientEmail:row.shippingRecipient?.email??null,recipientAddress:[row.shippingRecipient?.state,row.shippingRecipient?.city,row.shippingRecipient?.addressLine1,row.shippingRecipient?.addressLine2].filter(Boolean).join(', '),recipientPostalCode:row.shippingRecipient?.postalCode??null,missing:row.dataQuality?.missingFields?.join(', ')})
   exportRowIdentity(sheet.lastRow!,row.id)
   if(returnLines)for(const d of row.purchaseReturns??[])for(const line of d.lines)exportRowIdentity(exportProductRow(returnLines.addRow({...line,orderNumber:row.orderNumber,returnNumber:d.number,billStatusName:d.billStatusName,supplier:d.supplier?.name}),line),row.id)
   for(const item of row.items){const source=sourceExport?item.procurementSource:undefined;exportRowIdentity(exportProductRow(lines.addRow({...item,orderNumber:row.orderNumber??row.stockNumber,...(source?{sourceState:source.complete?'已核验':'来源数据待补齐',sourceDemand:source.demandQuantity,fullPaymentQuantity:source.complete?source.fullPaymentQuantity:null,depositQuantity:source.complete?source.depositQuantity:null,directQuantity:source.complete?source.directQuantity:null}:{})}),item),row.id)}
  }
  const uniqueOrders=kind==='rma'?result.items:[...new Map(result.items.map(row=>[row.orderNumber??row.stockNumber??row.id,row])).values()]
  sheet.addRow({orderNumber:kind==='rma'?`合计 · ${uniqueOrders.length} 张售后单`:`合计 · ${uniqueOrders.length} 笔订单`})
  const currencies=new Set(uniqueOrders.map(row=>row.currency).filter(Boolean))
  for(const currency of currencies){const orders=uniqueOrders.filter(row=>row.currency===currency),known=orders.filter(row=>row.amount!=null);sheet.addRow({orderNumber:known.length===orders.length?'订单金额合计':`已知金额合计（缺 ${orders.length-known.length} 笔）`,currency,amount:known.length?exactNumber(known.reduce((sum,row)=>sum.plus(row.amount),new Decimal(0)).toString()):null})}
  const notes=wb.addWorksheet('说明');notes.addRow(['采集开始时间 UTC+8',(kind==='stock'?c.batch.metadata.entityCaptures.stock_orders.capturedAt:orderCaptureTime(c.batch))?dateText(new Date(kind==='stock'?c.batch.metadata.entityCaptures.stock_orders.capturedAt:orderCaptureTime(c.batch)).toISOString()):'']);notes.addRow(['模式','已采集只读；空值表示未提供；非一致性快照']);notes.addRow(['批次',c.batch.id]);if(['allocation','allocation_review'].includes(query.queue)&&c.batch.metadata?.entityCaptures?.allocation)notes.addRow(['配货单采集时间 UTC+8',dateText(c.batch.metadata.entityCaptures.allocation.capturedAt)])
  if(kind==='rma'){notes.addRow(['售后商品数量合计',count.totals?.itemQuantity??null]);notes.addRow(['售后单采集时间 UTC+8',dateText(c.batch.metadata.entityCaptures.rma.capturedAt)]);notes.addRow(['覆盖范围','已采集付款客户的部分覆盖；筛选及合计仅针对当前本地权限内已采集售后；不能推定公司业务零']);notes.addRow(['商品口径','商品及数量取售后单本身分录，按售后单汇总，不使用原履约商品数量']);notes.addRow(['关联口径','同公司原单号与店铺唯一匹配，付款客户及原单业务员核验；仅展示营销四部内归属已核验记录'])}
  if(sourceExport)notes.addRow(['采购来源口径','按履约订单＋SKU汇总，重复SKU仅首行填写；备货待使用与已使用为同一耗用数量的不同阶段，未知数量留空。来源数量不代表供应商实际发货数量。'])
  await singleSheetWorkbook(wb,{main:'已采集订单',details:kind==='returns'?['商品明细','退料明细']:['商品明细'],title:kind==='returns'?'采购退货清单':kind==='stock'?'备货清单':kind==='rma'?'RMA售后清单':query.completed?(query.queue==='shipping'?'已出库清单':'已完成清单'):({unpaid:'待支付清单',review:'待审核清单',dispatch:'待履约清单',procurement:'待采购清单',procurement_shipping:'已采购待发货清单',allocation:'未齐套清单',allocation_review:'已齐套未审核清单',shipping:'待出库清单',exceptions:'异常订单清单'} as Record<string,string>)[query.queue]??'待办清单'})
  const buffer=Buffer.from(await wb.xlsx.writeBuffer())
  if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  return buffer
 }
}
