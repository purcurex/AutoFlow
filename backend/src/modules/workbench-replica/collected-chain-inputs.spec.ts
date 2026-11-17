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
