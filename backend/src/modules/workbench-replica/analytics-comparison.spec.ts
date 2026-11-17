import { comparisonWindows,comparisonStatement,comparisonMetrics } from './analytics-comparison'
const now=Date.parse('2028-12-31T00:00:00Z')
it('compares week-to-date with the entire previous calendar week',()=>{
 const p=comparisonWindows('week','2026-11-18','2026-11-18T02:30:00Z',now)
 expect(p.current).toMatchObject({from:'2026-11-16',to:'2026-11-18',end:'2026-11-18T02:30:00.000Z'})
 expect(p.previous).toMatchObject({from:'2026-11-09',to:'2026-11-15',end:'2026-11-15T16:00:00.000Z'})
})
it('compares a complete February to a complete January and clamps partial month dates',()=>{
 expect(comparisonWindows('month','2028-02-29','2028-04-01T00:00:00Z',now).previous.to).toBe('2028-01-31')
 expect(comparisonWindows('month','2028-03-30','2028-03-30T02:30:00Z',now).previous).toMatchObject({to:'2028-02-29',end:'2028-02-29T02:30:00.000Z'})
})
it('retains an out-of-policy prior year as unavailable rather than rejecting the current period',()=>{
 expect(comparisonWindows('month','2026-01-10','2026-01-10T00:00:00Z',now).previous.from).toBe('2025-12-01')
})
it('does not silently move a selected week to an older captured week',()=>{
 expect(()=>comparisonWindows('week','2026-11-23','2026-11-18T02:30:00Z',now)).toThrow('Data has not reached')
})
it('uses one statement with isolated parameter numbers',()=>{
 const q=comparisonStatement({sql:'SELECT $1,$2,$10',params:Array(10).fill('a')},{sql:'SELECT $1,$2,$10',params:Array(10).fill('b')})
 expect(q.sql).toContain('SELECT $11,$12,$20');expect(q.params).toHaveLength(20)
})
it('distinguishes zero, new, missing and positive comparisons',()=>{
 expect(comparisonMetrics({orderCount:5},{orderCount:0},'registrations')[0]).toMatchObject({status:'new',delta:5,percent:null})
 expect(comparisonMetrics({orderCount:0},{orderCount:0},'registrations')[0].status).toBe('flat')
 expect(comparisonMetrics({orderCount:15},{orderCount:10},'registrations')[0]).toMatchObject({percent:50,delta:5})
 expect(comparisonMetrics({amountsByCurrency:[{currency:'USD',amount:'1.10'}],missingAmountCount:1},{amountsByCurrency:[{currency:'USD',amount:'1.00'}]},'department_receipts')[0].status).toBe('unavailable')
})
