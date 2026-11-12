import { collectedWhere } from './collected-workbench-query'
describe('collected orders filters',()=>{
 it('binds batch and employee authorization',()=>{const q=collectedWhere('batch',['employee'],{queue:'review'});expect(q.params).toEqual(['batch',['employee']]);expect(q.where).toContain('owner_employee_id = ANY');expect(q.where).toContain("raw_bill_status = 'B'")})
 it('retains audited records regardless of payment or cancellation',()=>{const q=collectedWhere('b',null,{queue:'review',completed:true,timeRange:'1w'});expect(q.where).toContain("raw_bill_status = 'C'");expect(q.where).not.toContain('raw_payment_status');expect(q.where).toContain("display->>'reviewedAt'")})
 it('does not invent downstream completion',()=>{expect(collectedWhere('b',null,{queue:'allocation_review'}).where).toContain('FALSE');expect(collectedWhere('b',null,{queue:'exceptions'}).where).toContain("raw_delivery_status IS DISTINCT FROM '2'")})
 it('keeps unknown payment in exceptions',()=>{expect(collectedWhere('b',null,{queue:'exceptions'}).where).toContain("raw_payment_status IS DISTINCT FROM '0'")})
 it('parameterizes searches and empty employee scope',()=>{const q=collectedWhere('b',[],{queue:'unpaid',search:"%' OR TRUE --"});expect(q.params[1]).toEqual([]);expect(q.where).not.toContain('OR TRUE');expect(q.params[2]).toContain('\\%')})
})
