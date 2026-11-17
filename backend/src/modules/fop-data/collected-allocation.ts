/** Legacy queryAllocation fields verified against captured schema and AllocationConstants.
 * No source scope, completion or permissions are inferred by this normalizer. */
export function normalizeCollectedAllocation(row:Record<string,unknown>,companyId:string){
 const id=(v:unknown)=>typeof v==='string'&&/^[1-9]\d{0,30}$/.test(v)?v:null
 if((row.org_id??row.organizationId)!==companyId||!id(row.id)||!id(row.hzkj_order_id)||typeof row.billno!=='string'||!row.billno.trim())throw Error('invalid_collected_allocation_identity_or_scope')
 const date=(v:unknown)=>{if(typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v)))return new Date(v).toISOString();if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v))return null;const d=new Date(v.replace(' ','T')+'+08:00');return Number.isFinite(d.valueOf())?d.toISOString():null}
 return {approvedAt:date(row.auditdate),readyAt:date(row.hzkj_complete_time),id:row.id as string,sourceOrderId:row.hzkj_order_id as string,sourceOperatorId:id(row.hzkj_operator_id),number:row.billno,
 rawBillStatus:['A','B','C','D'].includes(String(row.billstatus))?row.billstatus:null,
 rawAllocationStatus:['pending','available','completed','error','voided'].includes(String(row.hzkj_alloc_status))?row.hzkj_alloc_status:null}
}
