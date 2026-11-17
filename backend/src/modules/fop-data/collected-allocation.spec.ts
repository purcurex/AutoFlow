import { normalizeCollectedAllocation } from './collected-allocation'
const row={id:'11',org_id:'100000',hzkj_order_id:'22',hzkj_operator_id:'33',billno:'AL1',billstatus:'B',hzkj_alloc_status:'completed'}
it('retains confirmed source identity, relation and native states without manufacturing execution facts',()=>{expect(normalizeCollectedAllocation(row,'100000')).toEqual({approvedAt:null,readyAt:null,id:'11',sourceOrderId:'22',sourceOperatorId:'33',number:'AL1',rawBillStatus:'B',rawAllocationStatus:'completed'})})
it.each([{...row,org_id:'2'},{...row,id:11},{...row,hzkj_order_id:null}])('rejects unproven scope or identity',r=>{expect(()=>normalizeCollectedAllocation(r,'100000')).toThrow()})
it('keeps unknown native state unknown',()=>{expect(normalizeCollectedAllocation({...row,hzkj_alloc_status:'new_state'},'100000').rawAllocationStatus).toBeNull()})

it('accepts a missing non-authority operator reference without inventing it',()=>{expect(normalizeCollectedAllocation({...row,hzkj_operator_id:null},'100000').sourceOperatorId).toBeNull()})
it('preserves independent native audit and readiness times',()=>{expect(normalizeCollectedAllocation({...row,auditdate:'2026-11-12 18:30:00'},'100000')).toMatchObject({approvedAt:'2026-11-12T10:30:00.000Z',readyAt:null})})
