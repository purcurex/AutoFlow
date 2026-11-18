import { collectedChainInputs } from './collected-chain-inputs'
const batch={source_as_of:'2026-11-01T00:00:00Z',company_id:'100000',metadata:{entityCaptures:{shipping:{capturedAt:'2026-11-03T00:00:00Z'},procurement:{capturedAt:'2026-11-05T00:00:00Z'}}}}
it('selects the latest native capture using its actual timestamp',()=>{
 const r=collectedChainInputs(batch,[{raw:{id:'1',native_allocation:{id:'1',billno:'old'},native_procurement:{id:'1',billno:'new'}}}],[],[{entity_type:'fulfillment',company_id:'100000',raw:{id:'1',billno:'middle'},captured_at:new Date('2026-11-04T00:00:00Z')}])
 expect(r.ordered[0].raw.billno).toBe('new');expect(r.ordered[0].capturedAt).toBe('2026-11-05T00:00:00Z')
})
it('does not resurrect conflicted sources using older or same-time analytics',()=>{
 for(const date of ['2026-11-02T00:00:00Z','2026-11-12T00:00:00Z']){
 const r=collectedChainInputs(batch,[],[{entity_type:'purchase',source_id:'p',raw:{versions:[{id:'p'},{id:'p'}]},captured_at:new Date('2026-11-12T00:00:00Z')}],[{entity_type:'purchase',company_id:'100000',raw:{id:'p'},captured_at:new Date(date)}])
 expect(r.ordered).toEqual([]);expect(r.unresolvedConflicts).toBe(1)
 }
})
it('accepts a later complete capture without merging fields from the conflict',()=>{
 const r=collectedChainInputs(batch,[],[{entity_type:'purchase',source_id:'p',raw:{versions:[{id:'p',secret:'old'}]},captured_at:new Date('2026-11-01T00:00:00Z')}],[{entity_type:'purchase',company_id:'100000',raw:{id:'p'},captured_at:new Date('2026-11-12T00:00:00Z')}])
 expect(r.ordered[0].raw).toEqual({id:'p'});expect(r.unresolvedConflicts).toBe(0)
})

it('published timestamp records override legacy native and analytics versions as a whole',()=>{
 const raw={id:'1',billno:'current',timestampProjection:{version:1,capturedAt:'2026-11-01T00:00:00Z'},native_allocation:{id:'1',billno:'legacy'}}
 const r=collectedChainInputs(batch,[{raw}],[],[{entity_type:'fulfillment',company_id:'100000',raw:{id:'1',billno:'legacy-analysis'},captured_at:'2026-11-15T00:00:00Z'}])
 expect(r.ordered[0].raw.billno).toBe('current');expect(r.ordered[0].raw.native_allocation).toBeUndefined()
})

describe('verified outbound field repair in a later selected legacy snapshot',()=>{
 const batch={company_id:'100000',source_as_of:'2026-11-01T00:00:00Z',metadata:{entityCaptures:{shipping:{capturedAt:'2026-11-12T00:00:00Z'}}}}
 const native=()=>({id:'10',billno:'TO10',hzkj_org:{id:'100000'},hzkj_operator:{id:'7'},hzkj_orderstatus:'2',hzkj_receipt_status:'1',hzkj_delivery_status:'1',other:'keep newer snapshot',hzkj_orders_billentry:[{id:'11',hzkj_local_sku:{id:'9',number:'SKU'},hzkj_qty:1}]})
 const order=()=>({raw:{...native(),other:'older original',hzkj_delivery_status:'0',hzkj_orders_billentry:[{...native().hzkj_orders_billentry[0],hzkj_outbound_status:'0',hzkj_outbound_qty:0}],native_allocation:native()},display:{lineOutboundCapture:{source:'queryOrderDetail',sourceId:'10',companyId:'100000',capturedAt:'2026-11-18T08:00:00Z',sourceModifiedAt:'2026-11-16 08:00:00'}}})
 it('keeps newer whole-record fields and only overlays validated same-order outbound fields, including zero',()=>{
  const input=order(),before=JSON.stringify(input),raw=collectedChainInputs(batch,[input],[],[]).ordered[0].raw
  expect(raw.other).toBe('keep newer snapshot');expect(raw.hzkj_delivery_status).toBe('0')
  expect(raw.hzkj_orders_billentry[0]).toMatchObject({hzkj_outbound_status:'0',hzkj_outbound_qty:0})
  expect(JSON.stringify(input)).toBe(before)
 })
 it('rejects changed line quantities instead of assigning a fact to a different document version',()=>{
  const input=order();input.raw.native_allocation.hzkj_orders_billentry[0].hzkj_qty=2
  expect(()=>collectedChainInputs(batch,[input],[],[])).toThrow('outbound_line_quantity_changed')
 })
 it('cannot repair another company with the provenance of the local order',()=>{
  const input=order();input.raw.native_allocation.hzkj_org.id='200000'
  expect(()=>collectedChainInputs(batch,[input],[],[])).toThrow('outbound_company_mismatch')
 })
 it('does not override a whole document captured after the field repair',()=>{
  const later={...batch,metadata:{entityCaptures:{shipping:{capturedAt:'2026-11-19T00:00:00Z'}}}}
  const raw=collectedChainInputs(later,[order()],[],[]).ordered[0].raw
  expect(raw.hzkj_delivery_status).toBe('1');expect(raw.hzkj_orders_billentry[0]).not.toHaveProperty('hzkj_outbound_qty')
 })
})
