import { persistedExceptionDisplaySql } from './persisted-exception-read'
import { warehouseCodes } from './warehouse-codes'
type Row = Record<string, any>
const own = (r:Row,key:string) => Object.prototype.hasOwnProperty.call(r,key)
const empty = (v:unknown) => v == null || typeof v==='string'&&!v.trim()
export function canViewUnassignedStockExceptions(c:Row,q:Row):boolean {
 return c.user.role==='admin' && c.org.employeeIds===null && !q.ownerId && (!q.departmentId || q.departmentId===c.org.marketingScope?.rootId)
}
export function stockExceptionDisplay(display:Row,raw:Row,persisted=false):Row {
 const reasons:string[]=[]
 if(!persisted&&!display.owner?.id && own(raw,'hzkj_operator_id') && (empty(raw.hzkj_operator_id)||raw.hzkj_operator_id==='0'))reasons.push('业务员为空')
 if(!persisted&&raw.hzkj_orderstatus==='2' && own(raw,'hzkj_receipt_date') && empty(raw.hzkj_receipt_date))reasons.push('备货收款日期待补齐')
 return {...display,id:'stock:'+raw.id,sourceDocumentId:raw.id,documentKind:'stock_order',orderNumber:display.stockNumber,
  shopifyOrderNumber:'备货订单',shippingCountryCode:null,shippingRecipient:null,consumerPaidAt:null,sourceOrderPaidAt:null,
  logisticsInfo:[],logisticsChannels:[],trackingNumbers:[],dispatchDocuments:[],businessStatus:undefined,
  exception:persisted?display.exception:reasons.length?{type:'logistics_exception',reason:reasons.join('；'),code:'stock_data_missing',hours:null}:null}
}
/** Native stock exceptions share pagination with fulfillment, without inventing a fulfillment document. */
export function stockExceptionCandidatesSql(employeeIds:readonly string[]|null,q:Row,bind:(value:unknown)=>string,includeUnassigned:boolean):string {
 const where=["e.batch_id=$1","e.entity_type='stock_orders'","f.entity_type='stock'","f.company_id=b.company_id","f.raw->>'org_id'=b.company_id","f.raw->>'id'=e.source_id","f.raw->>'billno'=e.display->>'stockNumber'",'e.is_exception']
 if(employeeIds!==null)where.push(`(e.owner_employee_id=ANY(${bind(employeeIds)}::text[])${includeUnassigned?" OR (e.owner_employee_id IS NULL AND strpos(e.exception_reason,'业务员为空')>0)":''})`)
 else if(!includeUnassigned)where.push('e.owner_employee_id IS NOT NULL')
 if(q.taskStatus&&q.taskStatus!=='all'&&q.taskStatus!=='logistics_exception')where.push('FALSE')
 if(q.warehouseCode)where.push(`e.display->>'warehouseCode'=ANY(${bind(warehouseCodes(q.warehouseCode))}::text[])`)
 const like=(v:string)=>'%'+v.trim().toLowerCase().replace(/[\\%_]/g,'\\$&')+'%'
 if(q.search?.trim())where.push(`(e.search_text LIKE ${bind(like(q.search))}${q.searchOwnerIds?.length?` OR e.owner_employee_id=ANY(${bind(q.searchOwnerIds)}::text[])`:''})`)
 if(q.orderNumber?.trim())where.push(`lower(e.display->>'stockNumber') LIKE ${bind(like(q.orderNumber))}`)
 if(q.mode==='selected')where.push(`('stock:'||e.source_id)=ANY(${bind(q.orderIds)}::text[])`)
 const days:Row={'1w':7,'1m':30,'3m':90}
 if(days[q.timeRange])where.push(`f.paid_at BETWEEN now()-(${bind(days[q.timeRange])}*interval '1 day') AND now()`)
 return `SELECT 'stock:'||e.source_id AS source_id,NULL::text AS country_code,
  (SELECT CASE WHEN count(*)=count(i->>'quantity') AND bool_and((i->>'quantity') ~ '^[0-9]+([.][0-9]+)?$') THEN sum(CASE WHEN (i->>'quantity') ~ '^[0-9]+([.][0-9]+)?$' THEN (i->>'quantity')::numeric END) END FROM jsonb_array_elements(coalesce(e.display->'items','[]'::jsonb)) i) AS total_quantity,
  f.paid_at,NULL::timestamptz AS consumer_paid_at,${persistedExceptionDisplaySql('e')} AS display,f.raw,'stock_order'::text AS document_kind
  FROM hz_fop_collected_entities e JOIN hz_fop_collected_analytics_facts f ON f.batch_id=e.batch_id AND f.source_id=e.source_id
  JOIN hz_fop_collected_batches b ON b.id=e.batch_id WHERE ${where.map(w=>'('+w+')').join(' AND ')}`
}
