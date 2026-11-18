import { supplementInboundFacts, assertInboundFieldCoverage } from './collected-inbound-supplement'
const context={companyId:'100000',capturedAt:'2026-11-17T08:00:00Z'}
const prior=()=>({source_id:'10',order_number:'TO10',owner_employee_id:'7',raw:{id:'10',billno:'TO10',hzkj_org:{id:'100000'},modifytime:'2026-11-16T00:00:00+08:00',hzkj_purchase_status:'4',hzkj_delivery_status:'0',hzkj_orders_billentry:[{id:'11',hzkj_qty:'3',hzkj_local_sku:{id:'21',number:'SKU'},hzkj_variant_name:'Keep'}]},display:{items:[{id:'11',name:'Keep product'}]}})
const source=()=>({id:'10',billno:'TO10',org_id:'100000',hzkj_operator_id:'7',modifytime:'2026-11-17 08:00:00',hzkj_purchase_status:'4',hzkj_purchase_status_title:'已发货',hzkj_orders_billentry:[{id:'11',hzkj_local_sku_id:'21',hzkj_qty:'3',hzkj_entrypurc_status:'4',hzkj_purcqty:'10',hzkj_instock_qty:'2'}]})
it('merges only current same-document inbound fields by native entry ID and is idempotent',()=>{const p=prior(),r=supplementInboundFacts(p,source(),context);expect(r.raw.hzkj_orders_billentry[0]).toMatchObject({id:'11',hzkj_qty:'3',hzkj_purcqty:'10',hzkj_instock_qty:'2',hzkj_variant_name:'Keep'});expect(r.raw.hzkj_delivery_status).toBe('0');expect(r.display.items).toEqual(p.display.items);expect(supplementInboundFacts(r,source(),context)).toEqual(r)})
it('rejects partial API responses instead of defaulting missing quantity to zero',()=>{for(const key of ['hzkj_entrypurc_status','hzkj_purcqty','hzkj_instock_qty']){const s:any=source();delete s.hzkj_orders_billentry[0][key];expect(()=>supplementInboundFacts(prior(),s,context)).toThrow('inbound_field_missing')}})
it('rejects cross-order, changed-owner, changed-line and stale captures',()=>{for(const patch of [{id:'20'},{billno:'TO20'},{org_id:'200000'},{hzkj_operator_id:'8'},{modifytime:'2026-11-15 00:00:00'},{hzkj_orders_billentry:[]},{hzkj_orders_billentry:[{...source().hzkj_orders_billentry[0],id:'12'}]}])expect(()=>supplementInboundFacts(prior(),{...source(),...patch},context)).toThrow()})
it('retains explicit null quantities as unknown',()=>{const s:any=source();s.hzkj_orders_billentry[0].hzkj_instock_qty=null;expect(supplementInboundFacts(prior(),s,context).raw.hzkj_orders_billentry[0].hzkj_instock_qty).toBeNull()})

it('blocks a later response that omits a captured line field while accepting explicit null',()=>{
 const old=source(),next:any=source();delete next.hzkj_orders_billentry[0].hzkj_instock_qty
 expect(()=>assertInboundFieldCoverage(next,old)).toThrow('timestamp_projection_missing_inbound_fact')
 next.hzkj_orders_billentry[0].hzkj_instock_qty=null
 expect(()=>assertInboundFieldCoverage(next,old)).not.toThrow()
})

it('accepts an explicit empty API collection only when the stored order also has no entries',()=>{
 const s={...source(),hzkj_orders_billentry:null},p={...prior(),raw:{...prior().raw,hzkj_orders_billentry:[]}}
 expect(supplementInboundFacts(p,s,context).raw.hzkj_orders_billentry).toEqual([])
 expect(()=>supplementInboundFacts(prior(),s,context)).toThrow('inbound_incomplete_document')
 const missing:any={...s};delete missing.hzkj_orders_billentry
 expect(()=>supplementInboundFacts(p,missing,context)).toThrow('inbound_incomplete_document')
})

it('matches API zero SKU references to normalized null without accepting another SKU',()=>{
 const p=prior();p.raw.hzkj_orders_billentry[0].hzkj_local_sku.id=null as any
 const s=source();s.hzkj_orders_billentry[0].hzkj_local_sku_id='0'
 expect(()=>supplementInboundFacts(p,s,context)).not.toThrow()
 s.hzkj_orders_billentry[0].hzkj_local_sku_id='99'
 expect(()=>supplementInboundFacts(p,s,context)).toThrow('inbound_line_changed')
})
