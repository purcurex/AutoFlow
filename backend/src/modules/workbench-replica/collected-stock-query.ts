import { warehouseCodes } from './warehouse-codes'
export function collectedStockWhere(batchId:string,employeeIds:readonly string[]|null,q:Record<string,any>){
 const params:unknown[]=[batchId],clauses=["batch_id=$1","entity_type='stock_orders'"];const bind=(v:unknown)=>{params.push(v);return `$${params.length}`}
 if(employeeIds!==null)clauses.push(`owner_employee_id = ANY(${bind(employeeIds)}::text[])`)
 for(const key of ['stockType','purchaseStatus','orderStatus','reviewStatus'])if(q[key])clauses.push(`display->>'${key}' = ${bind(q[key])}`)
 if(q.warehouseCode)clauses.push(`display->>'warehouseCode'=ANY(${bind(warehouseCodes(q.warehouseCode))}::text[])`)
 if(q.queue==='procurement')clauses.push("display->>'cancelled'='false'", "display->>'paymentStatus' = 'paid' AND display->>'reviewStatus' = 'approved' AND display->>'purchaseStatus' IN ('unpurchased','partial','in_progress','purchased')")
 if(q.lifecycle==='unpaid')clauses.push("display->>'orderStatus'='unpaid'")
 if(q.lifecycle==='pending_procurement')clauses.push("display->>'cancelled'='false' AND display->>'paymentStatus' = 'paid' AND display->>'purchaseStatus' IN ('unpurchased','partial','in_progress','purchased')")
 if(q.lifecycle==='received')clauses.push("display->>'orderStatus'='paid' AND display->>'reviewStatus'='approved' AND display->>'purchaseStatus'='received'")
 if(q.search?.trim())clauses.push(`search_text LIKE ${bind('%'+q.search.trim().toLowerCase().replace(/[\\%_]/g,'\\$&')+'%')}${q.searchOwnerIds?.length?` OR owner_employee_id = ANY(${bind(q.searchOwnerIds)}::text[])`:''}`)
 if(q.mode==='selected')clauses.push(`source_id=ANY(${bind(q.orderIds)}::text[])`)
 const range=q.timeRange??(q.queue==='procurement'?undefined:'1m')
 const days:Record<string,number>={'1w':7,'1m':30,'3m':90};if(days[range])clauses.push(`NULLIF(display->>'paidAt','')::timestamptz BETWEEN now()-(${bind(days[range])}*interval '1 day') AND now()`)
 const key=['createdAt','paidAt','orderStatus','purchaseStatus'].includes(q.sortBy)?q.sortBy:'createdAt';const sort=['createdAt','paidAt'].includes(key)?`NULLIF(display->>'${key}','')::timestamptz`:`display->>'${key}'`
 return{where:clauses.map(v=>`(${v})`).join(' AND '),params,orderBy:`${sort} ${q.sortOrder==='asc'?'ASC':'DESC'} NULLS LAST,source_id ASC`}
}
