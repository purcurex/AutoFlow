import { assertOutboundFieldCoverage, supplementOutboundLineFacts } from './collected-outbound-supplement'
import { normalizeTimestampProjectionRaw } from '../workbench-replica/timestamp-projection-normalizer'
const context={companyId:'100000',capturedAt:'2026-11-18T07:00:00Z'}
const original=()=>({source_id:'10',order_number:'TO10',owner_employee_id:'7',raw:{id:'10',billno:'TO10',hzkj_org:{id:'100000'},modifytime:'2026-11-17T01:00:00+08:00',hzkj_delivery_status:'1',hzkj_orders_billentry:[{id:'11',hzkj_qty:'1',hzkj_local_sku:{id:'21',number:'PHYSICAL'}},{id:'12',hzkj_qty:'1',hzkj_local_sku:{id:'22',number:'VIRTUAL'}}]},display:{id:'10',orderNumber:'TO10',items:[{id:'11',sku:'PHYSICAL',name:'Preserved'},{id:'12',sku:'VIRTUAL',isVirtual:true}],procurementLineEvidence:{source:'verified_purchase_lines',sourceOrderId:'10',paidLineIds:['11']},nativeAssociationIssues:['keep','current_source_outbound_status_unknown'],nativeShippingReady:true}})
const source=()=>({id:'10',billno:'TO10',org_id:'100000',hzkj_operator_id:'7',modifytime:'2026-11-18 08:00:00',hzkj_delivery_status:'1',hzkj_orders_billentry:[{id:'12',hzkj_local_sku_id:'22',hzkj_qty:1,hzkj_outbound_status:'1',hzkj_outbound_qty:1},{id:'11',hzkj_local_sku_id:'21',hzkj_qty:1,hzkj_outbound_status:'0',hzkj_outbound_qty:0}]})
it('patches by line ID, preserves zero and purchase evidence, excludes virtual outbound',()=>{
 const prior=original(),before=JSON.stringify(prior),result=supplementOutboundLineFacts(prior,source(),context)
 expect(JSON.stringify(prior)).toBe(before)
 expect(result.raw.hzkj_orders_billentry[0]).toMatchObject({id:'11',hzkj_outbound_qty:0,hzkj_outbound_status:'0'})
 expect(result.display.businessStatus).toMatchObject({outbound:'pending',outboundBasis:'physical_lines',purchase:'purchased'})
 expect(result.display.businessStatus.lines[1].outbound).toBe('not_required')
 expect(result.display.nativeAssociationIssues).toEqual(['keep'])
 expect(result.display.nativeShippingReady).toBe(true)
 expect(result.display.items[0].name).toBe('Preserved')
 expect(supplementOutboundLineFacts(result,source(),context)).toEqual(result)
})
it.each(['hzkj_outbound_status','hzkj_outbound_qty'])('blocks a later missing %s but accepts explicit null',key=>{
 const current=supplementOutboundLineFacts(original(),source(),context).raw,next:any=source();delete next.hzkj_orders_billentry[1][key]
 expect(()=>assertOutboundFieldCoverage(next,current)).toThrow('timestamp_projection_missing_line_outbound_fact')
 next.hzkj_orders_billentry[1][key]=null
 expect(()=>assertOutboundFieldCoverage(next,current)).not.toThrow()
})
it('rejects incomplete lines, changed SKU/quantity, invalid status and negative quantity',()=>{
 for(const patch of [{id:'99'},{hzkj_local_sku_id:'88'},{hzkj_qty:2},{hzkj_outbound_qty:-1},{hzkj_outbound_qty:'NaN'},{hzkj_outbound_status:'2'}]){
  const next:any=source();Object.assign(next.hzkj_orders_billentry[1],patch)
  expect(()=>supplementOutboundLineFacts(original(),next,context)).toThrow()
 }
 const incomplete=source();incomplete.hzkj_orders_billentry.pop()
 expect(()=>supplementOutboundLineFacts(original(),incomplete,context)).toThrow()
})
it('normalizes flat API line facts without dropping zero or long IDs',()=>{
 const next=source(),raw=normalizeTimestampProjectionRaw('hzkj_orders',next,'100000')
 expect(raw.hzkj_orders_billentry[1]).toMatchObject({hzkj_outbound_qty:0,hzkj_outbound_status:'0',hzkj_local_sku:{id:'21'}})
 const missing:any=source();delete missing.hzkj_orders_billentry[1].hzkj_outbound_qty
 expect(()=>normalizeTimestampProjectionRaw('hzkj_orders',missing,'100000',raw)).toThrow('timestamp_projection_missing_line_outbound_fact')
})
it('keeps explicit null unknown for a partial header, never invents quantities',()=>{
 const next:any=source();next.hzkj_orders_billentry[1].hzkj_outbound_status=null;next.hzkj_orders_billentry[1].hzkj_outbound_qty=null
 const result=supplementOutboundLineFacts(original(),next,context)
 expect(result.display.businessStatus.outbound).toBe('unknown')
 expect(result.raw.hzkj_orders_billentry[0].hzkj_outbound_qty).toBeNull()
})
it('does not let an older field scan override a newer full sync with the same source modification time',()=>{
 const current=supplementOutboundLineFacts(original(),source(),context)
 current.raw.timestampProjection={version:1,capturedAt:'2026-11-18T08:00:00Z'}
 expect(supplementOutboundLineFacts(current,source(),context)).toEqual(current)
 current.raw.hzkj_orders_billentry[0].hzkj_outbound_qty=1
 current.raw.hzkj_orders_billentry[0].hzkj_outbound_status='1'
 expect(()=>supplementOutboundLineFacts(current,source(),context)).toThrow('outbound_stale_capture')
})
it('records targeted detail provenance without claiming list-scan coverage',()=>{
 const result=supplementOutboundLineFacts(original(),source(),{...context,operation:'queryOrderDetail'})
 expect(result.display.lineOutboundCapture.source).toBe('queryOrderDetail')
 expect(result.display.lineOutboundCapture.sourceId).toBe('10')
})
