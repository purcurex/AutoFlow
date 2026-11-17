import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export function timestampCapability(api){
 const parameters=api.bodyentryentity??[],responses=api.response??[],filters=api.filter_entity??[]
 const responseTimes=responses.filter(x=>['createtime','modifytime'].includes(x.respobjpropname)).map(x=>({source:x.respobjpropname,response:x.respparamname}))
 const timeFilters=filters.filter(x=>['createtime','modifytime'].includes(x.filter_column)).map(x=>{
  const request=parameters.find(p=>p.paramname===x.filter_value)||parameters.find(p=>p.objpropname===x.filter_value)
  return {field:x.filter_column,comparison:x.filter_compare,filterValue:x.filter_value,requestParameter:request?.paramname??null}
 })
 const ordinary=['queryOrderList','queryAllocation','queryDispatch','queryDeliveryNotice'].includes(api.number)
 return {api:api.number,entity:api.bizobject?.number??null,responseTimes,timeFilters,
  ordering:(api.order??[]).map(x=>({field:x.order_field,direction:x.order_mode})),
  entries:responses.filter(x=>x.respparamtype==='Entries').map(x=>x.respparamname),
  ordinaryModifiedCapture:ordinary,creationWindowCaptureInTimestampEngine:false,
  creationRangeFilterAvailable:timeFilters.some(x=>x.field==='createtime'&&['GREATER','GREATEROREQUAL'].includes(x.comparison))&&timeFilters.some(x=>x.field==='createtime'&&x.comparison==='LESS'),
  modifiedRangeFilterAvailable:timeFilters.some(x=>x.field==='modifytime'&&x.comparison==='GREATEROREQUAL')&&timeFilters.some(x=>x.field==='modifytime'&&x.comparison==='LESS'),
  keyset:false,sourceClock:false,scopeProof:false,deletionProof:false,childChangeUpdatesModifytime:'待FOP确认',
  status:ordinary?'local_adapter_implemented_not_live_verified':timeFilters.some(x=>x.field==='createtime')?'creation_filter_only_not_modify_incremental':'no_time_window_filter',
  constantFilters:filters.filter(x=>x.filter_constant).map(x=>({field:x.filter_column,value:x.filter_constant})),
 }
}
export function buildTimestampCapabilities(directory){
 // Runtime also contains private probes. Only a paired DTS export is a capability input.
 const files=readdirSync(directory)
 const apis=files.filter(f=>f.endsWith('.json')&&files.includes(f.slice(0,-5)+'.dts')).sort().map(file=>{
  const raw=readFileSync(resolve(directory,file),'utf8')
  const api=JSON.parse(raw)
  if(!api.number||!Array.isArray(api.bodyentryentity)||!Array.isArray(api.response))throw Error('timestamp_capability_export_invalid')
  return {...timestampCapability(api),packageSha256:createHash('sha256').update(raw).digest('hex')}
 })
 return {version:1,packageVersion:'2026-11-16',evidence:'用户提供26项DTS导出配置；源码与配置均不代表已部署或成功联调',automaticCallsEnabled:false,upstreamCalled:false,
  protocol:'ordinary_modified_pages',consistency:'eventual',watermark:'local_capture_cutoff_not_source_transaction_version',
  capture:{fixedUpperBound:true,overlapSeconds:600,safetyLagSeconds:120,fullCompensationSeconds:86400,fullCompensation:'manual_required_before_more_incremental_when_overdue',failureAdvancesWatermark:false,missingRowsAreDeletions:false,publication:'four_entity_transactional_local_projection_with_per_record_pending',localDerivedViews:'only_current_source_and_verified_local_relationship_facts; missing_fields_unknown',publicationInManualCaptureTransaction:true,fullWorkbenchComplete:false},
  sourceImplementationEvidence:['/Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/service/OrderBatchModifyService.java','/Library/VSCode/dtr5b/code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/ordercenter/allocation/AllocationService.java'],
  gaps:['创建时间窗口未覆盖四项修改时间接口','全部子表/关联/原生状态变更是否推进主单modifytime未确认','普通分页移动可能漏行，必须全量补偿；补偿仍非一致快照','删除/解除关联需真实当前状态或显式存在性证据；普通分页缺行不得删单','集成账号公司全量覆盖、时钟偏差、时间格式与范围边界待真实联调','四实体本地投影已实现；新payload未返回的业务状态、无法证实的派生需求及其他实体更新仍不构成全工作台增量完备'],apis}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)))
 const result=buildTimestampCapabilities(resolve(root,'.runtime/api-20261116'))
 writeFileSync(resolve(root,'docs/openapi/fop-query-timestamp-capabilities.json'),JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify({apis:result.apis.length,ordinaryModifiedCapture:result.apis.filter(x=>x.ordinaryModifiedCapture).map(x=>x.api),upstreamCalled:false}))
}
