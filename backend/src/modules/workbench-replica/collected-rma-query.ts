import { warehouseCodes } from './warehouse-codes'
/** This predicate is shared by list, count, totals, detail, search and export. */
export function collectedRmaWhere(batchId:string,employeeIds:readonly string[]|null,q:Record<string,any>){
 const params:unknown[]=[batchId],clauses=["batch_id=$1","entity_type='rma'","display->'rmaAssociation'->>'companyVerified'='true'"];const bind=(v:unknown)=>{params.push(v);return `$${params.length}`}
 if(employeeIds!==null){clauses.push(`owner_employee_id = ANY(${bind(employeeIds)}::text[])`)}
 if(employeeIds!==null||!q.includeAssociationExceptions)clauses.push("display->'rmaAssociation'->>'state'='verified'")
 const type=q.rmaType??q.type,flow=q.rmaFlowStatus??q.flowStatus??'active'
 if(type)clauses.push(`display->'rmaCases'->0->>'type'=${bind(type)}`)
 if(flow!=='all')clauses.push(`display->'rmaCases'->0->>'isOpen'='${flow==='closed'?'false':'true'}'`)
 if(q.warehouseCode)clauses.push(`display->>'warehouseCode'=ANY(${bind(warehouseCodes(q.warehouseCode))}::text[])`)
 if(q.search?.trim())clauses.push(`search_text LIKE ${bind('%'+q.search.trim().toLowerCase().replace(/[\\%_]/g,'\\$&')+'%')}${q.searchOwnerIds?.length?` OR owner_employee_id = ANY(${bind(q.searchOwnerIds)}::text[])`:''}`)
 if(q.caseId)clauses.push(`source_id=${bind(q.caseId)}`)
 if(q.mode==='selected')clauses.push(`source_id=ANY(${bind(q.caseIds??q.orderIds)}::text[])`)
 return{where:clauses.map(v=>`(${v})`).join(' AND '),params,orderBy:"NULLIF(display->>'rmaUpdatedAt','')::timestamptz DESC NULLS LAST,source_id ASC"}
}
