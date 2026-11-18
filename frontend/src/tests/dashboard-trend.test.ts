import { describe,it,expect } from 'vitest'
import { trendPoints,trendChart } from '@/utils/dashboard-trend'
const data={source:'local' as const,chartId:'order_volume' as const,dimension:'person' as const,id:'p1',grain:'day' as const,from:'2026-11-01',to:'2026-11-03',asOf:'2026-11-03',summaryOnly:false,timeBasis:'customer_paid_at',orderCount:3,totalQuantity:null,amount:null,currency:null,missingAmountCount:0,missingPaidAtCount:0,points:[{period:'2026-11-01',orderCount:2,quantity:null,amount:null},{period:'2026-11-03',orderCount:1,quantity:'5',amount:null}]}
describe('dashboard selected-object trend',()=>{
 it('fills days without orders with zero but retains unknown source quantities',()=>{
  expect(trendPoints(data).map(p=>p.quantity)).toEqual([null,'0','5'])
  expect(trendPoints(data).map(p=>p.orderCount)).toEqual([2,0,1])
  expect((trendChart(data,'quantity','商品件数').series as any[])[0].data).toEqual([null,0,5])
 })
 it('retains partial boundary months and never adds a future month',()=>{
  const result=trendPoints({...data,grain:'month',from:'2026-01-20',to:'2026-03-03',points:[]})
  expect(result.map(p=>p.period)).toEqual(['2026-01','2026-02','2026-03'])
 })
})
