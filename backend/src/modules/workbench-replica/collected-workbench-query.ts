type Query = Record<string, any>
/** All conditions apply before pagination. Unknown downstream facts stay in the diagnostic queue. */
export function collectedWhere(batchId:string,employeeIds:readonly string[]|null,q:Query) {
 const params:unknown[]=[batchId], clauses=['batch_id = $1']
 const bind=(v:unknown)=>{params.push(v);return `$${params.length}`}
 if(employeeIds!==null)clauses.push(`owner_employee_id = ANY(${bind(employeeIds)}::text[])`)
 const active="raw_order_status IN ('1','2','3','4','5','no')"
 const queues:Record<string,string>={
  unpaid:`${active} AND raw_payment_status = '0'`,
  review:q.completed?"raw_bill_status = 'C'":`${active} AND raw_payment_status = '1' AND raw_bill_status = 'B'`,
  exceptions:`(raw_delivery_status IS DISTINCT FROM '2' AND (raw_payment_status IS DISTINCT FROM '0' OR raw_order_status IS NULL OR raw_order_status NOT IN ('1','2','3','4','5','no')))`,
 }
 clauses.push(queues[q.queue]||'FALSE')
 if(q.taskStatus && q.taskStatus!=='all' || q.procurementStage && q.procurementStage!=='all')clauses.push('FALSE')
 const like=(v:string)=>`%${v.toLowerCase().replace(/[\\%_]/g,'\\$&')}%`
 if(q.search?.trim())clauses.push(`search_text LIKE ${bind(like(q.search.trim()))}`)
 if(q.orderNumber?.trim())clauses.push(`lower(order_number) LIKE ${bind(like(q.orderNumber.trim()))}`)
 if(q.shippingCountryCode)clauses.push(`country_code = ${bind(q.shippingCountryCode)}`)
 if(q.warehouseCode)clauses.push(`warehouse_code = ${bind(q.warehouseCode)}`)
 const days:Record<string,number>={'1w':7,'1m':30,'3m':90}
 if(days[q.timeRange])clauses.push(`${q.queue==='review'&&q.completed?"NULLIF(display->>'reviewedAt','')::timestamptz":'paid_at'} >= now() - (${bind(days[q.timeRange])} * interval '1 day')`)
 if(q.mode==='selected')clauses.push(`source_id = ANY(${bind(q.orderIds)}::text[])`)
 const sorts:Record<string,string>={paidAt:'paid_at',consumerPaidAt:'paid_at',reviewedAt:"NULLIF(display->>'reviewedAt','')::timestamptz",completedAt:"NULLIF(display->>'reviewedAt','')::timestamptz"}
 return {where:clauses.map(x=>`(${x})`).join(' AND '),params,orderBy:`${sorts[q.sortBy]||'paid_at'} ${q.sortOrder==='asc'||!q.sortOrder&&q.paidAtOrder==='asc'?'ASC':'DESC'} NULLS LAST, source_id ASC`}
}
