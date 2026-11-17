import { describe,it,expect } from 'vitest'
import { comparisonChart,comparisonDates,periodDates,signedComparisonPercent } from '@/utils/analytics-comparison'
import type { LocalAnalyticsResult } from '@/api/local-dashboard-analytics'
describe('comparison calendar controls',()=>{
 it('uses Monday weeks and historical complete months',()=>{
  expect(periodDates('week','2026-11-18','2026-11-19')).toEqual({from:'2026-11-16',to:'2026-11-19'})
  expect(periodDates('month','2028-02-04','2028-03-01')).toEqual({from:'2028-02-01',to:'2028-02-29'})
 })
})
const row=(id:string,count:number)=>({dimension:'department',id,label:id,currency:null,orderCount:count,amount:null,quantity:String(count)})
function data():LocalAnalyticsResult{return {source:'local',asOf:'2026-11-18T00:00:00Z',summaryOnly:false,orderCount:2,missingCurrencyCount:0,missingAmountCount:0,missingPaidAtCount:0,currencies:[],departments:[],warehouses:[],chartId:'order_volume',rows:[row('a',2)],comparison:{available:true,mode:'week',current:{from:'2026-11-16',to:'2026-11-18',start:'',end:''},previous:{from:'2026-11-09',to:'2026-11-11',start:'',end:''},metrics:[],previousData:{rows:[row('b',4)]} as LocalAnalyticsResult}} as LocalAnalyticsResult}
it('includes prior-only categories and uses zeros only for covered empty categories',()=>{
 const option=comparisonChart(data(),'department','orders',false)!
 expect(option.xAxis.data).toEqual(['a','b'])
 expect(option.series.map(s=>s.data)).toEqual([[0,4],[2,0]])
 expect(comparisonChart({...data(),comparison:{...data().comparison!,available:false}},'department','orders',false)).toBeUndefined()
})
it('aligns daily trend progress and includes actual dates in tooltips',()=>{
 const d=data();d.rows=[{...row('2026-11-16',2),dimension:'day'}];d.comparison!.previousData!.rows=[{...row('2026-11-09',4),dimension:'day'}]
 const option=comparisonChart(d,'month','orders',false)!
 expect(option.series[1].data).toEqual([2,0,0]);expect(option.series[0].lineStyle.type).toBe('dashed')
 expect(option.tooltip.formatter([{dataIndex:0,seriesIndex:0,value:4,seriesName:'上期'}])).toContain('2026-11-09')
})
it('does not fill nonexistent February days with zeros',()=>{
 const d=data();d.comparison!.mode='month';d.comparison!.current={from:'2028-03-01',to:'2028-03-31',start:'',end:''};d.comparison!.previous={from:'2028-02-01',to:'2028-02-29',start:'',end:''}
 expect(comparisonChart(d,'month','orders',false)!.series[0].data.slice(-2)).toEqual([null,null])
})
it('keeps department subtotals and all salespeople together in comparison bars',()=>{
 const d=data();d.chartId='salesperson_receipts'
 const department={...row('d1',1),label:'业务一部',currency:'USD',amount:'10.00'}
 const person={...row('p1',1),dimension:'person',label:'甲',currency:'USD',amount:'10.00',departmentId:'d1',departmentName:'业务一部',englishName:'Alex'}
 d.rows=[department,person];d.comparison!.previousData!.rows=[{...department,amount:'5.00'},{...person,amount:'5.00'}]
 const chart=comparisonChart(d,'person','orders',true)!
 expect(chart.xAxis.data).toEqual(['业务一部','Alex'])
 expect(chart.series.map(s=>s.data)).toEqual([[5,5],[10,10]])
 expect(chart.tooltip.formatter([{dataIndex:1,seriesIndex:0,value:5,seriesName:'上期'},{dataIndex:1,seriesIndex:1,value:10,seriesName:'本期'}])).toContain('本期订单量：1 笔')
})
it('does not draw missing monetary facts as zero comparison bars',()=>{
 const d=data();d.missingAmountCount=1
 expect(comparisonChart(d,'department','orders',true)).toBeUndefined()
})

it('shows both complete historical weeks and current incomplete week with full previous week',()=>{
 expect(comparisonDates('week','2026-11-03','2026-11-17')).toEqual({from:'2026-10-26',to:'2026-11-08',current:{from:'2026-11-02',to:'2026-11-08'},previous:{from:'2026-10-26',to:'2026-11-01'}})
 expect(comparisonDates('week','2026-11-16','2026-11-17')).toEqual({from:'2026-11-09',to:'2026-11-17',current:{from:'2026-11-16',to:'2026-11-17'},previous:{from:'2026-11-09',to:'2026-11-15'}})
})

it('orders previous before current while preserving their colors and legend',()=>{
 const chart=comparisonChart(data(),'department','orders',false)!
 expect(chart.series.map(s=>[s.name,s.itemStyle.color])).toEqual([['上期','#91a7d6'],['本期','#5368be']])
 expect(chart.legend.data).toEqual(['上期','本期'])
})

it.each(['week','month'] as const)('keeps customer axis labels but shows their owner in %s tooltips, including prior-only customers',mode=>{
 const d=data();d.chartId='customer_orders'
 d.comparison!.mode=mode
 d.rows=[{...row('c1',2),dimension:'customer',label:'Same Customer',customerOwnerName:'叶力铭（Jenny）'}]
 d.comparison!.previousData!.rows=[{...row('c1',4),dimension:'customer',label:'Same Customer',customerOwnerName:'叶力铭（Jenny）'},{...row('c2',3),dimension:'customer',label:'Same Customer',customerOwnerName:'陈宣竹（Joy）'}]
 const chart=comparisonChart(d,'customer','orders',false)!
 expect(chart.xAxis.data).toEqual(['Same Customer','Same Customer'])
 expect(chart.tooltip.formatter([{dataIndex:0,seriesIndex:0,value:4,seriesName:'上期'},{dataIndex:0,seriesIndex:1,value:2,seriesName:'本期'}])).toBe('业务员：叶力铭（Jenny）\n上期订单数：4\n本期订单数：2\n订单数环比：-50.00%')
 expect(chart.tooltip.formatter([{dataIndex:1,seriesIndex:0,value:3,seriesName:'上期'},{dataIndex:1,seriesIndex:1,value:0,seriesName:'本期'}])).toBe('业务员：陈宣竹（Joy）\n上期订单数：3\n本期订单数：0\n订单数环比：-100.00%')
})
it('does not borrow an earlier owner for a current unresolved customer and keeps quantity gaps explicit',()=>{
 const d=data();d.chartId='customer_orders'
 d.rows=[{...row('c1',2),dimension:'customer',label:'Customer',quantity:null,customerOwnerName:null}]
 d.comparison!.previousData!.rows=[{...row('c1',4),dimension:'customer',label:'Customer',quantity:'8',customerOwnerName:'Old owner'}]
 const chart=comparisonChart(d,'customer','quantity',false)!
 expect(chart.tooltip.formatter([{dataIndex:0,seriesIndex:0,value:8,seriesName:'上期'},{dataIndex:0,seriesIndex:1,value:null,seriesName:'本期'}])).toBe('业务员：未绑定业务员\n上期订单数：4\n上期商品件数：8\n本期订单数：2\n本期商品件数：—\n订单数环比：-50.00%\n商品件数环比：—')
})
it('shows the complete salesperson name in customer-order comparison tooltips',()=>{
 const d=data();d.chartId='customer_orders'
 d.rows=[{...row('p1',2),dimension:'person',label:'叶力铭（Jenny）',englishName:'Jenny',departmentName:'业务一部'}]
 const chart=comparisonChart(d,'person','orders',false)!
 expect(chart.tooltip.formatter([{dataIndex:0,seriesIndex:1,value:2,seriesName:'本期'}])).toBe('业务员：叶力铭（Jenny）\n本期订单数：2\n订单数环比：—')
})

it.each(['registrations','order_volume'] as const)('groups %s comparisons by department, including prior-only people and departments',chartId=>{
 const d=data();d.chartId=chartId
 const department={...row('d1',2),label:'业务一部'}
 const person={...row('p1',2),dimension:'person',departmentId:'d1',englishName:'Alex'}
 d.rows=[department,person]
 d.comparison!.previousData!.rows=[{...row('d2',3),label:'业务二部'},{...person,id:'p2',departmentId:'d2',englishName:'Wendy',orderCount:3}]
 const chart=comparisonChart(d,'person','orders',false)!
 expect(chart.xAxis.data).toEqual(['业务一部','Alex','','业务二部','Wendy'])
 expect(chart.series.map(s=>s.data)).toEqual([[0,0,null,3,3],[2,2,null,0,0]])
 expect(chart.yAxis.minInterval).toBe(1)
})

it('groups customer order comparisons using owner-department subtotals and keeps unknown quantities null',()=>{
 const d=data();d.chartId='customer_orders'
 d.rows=[{...row('d1',99),label:'业务一部'},
  {...row('d2',2),dimension:'person_department',label:'业务二部',quantity:null},
  {...row('p1',2),dimension:'person',label:'张博（Bob）',englishName:'Bob',departmentId:'d2',departmentName:'业务二部',quantity:null}]
 d.comparison!.previousData!.rows=[{...row('d1',3),dimension:'person_department',label:'业务一部',quantity:'6'},
  {...row('p2',3),dimension:'person',label:'甲（Alex）',englishName:'Alex',departmentId:'d1',departmentName:'业务一部',quantity:'6'}]
 const chart=comparisonChart(d,'person','quantity',false)!
 expect(chart.xAxis.data).toEqual(['业务一部','Alex','','业务二部','Bob'])
 expect(chart.series.map(s=>s.data)).toEqual([[6,6,null,0,0],[0,0,null,null,null]])
 const tooltip=chart.tooltip.formatter([{dataIndex:3,seriesIndex:1,value:null,seriesName:'本期'}])
 expect(tooltip).toContain('业务二部')
 expect(tooltip).not.toContain('业务员：业务二部')
 expect(tooltip).toContain('本期订单数：2')
 expect(tooltip).toContain('本期商品件数：—\n订单数环比：—\n商品件数环比：—')
})

it.each([[125,100,'+25.00%'],[75,100,'-25.00%'],[100,100,'0.00%'],[-75,-100,'+25.00%'],[2,0,'—'],[null,1,'—']])('formats signed comparison %s versus %s',(current,previous,expected)=>{expect(signedComparisonPercent(current as number|null,previous as number)).toBe(expected)})
it.each(['week','month'] as const)('keeps fixed department order and signed amount percentages for %s',mode=>{
 const d=data();d.chartId='department_receipts';d.comparison!.mode=mode
 d.rows=['业务四部','业务三部','业务二部','业务一部'].map((label,i)=>({...row(String(i),1),label,currency:'USD',amount:String(1000-i*100)}))
 d.comparison!.previousData!.rows=d.rows.map(r=>({...r,amount:'500'}))
 const chart=comparisonChart(d,'department','orders',true)!
 expect(chart.xAxis.data).toEqual(['业务一部','业务二部','业务三部','业务四部'])
 expect(chart.tooltip.formatter([{dataIndex:0,seriesIndex:1,value:700,seriesName:'本期'}])).toContain('金额环比：+40.00%')
})
