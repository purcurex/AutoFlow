import { warehouseCodes } from './warehouse-codes'
import { comparisonWindows, comparisonStatement, comparisonMetrics } from './analytics-comparison'
import { collectedExceptionPage } from './collected-exception-page'
import { customerRegistrationWindow, verifiedCustomerRegistrationScope } from '../fop-data/collected-customer-registration'
import { withCollectedOrderLogistics } from '../fop-data/collected-actual-channel'
import { logisticsInfoText } from '../fop-data/logistics-info'
import { collectedRmaMoney } from '../fop-data/collected-rma'
import { STOCK_BILL_STATUS_LABELS } from '../fop-data/fop-stock.types'
import { singleSheetWorkbook, exportRowIdentity } from '../workbench-export/single-sheet'
import { collectedProductLines } from './collected-product-display'
import { collectedInboundQuery } from './collected-inbound-query'
import { withOrderBusinessStatus } from '../fop-data/order-business-status'
import { collectedOrganizationQuery } from './collected-organization-query'
import { timestampStatus, publishedTimestampTime } from './timestamp-status'
import { collectedOrderMoney } from '../fop-data/collected-order-money'
import { resolveChartAccess } from '../users/chart-permissions'
import { readCollectedChain } from './collected-chain-query'
import { scopedPurchaseGroup } from '../fop-data/collected-native-facts'
import { collectedAllocationDisplay } from './collected-allocation-query'
import { BadRequestException, NotFoundException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException, PayloadTooLargeException } from '@nestjs/common'
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
import { collectedRmaWhere } from './collected-rma-query'
import { collectedStockWhere } from './collected-stock-query'
import { collectedWhere } from './collected-workbench-query'
import { collectReplicaPages } from './collect-replica-pages'
import { analyticsWindow, collectedAnalyticsQuery, ANALYTICS_QUEUES } from './collected-analytics-query'
import { collectedAnalyticsScope } from './collected-analytics-scope'
import { dashboardAnalyticsQuery } from './dashboard-analytics-query'
import { managerDashboardScope, combineDashboardStatements, withDepartmentSummary } from './manager-dashboard-scope'
import { dimensions, aggregateLocalFreight, localFreightQuery, LocalFreightQueryDto } from './local-freight'
import { DashboardAnalyticsQueryDto, CollectedAnalyticsQueryDto } from './collected-analytics.dto'
type Row=Record<string,any>
type CollectedRow=Row & {items:Row[]}
type CollectedPage={items:CollectedRow[];total:number;page:number;pageSize:number;[key:string]:any}
const exactNumber=(value:unknown):number|null=>{if(value==null)return null;const n=Number(value);return Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER&&new Decimal(String(n)).eq(String(value))?n:null}
const missingDatasets=['allocation','dispatch','procurement','stock_orders','rma','receipt_notices','inventory','interception']
@Injectable()
export class CollectedWorkbenchService {
 constructor(private readonly db:DataSource,private readonly users:UsersService,private readonly config:ConfigService){}
 get enabled(){return this.config.get<string>('WORKBENCH_COLLECTED_ENABLED')==='true'}
 private async productDisplay<T extends Row>(batchId:string,records:T[],field='items'):Promise<T[]>{
  const sets=await collectedProductLines(this.db,batchId,records.map(record=>record[field]??[]))
  return records.map((record,index)=>({...record,[field]:sets[index]}))
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
  const batches:Row[]=await this.db.query("SELECT * FROM hz_fop_collected_batches WHERE workspace_owner_id=$1 AND tenant_id=$2 AND company_id=$3 AND state='active'",[owner,tenant,company])
  if(batches.length!==1)throw new ServiceUnavailableException({code:'workbench_collected_not_initialized',message:'尚无完成入库的 API 采集批次'})
  if(batches[0].metadata?.timestampOwnershipPending&&user.role!=='admin')throw new ServiceUnavailableException({code:'timestamp_ownership_projection_pending',message:'关联归属投影待重算，暂不能按旧归属读取；管理员可核查同步任务。'})
  const nodes=await this.db.query('SELECT id,parent_id,name,kind FROM organization_nodes WHERE owner_user_id=$1 ORDER BY id',[owner])
  const employees=await this.db.query(collectedOrganizationQuery,[owner,tenant,company])
  const org=buildReplicaOrganization(user,owner,nodes,employees,{tenant_id:tenant,source_company_id:company},{managerAnalytics})
  const filter=localEmployeeFilter(org,org.analyticsPeers?{ownerId:query.ownerId}:query),batch=batches[0]
  const signature=JSON.stringify([user.sessionVersion,roles,org.version,user.chartPermissions,batch.id,batch.metadata?.entityCaptures,batch.metadata?.analyticsCaptures,batch.metadata?.timestampSync,batch.metadata?.businessStatusProjection,batch.metadata?.manualApprovalReadbackAt])
  return {user,org,filter,batch,signature,searchOwnerIds:org.members.filter(m=>query.search?.trim()&&m.name.toLowerCase().includes(query.search.trim().toLowerCase())).map(m=>m.employeeId)}
 }
 private metadata(batch:Row,unavailable=false){const timestamp=timestampStatus(batch.metadata?.timestampSync);const revision=batch.id+':'+createHash('sha256').update(JSON.stringify([batch.metadata?.entityCaptures??{},batch.metadata?.moneyCaptureUpdatedAt??null,batch.metadata?.timestampSync??null,batch.metadata?.businessStatusProjection,batch.metadata?.manualApprovalReadbackAt??null])).digest('hex').slice(0,16);const missing=missingDatasets.filter(x=>!batch.metadata?.entityCaptures?.[x]);return {
  source:'fop',refreshedAt:new Date().toISOString(),
  replica:{readMode:'local',datasetId:batch.id,revision,sourceSyncedAt:publishedTimestampTime(batch.metadata?.timestampSync,batch.source_as_of,['hzkj_orders']),dataMode:'collected',complete:false,missingDatasets:missing,...timestamp?{timestampSync:timestamp}:{}},
  dataAvailability:{mode:'collected',complete:false,...(unavailable?{missingDatasets:missing}:{}),reason:unavailable?'此数据集尚未接入，暂时留空；不代表没有业务数据。':timestamp?.projectionPending?'时间增量事实已入库，关联展示投影待完成；有关联快照的工作台仍展示原采集批次，不能视为已刷新到增量水位。':'已采集 API 数据已入本地库；缺失字段留空，下游状态待核查，自动调用已暂停。'},
 }}
 async status(userId:string){
  const c=await this.context(userId),count=await this.db.query(`SELECT count(*)::int AS total FROM hz_fop_collected_orders WHERE batch_id=$1${c.filter.employeeIds===null?'':' AND owner_employee_id = ANY($2::text[])'}`,c.filter.employeeIds===null?[c.batch.id]:[c.batch.id,c.filter.employeeIds])
  return {...this.metadata(c.batch),initialized:true,state:'collected',dataMode:'collected',readMode:'local',paused:true,automaticCallsEnabled:false,syncConfigured:false,nextScheduledAt:null,sourceSyncedAt:publishedTimestampTime(c.batch.metadata?.timestampSync,c.batch.source_as_of,['hzkj_orders','hzkj_alloc_bill','hzkj_deliver_bill','hzkj_deliver_order']),datasetId:c.batch.id,revision:this.metadata(c.batch).replica.revision,collected:{batchId:c.batch.id,sourceAsOf:c.batch.source_as_of,rowCount:count[0].total,pageCount:c.batch.page_count,missingDatasets:this.metadata(c.batch).replica.missingDatasets}}
 }
 async analyticsCacheScope(userId:string){
  // Do not enable chart timers for remote providers or revive suspended FOP calls.
  if(!this.enabled||this.config.get<string>('WORKBENCH_READ_MODE')!=='local')return {cacheable:false}
  const c=await this.context(userId)
  const version=createHash('sha256').update(JSON.stringify(['manager-chart-grants-v1',c.user.id,c.user.sessionVersion,c.user.dataDisplayScope,effectiveWorkbenchRoles(c.user),c.org.version,c.user.chartPermissions,c.batch.id,c.batch.source_as_of,c.batch.metadata?.analyticsCaptures,c.batch.metadata?.entityCaptures,c.batch.metadata?.moneyCaptureUpdatedAt,c.batch.metadata?.timestampSync,c.batch.metadata?.businessStatusProjection,c.batch.metadata?.manualApprovalReadbackAt])).digest('hex')
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
   currencies:result.currencies,warehouses:result.warehouses,warehouseOptions:result.warehouse_options,chartAccess:{...access,canViewDetails:false,canExport:false},
   canViewDetails:false,canExport:false}
 }
 async dashboardShell(userId:string):Promise<Row>{
  if(!this.enabled)throw new ServiceUnavailableException('Local collected mode is not enabled')
  const c=await this.context(userId)
  const chartAccess=resolveChartAccess(c.user)
  const registrationWindow=chartAccess.some(chart=>chart.chartId==='registrations'&&chart.visible)
   ?customerRegistrationWindow(c.batch.metadata?.analyticsCaptures?.registrations,{companyId:c.batch.company_id,tenantId:c.batch.tenant_id}):undefined
  if((await this.context(userId)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  const queues={review:null,dispatch:null,procurement:null,allocation:null,shipping:null}
  return {source:'fop',updatedAt:c.batch.source_as_of,analyticsConfigured:false,localAnalytics:true,chartAccess,registrationWindow,
   queues,queueStates:Object.fromEntries(Object.keys(queues).map(key=>[key,'not_configured'])),tasks:[],integratedQueues:[],
   rates:[],registrations:[],registrationDepartments:[],exceptions:[],
   receipts:{currency:'USD',months:[],departments:[]},departmentReceipts:{currency:'USD',months:[],departments:[]},
   dataAvailability:{mode:'collected',complete:false,reason:'Dashboard按本地订单事实查询，业绩采用订单金额；来源缺失保留空状态。'}}
 }
 async dashboardAnalytics(userId:string,query:DashboardAnalyticsQueryDto):Promise<Row>{
  if(!this.enabled)throw new ServiceUnavailableException('Local analytics is not enabled')
  let window=analyticsWindow(query);const c=await this.context(userId,undefined,query,true)
  const access=resolveChartAccess(c.user).find(p=>p.chartId===query.chartId)
  if(!access?.visible)throw new ForbiddenException('Chart access denied')
  const manager=managerDashboardScope(c.user,c.org,query,query.chartId)
  const scope=manager??collectedAnalyticsScope(c.user,c.org,query,query.chartId)
  if(scope.summaryOnly&&query.warehouseCode)throw new ForbiddenException('Department aggregates only')
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
   customerOwnershipScope:!!manager,recordEmployeeIds:manager?.recordEmployeeIds})
  const q=aggregate(window),prior=periods&&previousCovered?aggregate(periods.previous):undefined
  const mixed=!!manager&&!scope.summaryOnly
  const statement=mixed?combineDashboardStatements([{key:'analytics',...q},...(prior?[{key:'previous',...prior}]:[]),
   {key:'departmentSummary',...aggregate(window,true)},...(prior?[{key:'previousDepartmentSummary',...aggregate(periods!.previous,true)}]:[])]):prior?comparisonStatement(q,prior):q
  const [result]=await this.db.query(statement.sql,statement.params)
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
   departments,defaultDepartmentId,...manager?{personalDepartmentId:manager.personalDepartmentId}:{},window,chartId:query.chartId,summaryOnly:scope.summaryOnly,source:'local',asOf:capture.capturedAt,
   amountBasis:registrations?null:'order_amount',timeBasis:registrations?'customer_created_at':'customer_paid_at',canExport:false,canViewDetails:false}

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
  const asOf={currentOrders:c.batch.source_as_of,...Object.fromEntries(availableEntities.map(entity=>[entity,captures[entity].capturedAt]))}
  const meta=this.metadata(c.batch)
  return {...meta,...rows[0].analytics,window,asOf,nonconsistentSnapshot:true,
   scope:{summaryOnly:scope.summaryOnly,canViewDetails:false,canExport:false,departmentId:query.departmentId??null,ownerFiltered:!!query.ownerId},
   replica:{...meta.replica,revision:c.batch.id+':analytics:'+createHash('sha256').update(JSON.stringify([c.batch.metadata?.entityCaptures,captures])).digest('hex').slice(0,16)},
   dataAvailability:{mode:'collected',complete:false,provesBusinessZero:false,executionAvailable:false,missingDatasets:entityTypes.filter(entity=>!availableEntities.includes(entity)),reason:'仅汇总本地已采集且当前授权范围内的事实；客户付款窗口不限制当前待办。金额及数量保留十进制字符串，未知字段不补零，独立采集非一致快照。'}}
 }
 async orders(userId:string,query:Row,role:WorkbenchRole,unavailable=false):Promise<CollectedPage>{
  const c=await this.context(userId,role,query),page=Math.max(1,Number(query.page)||1),pageSize=Math.min(100,Math.max(1,Number(query.pageSize)||20))
  if(query.queue==='rma')return this.rmaOrders(userId,query,role,c)
  if(unavailable&&query.queue!=='rma')return this.stockOrders(userId,query,role,c)
  const allocationCapture=c.batch.metadata?.entityCaptures?.allocation
  const allocationReady=['allocation','allocation_review'].includes(query.queue)&&['full_company_scan','full_parent_scan'].includes(allocationCapture?.coverage)&&allocationCapture?.companyId===c.batch.company_id
  const nativeCapture=c.batch.metadata?.entityCaptures?.[['procurement','procurement_shipping'].includes(query.queue)?'procurement':query.queue]
  const nativeReady=['dispatch','procurement','procurement_shipping','shipping'].includes(query.queue)&&nativeCapture?.coverage==='full_parent_scan'&&nativeCapture?.companyId===c.batch.company_id
  const downstream=! ['unpaid','review','exceptions','shipping','dispatch'].includes(query.queue)
  if(unavailable||downstream&&!allocationReady&&!nativeReady||query.queue==='shipping'&&!query.completed&&!nativeReady){const result=await this.diagnostic(c,query);if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload');return result}
  const q=collectedWhere(c.batch.id,c.filter.employeeIds,{...query,searchOwnerIds:c.searchOwnerIds})
  const exceptionQuery=query.queue==='exceptions'?collectedExceptionPage(c.batch.id,c.filter.employeeIds,{...query,searchOwnerIds:c.searchOwnerIds},page,pageSize):null
  const exceptionPage=exceptionQuery?(await this.db.query(exceptionQuery.sql,exceptionQuery.params))[0]:null
  const [totals]=exceptionPage?[exceptionPage]:await this.db.query(`SELECT count(*)::int AS total, CASE WHEN count(total_quantity)=count(*) AND count(*)>0 THEN sum(total_quantity) END AS quantity FROM hz_fop_collected_orders WHERE ${q.where}`,q.params)
  const projection=allocationReady?collectedAllocationDisplay(!!query.completed,query.queue==='allocation_review'):query.queue==='shipping'?"display || jsonb_build_object('logisticsInfo',display->'warehouseLogistics')":query.queue==='dispatch'?"display || jsonb_build_object('logisticsInfo',display->'dispatchLogistics')":'display'
  const purchaseHeader=query.queue==='dispatch'&&query.completed?` || coalesce((SELECT jsonb_build_object('sourcePurchaseStatus',a.raw->>'hzkj_purchase_status','sourcePurchaseStatusName',a.raw->>'hzkj_purchase_status_title') FROM hz_fop_collected_analytics_facts a WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.source_id=hz_fop_collected_orders.source_id AND a.entity_type='fulfillment' AND a.company_id=(SELECT company_id FROM hz_fop_collected_batches WHERE id=a.batch_id) AND a.document_number=hz_fop_collected_orders.order_number AND a.raw->>'hzkj_orderstatus'=hz_fop_collected_orders.raw_order_status AND a.facts->'scope'->>'verified'='true' AND a.captured_at >= (SELECT source_as_of FROM hz_fop_collected_batches WHERE id=a.batch_id) AND a.raw ? 'hzkj_purchase_status'), '{}'::jsonb)` : ''
  const rows:Row[]=exceptionPage?exceptionPage.rows:query.projection==='count'?[]:await this.db.query(`SELECT ${projection}${purchaseHeader} AS display,raw FROM hz_fop_collected_orders WHERE ${q.where} ORDER BY ${q.orderBy} LIMIT $${q.params.length+1} OFFSET $${q.params.length+2}`,[...q.params,pageSize,(page-1)*pageSize])
  const countryQuery=collectedWhere(c.batch.id,c.filter.employeeIds,{...query,searchOwnerIds:c.searchOwnerIds,shippingCountryCode:undefined})
  const countries:Row[]=exceptionPage?exceptionPage.countries.map((country_code:string)=>({country_code})):await this.db.query(`SELECT DISTINCT country_code FROM hz_fop_collected_orders WHERE ${countryQuery.where} AND country_code IS NOT NULL ORDER BY country_code`,countryQuery.params)
  if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  const sourceSyncedAt=publishedTimestampTime(c.batch.metadata?.timestampSync,(nativeCapture??allocationCapture)?.capturedAt??c.batch.source_as_of,['hzkj_orders',...(['dispatch','shipping','allocation','allocation_review'].includes(query.queue)?['hzkj_deliver_bill']:[]),...(['shipping','allocation','allocation_review'].includes(query.queue)?['hzkj_alloc_bill']:[])])
  return {...this.metadata(c.batch),...((nativeReady||allocationReady)?{replica:{...this.metadata(c.batch).replica,sourceSyncedAt}}:{}),...(allocationReady?{dataAvailability:{mode:'collected',complete:false,queueAvailable:true,capturedAt:allocationCapture.capturedAt,reason:'按完整履约扫描关联的有效配货单的原生齐套及审核状态展示；非一致快照，执行前仍需实时核验。'}}:{}),...(nativeReady?{dataAvailability:{mode:'collected',complete:false,queueAvailable:true,capturedAt:nativeCapture.capturedAt,coverage:'full_parent_scan',executionAvailable:false,reason:'已采集完整履约扫描关联事实，本地按当前权限分类；不代表独立单据公司全集。未知状态保留核查，缺失字段留空。'}}:{}),...(query.queue==='shipping'?{dataAvailability:{mode:'collected',complete:false,queueAvailable:true,missingFields:query.completed?['dispatchDocuments']:['shipmentInterceptStatus','dispatchDocuments'],reason:query.completed?'按本单原生已出库状态展示；缺失物流关联留空。':'按真实已齐套且已审核配货单、有效审核发运单关联展示待出库；拦截状态未知，执行仍须 FOP 实时门禁。'}}:{}),items:await this.productDisplay(c.batch.id,rows.map(row=>localOwnership(withOrderBusinessStatus(withCollectedOrderLogistics(collectedOrderMoney(row.display,row.raw,c.batch.company_id),row.raw,c.batch.company_id,query),row.raw),c.org) as CollectedRow)),total:totals.total,page,pageSize,queueState:'ready',departments:localDepartments(c.org),salespeople:localSalespeople(c.org,query),shippingCountries:countries.map(row=>row.country_code),totals:{orderCount:totals.total,itemQuantity:exactNumber(totals.quantity),amountsByCurrency:[],complete:false}}
 }
 async rmaDetail(userId:string,caseId:string){
  if(typeof caseId!=='string'||!caseId.trim()||caseId.length>128)throw new BadRequestException('Invalid RMA case ID')
  const result=await this.orders(userId,{queue:'rma',rmaFlowStatus:'all',caseId,page:1,pageSize:20},'sales',true)
  if(!result.dataAvailability.queueAvailable)throw new ServiceUnavailableException('RMA capture is not available')
  if(result.total!==1||result.items.length!==1)throw new NotFoundException('RMA case not found in current local scope')
  const {items,...metadata}=result;return {...metadata,item:items[0]}
 }
 private async rmaOrders(userId:string,query:Row,role:WorkbenchRole,c:Awaited<ReturnType<CollectedWorkbenchService['context']>>):Promise<CollectedPage>{
  const capture=c.batch.metadata?.entityCaptures?.rma
  if(!capture||capture.companyId!==c.batch.company_id){const result=await this.diagnostic(c,query);if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload');return result}
  const q=collectedRmaWhere(c.batch.id,c.filter.employeeIds,{...query,searchOwnerIds:c.searchOwnerIds,includeAssociationExceptions:c.user.role==='admin'}),page=Math.max(1,Number(query.page)||1),pageSize=Math.min(100,Math.max(1,Number(query.pageSize)||20))
  const [counts]=await this.db.query(`SELECT count(*)::int AS total,count(DISTINCT display->>'sourceOrderId')::int AS order_count FROM hz_fop_collected_entities WHERE ${q.where}`,q.params)
  // Parent amount and SKU totals are counted once when multiple RMA cases share a source order.
  const parents=`SELECT DISTINCT ON (display->>'sourceOrderId') display FROM hz_fop_collected_entities WHERE ${q.where} AND display->'rmaAssociation'->>'state'='verified' ORDER BY display->>'sourceOrderId',source_id`
  const monies:Row[]=await this.db.query(`SELECT display->>'currency' AS currency,CASE WHEN count(display->>'amount')=count(*) THEN sum((display->>'amount')::numeric)::text END AS amount FROM (SELECT display FROM hz_fop_collected_entities WHERE ${q.where}) scoped GROUP BY display->>'currency'`,q.params)
  const [quantity]=await this.db.query(`SELECT CASE WHEN count(*)>0 AND count(line->>'quantity')=count(*) THEN sum((line->>'quantity')::numeric)::text END AS quantity FROM (${parents}) scoped CROSS JOIN LATERAL jsonb_array_elements(display->'items') line`,q.params)
  const rows:Row[]=query.projection==='count'?[]:await this.db.query(`SELECT display,raw->'case' AS raw FROM hz_fop_collected_entities WHERE ${q.where} ORDER BY ${q.orderBy} LIMIT $${q.params.length+1} OFFSET $${q.params.length+2}`,[...q.params,pageSize,(page-1)*pageSize])
  if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  const meta=this.metadata(c.batch)
  return {...meta,replica:{...meta.replica,sourceSyncedAt:capture.capturedAt},items:await this.productDisplay(c.batch.id,rows.map(row=>localOwnership(collectedRmaMoney(row.display,row.raw),c.org) as CollectedRow)),total:counts.total,page,pageSize,queueState:'ready',departments:localDepartments(c.org),salespeople:localSalespeople(c.org,query),shippingCountries:[],totals:{caseCount:counts.total,orderCount:counts.order_count,itemQuantity:exactNumber(quantity.quantity),amountsByCurrency:monies.filter(m=>m.currency&&exactNumber(m.amount)!==null).map(m=>({currency:m.currency,amount:exactNumber(m.amount)})),complete:false},dataAvailability:{mode:'collected',complete:false,queueAvailable:true,capturedAt:capture.capturedAt,coverage:capture.coverage,provesBusinessZero:false,executionAvailable:false,reason:'已采集付款客户范围内的真实售后单；当前为部分客户覆盖，计数仅指当前权限和筛选内已采集记录，不代表公司全部售后或业务零。仅展示业务归属已核验的记录，自动调用暂停，执行仍须 FOP 实时接口。'}}
 }
 private async stockOrders(userId:string,query:Row,role:WorkbenchRole,c:Awaited<ReturnType<CollectedWorkbenchService['context']>>):Promise<CollectedPage>{
  const q=collectedStockWhere(c.batch.id,c.filter.employeeIds,{...query,searchOwnerIds:c.searchOwnerIds}),page=Math.max(1,Number(query.page)||1),pageSize=Math.min(100,Math.max(1,Number(query.pageSize)||20))
  const table=await this.db.query("SELECT to_regclass('public.hz_fop_collected_entities') AS name")
  if(!table[0].name)return this.empty(c,query)
  const initialized=c.batch.metadata?.entityCaptures?.stock_orders
  if(!initialized)return this.empty(c,query)
  const totals=await this.db.query(`SELECT count(*)::int AS total FROM hz_fop_collected_entities WHERE ${q.where}`,q.params)
  const warehouses=await this.db.query(`SELECT DISTINCT display->>'warehouseCode' AS code,display->>'warehouse' AS name FROM hz_fop_collected_entities WHERE ${q.where} ORDER BY code`,q.params)
  const aggregates=await this.db.query(`SELECT display->>'currency' AS currency,CASE WHEN count(display->>'amount')=count(*) AND count(display->>'currency')=count(*) THEN sum((display->>'amount')::numeric)::text END AS amount FROM hz_fop_collected_entities WHERE ${q.where} GROUP BY display->>'currency'`,q.params)
  const [quantity]=await this.db.query(`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM hz_fop_collected_entities WHERE ${q.where} AND display->'dataQuality'->'missingFields' ? 'items') AND count(line->>'quantity')=count(*) THEN sum((line->>'quantity')::numeric)::text END AS quantity FROM hz_fop_collected_entities CROSS JOIN LATERAL jsonb_array_elements(display->'items') line WHERE ${q.where}`,q.params)
  const rows=query.projection==='count'?[]:await this.db.query(`SELECT display FROM hz_fop_collected_entities WHERE ${q.where} ORDER BY ${q.orderBy} LIMIT $${q.params.length+1} OFFSET $${q.params.length+2}`,[...q.params,pageSize,(page-1)*pageSize])
  if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  const meta=this.metadata(c.batch)
  return {...meta,replica:{...meta.replica,sourceSyncedAt:initialized.capturedAt},items:await this.productDisplay(c.batch.id,rows.map((r:Row)=>localOwnership(r.display,c.org) as CollectedRow)),total:totals[0].total,page,pageSize,queueState:'ready',departments:localDepartments(c.org),salespeople:localSalespeople(c.org,query),warehouses,totals:{orderCount:totals[0].total,itemQuantity:exactNumber(quantity.quantity),amounts:aggregates.map((a:Row)=>({currency:a.currency,amount:exactNumber(a.amount)})),complete:quantity.quantity!==null&&aggregates.every((a:Row)=>a.amount!==null&&a.currency!==null)},dataAvailability:{mode:'collected',complete:false,reason:'备货订单已采集入库；缺失字段留空，自动调用已暂停。',capturedAt:initialized.capturedAt}}
 }
 private async diagnostic(c:Awaited<ReturnType<CollectedWorkbenchService['context']>>,query:Row){
  const gaps:Record<string,string[]>={procurement:['hzkj_purchase_status','stock_usage_requires_procurement'],procurement_shipping:['hzkj_purchase_status'],shipping:['allocationDocument','allocationReview','stockReadiness','shipmentInterceptStatus'],dispatch:['dispatchDocuments','hzkj_delivery_status'],allocation:['allocationDocument','hzkj_alloc_status'],allocation_review:['allocationDocument','billstatus'],rma:['rma_cases','salesperson_or_verified_parent_relation'],purchase_returns:['physical_purchase_return_entity'],receipt_notices:['receipt_notice_entity','receipt_notice_status'],procurement_groups:['purchase_entity','authorized_fulfillment_relations']}
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
 private empty(c:Awaited<ReturnType<CollectedWorkbenchService['context']>>,query:Row){return {...this.metadata(c.batch,true),items:[],total:0,page:Number(query.page)||1,pageSize:Number(query.pageSize)||20,queueState:'ready',departments:localDepartments(c.org),salespeople:localSalespeople(c.org,query),warehouses:[],shippingCountries:[],totals:{orderCount:0,itemQuantity:null,amountsByCurrency:[],amounts:[],quantity:null,inboundQuantity:null,pendingQuantity:null,groupCount:null,purchaseCount:null,uncreatedCount:null,complete:false}}}
 async receiptNotices(userId:string,query:Row){
  const c=await this.context(userId,'warehouse',query),capture=c.batch.metadata?.entityCaptures?.receipt_notices
  if(!capture||capture.companyId!==c.batch.company_id)return this.unavailable(userId,{...query,queue:'receipt_notices'},'warehouse')
  const q=collectedInboundQuery(c.batch.id,c.filter.employeeIds,{...query,searchOwnerIds:c.searchOwnerIds})
  const warehouses=await this.db.query(`SELECT CASE warehouse_code WHEN '01' THEN 'HZ' WHEN 'HNDGLB' THEN 'SZ' ELSE warehouse_code END code,max(display->>'warehouse') name FROM hz_fop_collected_orders WHERE batch_id=$1 AND ($2::text[] IS NULL OR owner_employee_id=ANY($2)) AND warehouse_code IS NOT NULL GROUP BY 1 ORDER BY 1`,[c.batch.id,c.filter.employeeIds])
  const page=Math.max(1,Number(query.page)||1),pageSize=Math.min(100,Math.max(1,Number(query.pageSize)||20))
  const [count]=await this.db.query(`${q.cte} SELECT count(*)::int total ${q.from}`,q.params)
  const rows:Row[]=await this.db.query(`${q.cte} SELECT o.display,o.raw,n.notices,n.status ${q.from} ORDER BY o.paid_at DESC NULLS LAST,o.source_id LIMIT $${q.params.length+1} OFFSET $${q.params.length+2}`,[...q.params,pageSize,(page-1)*pageSize])
  if((await this.context(userId,'warehouse',query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  const items=rows.map(row=>{
   const order=localOwnership(collectedOrderMoney(row.display,row.raw,c.batch.company_id),c.org)
   return {...order,number:order.orderNumber,noticeNumbers:row.notices.map((n:Row)=>n.number),status:row.status,lines:order.items,quantity:order.items.every((i:Row)=>i.quantity!=null)?order.items.reduce((n:number,i:Row)=>n+i.quantity,0):null,inboundQuantity:null,pendingQuantity:null,supplier:null,shippedAt:null,carrier:null,trackingNumber:null}
  })
  return {...this.metadata(c.batch),items:await this.productDisplay(c.batch.id,items,'lines'),total:count.total,page,pageSize,view:'fulfillment',departments:localDepartments(c.org),warehouses,totals:{quantity:null,inboundQuantity:null,pendingQuantity:null},dataAvailability:{mode:'collected',complete:false,queueAvailable:true,capturedAt:capture.capturedAt,executionAvailable:false,missingFields:['inboundQuantity'],reason:'按收货通知分录关联履约订单，以本地履约分录原生已入库状态排除完成数据；缺失关联或状态不计入待入库，数量未知保留空值。'}}
 }

 async purchaseGroups(userId:string,query:Row,groupId?:string):Promise<any>{
  const c=await this.context(userId,'procurement',query),capture=c.batch.metadata?.entityCaptures?.procurement_groups
  if(!capture||capture.companyId!==c.batch.company_id)return this.unavailable(userId,{...query,queue:'procurement_groups'},'procurement',groupId)
  const params:unknown[]=[c.batch.id],permission=c.filter.employeeIds===null?'':` AND display->'association'->>'state' IS DISTINCT FROM 'conflict' AND EXISTS(SELECT 1 FROM jsonb_array_elements(display->'rows') r WHERE r->>'ownerEmployeeId'=ANY($2::text[]))`;if(c.filter.employeeIds!==null)params.push(c.filter.employeeIds)
  const source:Row[]=await this.db.query(`SELECT display FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type IN ('purchase','purchase_demand')${permission}`,params)
  let all=source.map(r=>scopedPurchaseGroup(r.display,c.filter.employeeIds)).filter(g=>g.rows.length>0||c.filter.employeeIds===null)
  const productRows=await this.productDisplay(c.batch.id,all.flatMap(g=>g.rows),'lines');let productRowIndex=0
  all=all.map(g=>scopedPurchaseGroup({...g,rows:g.rows.map(()=>productRows[productRowIndex++])},null))
  for(const g of all)g.rows=g.rows.map((r:Row)=>{const local:Row=localOwnership({owner:{id:r.ownerEmployeeId,name:r.ownerName}},c.org);return{...r,ownerName:local.owner?.name??null,departmentName:local.department?.name??null}})
  const unclassifiedCount=all.filter(g=>g.stage==='unknown'||g.association?.state==='conflict').length
  all=all.filter(g=>query.purchaseStage==='unknown'?g.stage==='unknown'||g.association?.state==='conflict':g.association?.state!=='conflict'&&(query.completed?g.stage==='shipped':query.queue==='procurement_shipping'?['supplier_pending','supplier_partial'].includes(g.stage):['uncreated','placement_pending','payment_pending','refund_pending'].includes(g.stage)))
  if(query.purchaseStage&&query.purchaseStage!=='unknown')all=all.filter(g=>g.stage===query.purchaseStage)
  if(query.search?.trim()){const term=query.search.trim().toLowerCase();all=all.filter(g=>[g.purchase?.number,g.purchase?.platformOrderNumber,g.purchase?.supplier?.name,...g.rows.flatMap((r:Row)=>[r.orderNumber,r.customerName,r.storeName,r.ownerName,...r.lines.map((l:Row)=>l.sku)])].some(v=>typeof v==='string'&&v.toLowerCase().includes(term)))}
  if(query.warehouseCode)all=all.filter(g=>g.rows.some((r:Row)=>warehouseCodes(query.warehouseCode).includes(r.warehouseCode)))
  const days:Row={'1w':7,'1m':30,'3m':90};if(days[query.timeRange])all=all.filter(g=>g.latestConsumerPaidAt&&Date.parse(g.latestConsumerPaidAt)>=Date.now()-days[query.timeRange]*86400000)
  if(query.mode==='selected')all=all.filter(g=>query.groupIds?.includes(g.id))
  all.sort((a,b)=>((a.latestConsumerPaidAt??'').localeCompare(b.latestConsumerPaidAt??'')||a.id.localeCompare(b.id))*(query.sortOrder==='asc'?1:-1))
  const page=Math.max(1,Number(query.page)||1),pageSize=Math.min(100,Number(query.pageSize)||50),meta={...this.metadata(c.batch),replica:{...this.metadata(c.batch).replica,sourceSyncedAt:capture.capturedAt},departments:localDepartments(c.org),salespeople:localSalespeople(c.org,query),page,pageSize,dataAvailability:{mode:'collected',complete:false,queueAvailable:true,capturedAt:capture.capturedAt,coverage:capture.coverage,unclassifiedCount,executionAvailable:false,reason:'已采集履约关联采购单；按本地权限先裁剪关联行再汇总。供应商发货量未提供时留空，状态未知的单据可选择“待核查”查看，不计为采购完成。'}}
  if((await this.context(userId,'procurement',query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  if(groupId){const group=all.find(g=>g.id===groupId);if(!group)throw new NotFoundException('Purchase group not found in current result');return{...meta,group:{...group,rows:undefined},items:group.rows.slice((page-1)*pageSize,page*pageSize),total:group.rows.length}}
  return{...meta,items:query.projection==='count'?[]:all.slice((page-1)*pageSize,page*pageSize).map(g=>({...g,rows:undefined})),total:all.length,totals:{groupCount:all.length,purchaseCount:all.filter(g=>g.kind==='purchase').length,orderCount:new Set(all.flatMap(g=>g.rows.map((r:Row)=>r.orderId))).size,uncreatedCount:all.filter(g=>g.kind==='uncreated').length,pendingQuantity:null}}
 }
 private async exportPurchaseGroups(userId:string,query:Row,version:number):Promise<Buffer>{
  const c=await this.context(userId,'procurement',query);if((c.user.sessionVersion??0)!==version)throw new UnauthorizedException('Session expired')
  if(!['filtered','selected'].includes(query.mode)||query.mode==='selected'&&(!Array.isArray(query.groupIds)||!query.groupIds.length||query.groupIds.length>100||new Set(query.groupIds).size!==query.groupIds.length)||query.mode==='filtered'&&query.groupIds!==undefined)throw new BadRequestException('Invalid export selection')
  const count=await this.purchaseGroups(userId,{...query,projection:'count'});if(count.total>10000)throw new PayloadTooLargeException('单次最多导出 10,000 张采购单')
  const result=await collectReplicaPages<any>(page=>this.purchaseGroups(userId,{...query,page,pageSize:100}));if(query.mode==='selected'&&result.items.length!==query.groupIds.length)throw new ForbiddenException('Selection outside current result')
  const wb=new Workbook(),sheet=wb.addWorksheet('采购单');sheet.columns=[['采购单号','number'],['供应商','supplier'],['采购渠道','purchaseType'],['平台单号','platformOrderNumber'],['支付状态','payment'],['下单状态','placement'],['供应商发货状态','shipment'],['履约笔数','orderCount'],['SKU数','skuCount'],['采购数量','quantity'],['供应商发货数量','shippedQuantity'],['未发数量','pendingQuantity']].map(([header,key])=>({header,key,width:24}));const lines=wb.addWorksheet('授权关联明细');lines.columns=[['采购单号','purchaseNumber'],['履约单号','orderNumber'],['业务员','ownerName'],['SKU','sku'],['商品名称','name'],['规格','variant'],['商品图片','imageUrl'],['数量','quantity'],['供应商发货数量','shippedQuantity']].map(([header,key])=>({header,key,width:24}));let lineCount=0
  for(const g of result.items){sheet.addRow({...g,...g.purchase,supplier:g.purchase?.supplier?.name??null});const details=await collectReplicaPages<any>(page=>this.purchaseGroups(userId,{...query,page,pageSize:100},g.id));for(const r of details.items)for(const l of r.lines){if(++lineCount>50000)throw new PayloadTooLargeException('单次最多导出 50,000 条明细');lines.addRow({...l,purchaseNumber:g.purchase?.number,orderNumber:r.orderNumber,ownerName:r.ownerName})}}
  const notes=wb.addWorksheet('说明');notes.addRow(['模式','已采集履约关联覆盖，非一致快照；未知字段留空；仅含当前本地权限内明细与合计']);notes.addRow(['采集时间',c.batch.metadata.entityCaptures.procurement_groups.capturedAt]);await singleSheetWorkbook(wb,{main:'采购单',details:['授权关联明细']});const buffer=Buffer.from(await wb.xlsx.writeBuffer());if((await this.context(userId,'procurement',query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload');return buffer
 }
 async unavailable(userId:string,query:Row,role:WorkbenchRole,groupId?:string){const c=await this.context(userId,role,query);const result=await this.diagnostic(c,{...query,queue:groupId?'procurement_groups':query.queue??(role==='warehouse'?'receipt_notices':'purchase_returns')});if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload');return {...result,...(groupId?{group:null}:{})}}
 async export(userId:string,query:Row,version:number,kind:string):Promise<Buffer>{
  if(kind==='groups')return this.exportPurchaseGroups(userId,query,version)
  const role=kind==='orders'?FULFILLMENT_QUEUE_ROLES[query.queue as keyof typeof FULFILLMENT_QUEUE_ROLES]:kind==='stock'?query.queue==='procurement'?'procurement':'sales':kind==='rma'?'sales':kind==='returns'?query.workbenchRole:'procurement'
  if(!role)throw new BadRequestException('Invalid queue')
  const c=await this.context(userId,role,query)
  if((c.user.sessionVersion??0)!==version)throw new UnauthorizedException('Session expired')
  const selectionIds=kind==='rma'?query.caseIds:query.orderIds
  if(!['selected','filtered'].includes(query.mode)||query.mode==='selected'&&(!Array.isArray(selectionIds)||!selectionIds.length||selectionIds.length>100||new Set(selectionIds).size!==selectionIds.length)||query.mode==='filtered'&&selectionIds!==undefined)throw new BadRequestException('Invalid export selection')
  if(!['orders','stock','rma'].includes(kind))throw new ServiceUnavailableException('该数据集尚未接入，无法导出')
  const read=(q:Row)=>this.orders(userId,kind==='rma'?{...q,queue:'rma'}:q,role,kind==='stock')
  const count=await read({...query,projection:'count'})
  if(count.total>10000)throw new PayloadTooLargeException('单次最多导出 10,000 笔订单，请缩小筛选范围')
  const result=await collectReplicaPages<any>(page=>read({...query,page,pageSize:100,projection:undefined}))
  if(query.mode==='selected'&&(result.items.length!==selectionIds.length||result.items.some(row=>!selectionIds.includes(row.id))))throw new ForbiddenException('Selection outside current result')
  if(result.items.reduce((n,row)=>n+row.items.length,0)>50000)throw new PayloadTooLargeException('单次最多导出 50,000 条商品明细，请缩小范围')
  const wb=new Workbook(),sheet=wb.addWorksheet('已采集订单')
  const columns=[['订单号','orderNumber',30],['Shopify单号','shopifyOrderNumber',22],['客户','customerName',25],['店铺','storeName',25],['业务员','ownerName',20],['部门','departmentName',20],['仓库','warehouse',20],['国家','shippingCountryCode',12],['商品金额','productAmount',18],['订单总金额','amount',18],['结算币种','currency',15],['运费','shippingFee',18],['税费','taxFee',18],['优惠','discountFee',18],['付款状态','paymentStatus',16],['审核状态','reviewStatus',16],['已取消','cancelled',12],['客户付款时间 UTC+8','paidAtText',26],['C端付款时间 UTC+8','buyerPaidAtText',26],['审核时间 UTC+8','reviewedAtText',26],['收件人','recipientName',25],['联系电话','recipientPhone',22],['电子邮箱','recipientEmail',28],['收件地址','recipientAddress',48],['邮编','recipientPostalCode',16],['自定义渠道','customLogisticsChannelName',28],['待接入字段','missing',65]]
  if(['allocation','allocation_review'].includes(query.queue))columns.push(['配货单号','allocationNumbers',32],['配货原生齐套状态','allocationNativeStatuses',26],['配货原生审核状态','allocationNativeBillStatuses',26])
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
  const dateText=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(Date.parse(value)+8*3600_000).toISOString().slice(0,19).replace('T',' '):null
  for(const row of result.items){
   sheet.addRow({...row,actualChannelNames:[...new Set((row.logisticsChannels??[]).map((channel:Row)=>channel.name?.trim()).filter(Boolean))].join(' / ')||null,actualLogisticsText:logisticsInfoText(row.logisticsInfo,null,null,null,true),exceptionTypeText:({procurement_exception:'采购退货',dispatch_exception:'发运异常',allocation_exception:'配货超时',logistics_exception:'物流异常',delivery_exception:'妥投异常'} as Record<string,string>)[row.exception?.type]??'待核查',exceptionReason:row.exception?.reason??null,dispatchStatusText:row.businessStatus?.order==='partial_fulfilled'?'部分履约':({dispatch_pending:'未取号',dispatch_tracking:'已取号未同步',dispatch_cancelled:'已取消',dispatch_synced:'已履约'} as Record<string,string>)[row.dispatchTaskStatus]??'待确认',stockBillStatusText:STOCK_BILL_STATUS_LABELS[row.rawBillStatus??'']??null,rmaNumber:row.rmaCases?.[0]?.number,rmaRawType:row.rmaCases?.[0]?.rawType,rmaType:row.rmaCases?.[0]?.type,rmaRawStatus:row.rmaCases?.[0]?.rawStatus,rmaStage:row.rmaCases?.[0]?.stage,rmaReason:row.rmaCases?.[0]?.reason,refundAmount:row.rmaCases?.[0]?.refundAmount,refundCurrency:row.rmaCases?.[0]?.refundCurrency,associationState:row.rmaAssociation?.state,allocationNumbers:row.allocationDocuments?.map((d:Row)=>d.number).join(' / '),allocationNativeStatuses:row.allocationDocuments?.map((d:Row)=>d.rawAllocationStatus??'unknown').join(' / '),allocationNativeBillStatuses:row.allocationDocuments?.map((d:Row)=>d.rawBillStatus??'unknown').join(' / '),orderNumber:row.orderNumber??row.stockNumber,ownerName:row.owner?.name??null,departmentName:row.department?.name??null,productAmount:row.amountBreakdown?.productAmount??null,shippingFee:row.amountBreakdown?.shippingFee??null,taxFee:row.amountBreakdown?.taxAmount??null,discountFee:row.amountBreakdown?.discountAmount??null,paidAtText:dateText(row.paidAt),buyerPaidAtText:dateText(row.sourceOrderPaidAt),reviewedAtText:dateText(row.reviewedAt),procurementPaidAtText:dateText(row.procurementPaidAt),recipientName:row.shippingRecipient?.name??null,recipientPhone:row.shippingRecipient?.phone??null,recipientEmail:row.shippingRecipient?.email??null,recipientAddress:[row.shippingRecipient?.state,row.shippingRecipient?.city,row.shippingRecipient?.addressLine1,row.shippingRecipient?.addressLine2].filter(Boolean).join(', '),recipientPostalCode:row.shippingRecipient?.postalCode??null,missing:row.dataQuality?.missingFields?.join(', ')})
   exportRowIdentity(sheet.lastRow!,row.id)
   for(const item of row.items)exportRowIdentity(lines.addRow({...item,orderNumber:row.orderNumber??row.stockNumber}),row.id)
  }
  const uniqueOrders=kind==='rma'?result.items:[...new Map(result.items.map(row=>[row.orderNumber??row.stockNumber??row.id,row])).values()]
  sheet.addRow({orderNumber:`合计 · ${uniqueOrders.length} 笔订单`})
  const currencies=new Set(uniqueOrders.map(row=>row.currency).filter(Boolean))
  for(const currency of currencies){const orders=uniqueOrders.filter(row=>row.currency===currency),known=orders.filter(row=>row.amount!=null);sheet.addRow({orderNumber:known.length===orders.length?'订单金额合计':`已知金额合计（缺 ${orders.length-known.length} 笔）`,currency,amount:known.length?exactNumber(known.reduce((sum,row)=>sum.plus(row.amount),new Decimal(0)).toString()):null})}
  const notes=wb.addWorksheet('说明');notes.addRow(['采集开始时间 UTC+8',dateText(new Date(kind==='stock'?c.batch.metadata.entityCaptures.stock_orders.capturedAt:c.batch.source_as_of).toISOString())]);notes.addRow(['模式','已采集只读；空值表示未提供；非一致性快照']);notes.addRow(['批次',c.batch.id]);if(['allocation','allocation_review'].includes(query.queue)&&c.batch.metadata?.entityCaptures?.allocation)notes.addRow(['配货单采集时间 UTC+8',dateText(c.batch.metadata.entityCaptures.allocation.capturedAt)])
  if(kind==='rma'){notes.addRow(['售后单采集时间 UTC+8',dateText(c.batch.metadata.entityCaptures.rma.capturedAt)]);notes.addRow(['覆盖范围','已采集付款客户的部分覆盖；筛选及合计仅针对当前本地权限内已采集售后；不能推定公司业务零']);notes.addRow(['关联口径','同公司原单号与店铺唯一匹配，付款客户及原单业务员核验；仅展示营销四部内归属已核验记录'])}
  await singleSheetWorkbook(wb,{main:'已采集订单',details:['商品明细']})
  const buffer=Buffer.from(await wb.xlsx.writeBuffer())
  if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  return buffer
 }
}
