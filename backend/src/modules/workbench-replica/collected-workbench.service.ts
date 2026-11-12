import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException, PayloadTooLargeException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import Decimal from 'decimal.js'
import { Workbook } from 'exceljs'
import { UsersService } from '../users/users.service'
import { businessScope } from '../users/business-scope'
import { WORKBENCH_ROLES, WorkbenchRole } from '../users/workbench-role'
import { FULFILLMENT_QUEUE_ROLES } from '../users/dto/workbench.dto'
import { buildReplicaOrganization } from './local-workbench-organization'
import { localDepartments, localEmployeeFilter, localOwnership, localSalespeople } from '../fop-data/local-workbench-scope'
import { collectedWhere } from './collected-workbench-query'
import { collectReplicaPages } from './collect-replica-pages'
type Row=Record<string,any>
type CollectedRow=Row & {items:Row[]}
type CollectedPage={items:CollectedRow[];total:number;page:number;pageSize:number;[key:string]:any}
const exactNumber=(value:unknown):number|null=>{if(value==null)return null;const n=Number(value);return Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER&&new Decimal(String(n)).eq(String(value))?n:null}
const missingDatasets=['allocation','dispatch','procurement','stock_orders','rma','receipt_notices','inventory','interception']
@Injectable()
export class CollectedWorkbenchService {
 constructor(private readonly db:DataSource,private readonly users:UsersService,private readonly config:ConfigService){}
 get enabled(){return this.config.get<string>('WORKBENCH_COLLECTED_ENABLED')==='true'}
 private async context(userId:string,role?:WorkbenchRole,query:Row={}){
  const user=await this.users.findById(userId)
  if(!user||user.accountDisabled)throw new UnauthorizedException()
  const business=businessScope(user)
  if(business.role==='none')throw new ForbiddenException()
  const roles=user.role==='admin'||business.role==='admin'?[...WORKBENCH_ROLES]:user.workbenchRoles??[]
  if(role&&!roles.includes(role))throw new ForbiddenException('Workbench access denied')
  const linked:Row[]=await this.db.query('SELECT owner_user_id,archived_at FROM organization_employees WHERE account_id=$1 LIMIT 2',[userId])
  if(linked.length>1||linked[0]?.archived_at||linked[0]&&user.organizationWorkspaceOwnerId&&linked[0].owner_user_id!==user.organizationWorkspaceOwnerId)throw new ForbiddenException('Invalid local organization assignment')
  const owner=linked[0]?.owner_user_id??user.organizationWorkspaceOwnerId??(user.role==='admin'?user.id:null)
  if(!owner)throw new ForbiddenException('Local organization required')
  const tenant=this.config.get<string>('FOP_REPLICA_TENANT_ID'),company=this.config.get<string>('FOP_REPLICA_COMPANY_ID')
  if(!tenant||!company)throw new ServiceUnavailableException('Collected source scope is not configured')
  const batches:Row[]=await this.db.query("SELECT * FROM hz_fop_collected_batches WHERE workspace_owner_id=$1 AND tenant_id=$2 AND company_id=$3 AND state='active'",[owner,tenant,company])
  if(batches.length!==1)throw new ServiceUnavailableException({code:'workbench_collected_not_initialized',message:'尚无完成入库的 API 采集批次'})
  const nodes=await this.db.query('SELECT id,parent_id,name,kind FROM organization_nodes WHERE owner_user_id=$1 ORDER BY id',[owner])
  const employees=await this.db.query(`SELECT e.id,e.department_id,e.account_id,e.name,e.archived_at,u.account_disabled,u.fop_tenant_id,u.fop_binding_details,
   b.id AS binding_id,(b.enabled AND c.status='active' AND co.enabled) AS binding_enabled,b.state AS binding_state,
   b.employee_master_id,b.person_record_id,b.employee_number,b.directory_verified_at
   FROM organization_employees e LEFT JOIN users u ON u.id=e.account_id
   LEFT JOIN hz_fop_connections c ON c.workspace_owner_id=e.owner_user_id AND c.tenant_id=$2
     AND EXISTS(SELECT 1 FROM hz_fop_companies scoped WHERE scoped.connection_id=c.id AND scoped.source_company_id=$3)
   LEFT JOIN hz_fop_companies co ON co.connection_id=c.id AND co.source_company_id=$3
   LEFT JOIN hz_fop_employee_bindings b ON b.connection_id=c.id AND b.local_account_id=u.id
   WHERE e.owner_user_id=$1 ORDER BY e.id`,[owner,tenant,company])
  const org=buildReplicaOrganization(user,owner,nodes,employees,{tenant_id:tenant,source_company_id:company})
  const filter=localEmployeeFilter(org,query),batch=batches[0]
  const signature=JSON.stringify([user.sessionVersion,roles,org.version,batch.id])
  return {user,org,filter,batch,signature}
 }
 private metadata(batch:Row,unavailable=false){return {
  source:'fop',refreshedAt:new Date().toISOString(),
  replica:{readMode:'local',datasetId:batch.id,revision:batch.id,sourceSyncedAt:batch.source_as_of,dataMode:'collected',complete:false,missingDatasets},
  dataAvailability:{mode:'collected',complete:false,...(unavailable?{missingDatasets}:{}),reason:unavailable?'此数据集尚未接入，暂时留空；不代表没有业务数据。':'已采集 API 数据已入本地库；缺失字段留空，下游状态待核查，自动调用已暂停。'},
 }}
 async status(userId:string){
  const c=await this.context(userId),count=await this.db.query(`SELECT count(*)::int AS total FROM hz_fop_collected_orders WHERE batch_id=$1${c.filter.employeeIds===null?'':' AND owner_employee_id = ANY($2::text[])'}`,c.filter.employeeIds===null?[c.batch.id]:[c.batch.id,c.filter.employeeIds])
  return {...this.metadata(c.batch),initialized:true,state:'collected',dataMode:'collected',readMode:'local',paused:true,automaticCallsEnabled:false,syncConfigured:false,nextScheduledAt:null,sourceSyncedAt:c.batch.source_as_of,datasetId:c.batch.id,revision:c.batch.id,collected:{batchId:c.batch.id,sourceAsOf:c.batch.source_as_of,rowCount:count[0].total,pageCount:c.batch.page_count,missingDatasets}}
 }
 async orders(userId:string,query:Row,role:WorkbenchRole,unavailable=false):Promise<CollectedPage>{
  const c=await this.context(userId,role,query),page=Math.max(1,Number(query.page)||1),pageSize=Math.min(100,Math.max(1,Number(query.pageSize)||20))
  const downstream=!['unpaid','review','exceptions'].includes(query.queue)
  if(unavailable||downstream)return this.empty(c,query)
  const q=collectedWhere(c.batch.id,c.filter.employeeIds,query)
  const [totals]=await this.db.query(`SELECT count(*)::int AS total, CASE WHEN count(total_quantity)=count(*) AND count(*)>0 THEN sum(total_quantity) END AS quantity FROM hz_fop_collected_orders WHERE ${q.where}`,q.params)
  const rows:Row[]=query.projection==='count'?[]:await this.db.query(`SELECT display FROM hz_fop_collected_orders WHERE ${q.where} ORDER BY ${q.orderBy} LIMIT $${q.params.length+1} OFFSET $${q.params.length+2}`,[...q.params,pageSize,(page-1)*pageSize])
  const countryQuery=collectedWhere(c.batch.id,c.filter.employeeIds,{...query,shippingCountryCode:undefined})
  const countries:Row[]=await this.db.query(`SELECT DISTINCT country_code FROM hz_fop_collected_orders WHERE ${countryQuery.where} AND country_code IS NOT NULL ORDER BY country_code`,countryQuery.params)
  if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  return {...this.metadata(c.batch),items:rows.map(row=>localOwnership(row.display,c.org) as CollectedRow),total:totals.total,page,pageSize,queueState:'ready',departments:localDepartments(c.org),salespeople:localSalespeople(c.org,query),shippingCountries:countries.map(row=>row.country_code),totals:{orderCount:totals.total,itemQuantity:exactNumber(totals.quantity),amountsByCurrency:[],complete:false}}
 }
 private empty(c:Awaited<ReturnType<CollectedWorkbenchService['context']>>,query:Row){return {...this.metadata(c.batch,true),items:[],total:0,page:Number(query.page)||1,pageSize:Number(query.pageSize)||20,queueState:'ready',departments:localDepartments(c.org),salespeople:localSalespeople(c.org,query),warehouses:[],shippingCountries:[],totals:{orderCount:0,itemQuantity:null,amountsByCurrency:[],amounts:[],quantity:null,inboundQuantity:null,pendingQuantity:null,groupCount:null,purchaseCount:null,uncreatedCount:null,complete:false}}}
 async unavailable(userId:string,query:Row,role:WorkbenchRole,groupId?:string){const c=await this.context(userId,role,query);return {...this.empty(c,query),...(groupId?{group:null}:{})}}
 async export(userId:string,query:Row,version:number,kind:string):Promise<Buffer>{
  const role=kind==='orders'?FULFILLMENT_QUEUE_ROLES[query.queue as keyof typeof FULFILLMENT_QUEUE_ROLES]:kind==='stock'?query.workbenchRole??'sales':kind==='rma'?'sales':kind==='returns'?query.workbenchRole:'procurement'
  if(!role)throw new BadRequestException('Invalid queue')
  const c=await this.context(userId,role,query)
  if((c.user.sessionVersion??0)!==version)throw new UnauthorizedException('Session expired')
  if(!['selected','filtered'].includes(query.mode)||query.mode==='selected'&&(!Array.isArray(query.orderIds)||!query.orderIds.length||query.orderIds.length>100||new Set(query.orderIds).size!==query.orderIds.length)||query.mode==='filtered'&&query.orderIds!==undefined)throw new BadRequestException('Invalid export selection')
  if(kind!=='orders')throw new ServiceUnavailableException('该数据集尚未接入，无法导出')
  const count=await this.orders(userId,{...query,projection:'count'},role)
  if(count.total>10000)throw new PayloadTooLargeException('单次最多导出 10,000 笔订单，请缩小筛选范围')
  const result=await collectReplicaPages<any>(page=>this.orders(userId,{...query,page,pageSize:100,projection:undefined},role))
  if(query.mode==='selected'&&result.items.length!==query.orderIds.length)throw new ForbiddenException('Selection outside current result')
  if(result.items.reduce((n,row)=>n+row.items.length,0)>50000)throw new PayloadTooLargeException('单次最多导出 50,000 条商品明细，请缩小范围')
  const wb=new Workbook(),sheet=wb.addWorksheet('已采集订单')
  const columns=[['订单号','orderNumber',30],['Shopify单号','shopifyOrderNumber',22],['客户','customerName',25],['店铺','storeName',25],['业务员','ownerName',20],['部门','departmentName',20],['仓库','warehouse',20],['国家','shippingCountryCode',12],['商品金额','productAmount',18],['订单总金额','amount',18],['结算币种','currency',15],['运费','shippingFee',18],['税费','taxFee',18],['优惠','discountFee',18],['付款状态','paymentStatus',16],['审核状态','reviewStatus',16],['已取消','cancelled',12],['客户付款时间 UTC+8','paidAtText',26],['C端付款时间 UTC+8','buyerPaidAtText',26],['审核时间 UTC+8','reviewedAtText',26],['收件人','recipientName',25],['自定义渠道','customLogisticsChannelName',28],['待接入字段','missing',65]]
  sheet.columns=columns.map(([header,key,width])=>({header:String(header),key:String(key),width:Number(width)}))
  const lines=wb.addWorksheet('商品明细');lines.columns=[{header:'订单号',key:'orderNumber',width:30},{header:'SKU',key:'sku',width:25},{header:'名称',key:'name',width:40},{header:'属性',key:'variant',width:35},{header:'数量',key:'quantity',width:15},{header:'图片',key:'imageUrl',width:50}]
  const dateText=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(Date.parse(value)+8*3600_000).toISOString().slice(0,19).replace('T',' '):null
  for(const row of result.items){
   sheet.addRow({...row,ownerName:row.owner?.name??null,departmentName:row.department?.name??null,productAmount:row.amountBreakdown?.productAmount??null,shippingFee:row.amountBreakdown?.shippingFee??null,taxFee:row.amountBreakdown?.taxAmount??null,discountFee:row.amountBreakdown?.discountAmount??null,paidAtText:dateText(row.paidAt),buyerPaidAtText:dateText(row.sourceOrderPaidAt),reviewedAtText:dateText(row.reviewedAt),recipientName:row.shippingRecipient?.name??null,missing:row.dataQuality?.missingFields?.join(', ')})
   for(const item of row.items)lines.addRow({...item,orderNumber:row.orderNumber})
  }
  const notes=wb.addWorksheet('说明');notes.addRow(['采集开始时间 UTC+8',dateText(new Date(c.batch.source_as_of).toISOString())]);notes.addRow(['模式','已采集只读；空值表示未提供；非一致性快照']);notes.addRow(['批次',c.batch.id])
  const buffer=Buffer.from(await wb.xlsx.writeBuffer())
  if((await this.context(userId,role,query)).signature!==c.signature)throw new ConflictException('Local permission or batch changed; reload')
  return buffer
 }
}
