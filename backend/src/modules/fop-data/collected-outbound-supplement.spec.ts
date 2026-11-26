import { supplementOutboundStatus, assertOutboundFieldCoverage } from './collected-outbound-supplement'
const row=()=>({source_id:'10',order_number:'TO10',owner_employee_id:'7',raw_delivery_status:null,raw:{id:'10',billno:'TO10',hzkj_org:{id:'100000'},modifytime:'2026-11-16T00:00:00+08:00',hzkj_orders_billentry:[{id:'11',hzkj_qty:'1',hzkj_local_sku:{number:'SKU'}}]},display:{id:'10',orderNumber:'TO10',owner:{id:'7'},nativeShippingReady:true,items:[{id:'11',name:'Keep name'}],nativeAssociationIssues:['current_source_outbound_status_unknown','keep_issue']}})
const source=(status:any='0')=>({id:'10',billno:'TO10',org_id:'100000',hzkj_operator_id:'7',modifytime:'2026-11-16 01:00:00',hzkj_delivery_status:status})
const context={companyId:'100000',capturedAt:'2026-11-17T05:30:00Z'}
it.each([['0','pending'],['2','completed'],['1','pending'],[null,'unknown'],['','unknown']])('projects native outbound %s without changing other fields',(status,expected)=>{
 const prior=row(),before=JSON.stringify(prior),r=supplementOutboundStatus(prior,source(status),context)
 expect(JSON.stringify(prior)).toBe(before)
 expect(r.raw.hzkj_delivery_status).toBe(status)
 expect(r.raw_delivery_status).toBe(status||null)
 expect(r.display.sourceOutboundStatus).toBe(status||null)
 expect(r.display.businessStatus.outbound).toBe(expected)
 expect(r.display.items).toEqual(prior.display.items)
 expect(r.display.owner).toEqual(prior.display.owner)
 expect(r.display.nativeShippingReady).toBe(true)
 expect(r.display.nativeAssociationIssues).toContain('keep_issue')
 expect(r.display.nativeAssociationIssues.includes('current_source_outbound_status_unknown')).toBe(expected==='unknown')
 expect(r.raw.hzkj_orders_billentry).toEqual(prior.raw.hzkj_orders_billentry)
})
it('rejects omitted/invalid source fields and cross-document/company/employee updates',()=>{
 for(const patch of [{hzkj_delivery_status:undefined},{hzkj_delivery_status:'3'},{id:'20'},{billno:'TO20'},{org_id:'200000'},{hzkj_org_id:'200000'},{hzkj_operator_id:'8'},{modifytime:'2026-11-15 01:00:00'}])expect(()=>supplementOutboundStatus(row(),{...source(),...patch},context)).toThrow()
 const missing=source();delete missing.hzkj_delivery_status
 expect(()=>supplementOutboundStatus(row(),missing,context)).toThrow('outbound_field_missing')
})
it('prevents later timestamp responses from clearing a previously captured field',()=>{
 expect(()=>assertOutboundFieldCoverage({id:'10'},source('0'))).toThrow('timestamp_projection_missing_outbound_status')
 expect(()=>assertOutboundFieldCoverage(source(null),source('0'))).not.toThrow()
 expect(()=>assertOutboundFieldCoverage({id:'10'},{id:'10'})).not.toThrow()
})
it('is idempotent for the same capture',()=>{
 const r=supplementOutboundStatus(row(),source(),context)
 expect(supplementOutboundStatus(r,source(),context)).toEqual(r)
})
it('treats the FOP empty employee reference 0 as null without assigning an owner',()=>{
 const prior={...row(),owner_employee_id:null}
 expect(supplementOutboundStatus(prior,{...source(),hzkj_operator_id:'0'},context).owner_employee_id).toBeNull()
})
it('supplements an independent outbound fact without replacing the cached bill audit status',()=>{
 const original=row(),prior={...original,raw:{...original.raw,billstatus:'A'}}
 const result=supplementOutboundStatus(prior,{...source(),billstatus:'C'},context)
 expect(result.raw.billstatus).toBe('A');expect(result.raw_delivery_status).toBe('0')
})
