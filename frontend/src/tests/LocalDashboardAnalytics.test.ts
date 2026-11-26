import { mount,flushPromises as flushVuePromises } from '@vue/test-utils'
import { describe,it,expect,vi,beforeEach,afterEach } from 'vitest'
import LocalDashboardAnalytics from '@/components/charts/LocalDashboardAnalytics.vue'
const get=vi.hoisted(()=>vi.fn())
vi.mock('@/api/local-dashboard-analytics',()=>({getLocalDashboardAnalytics:get,getLocalDashboardTrend:vi.fn()}))
vi.mock('@/utils/session',async original=>({...await original<object>(),onSessionReset:()=>()=>{}}))
vi.mock('@/components/charts/EChart.vue',()=>({default:{name:'EChart',props:['option','label'],template:'<div data-chart />'}}))
const value={source:'local',asOf:'2026-11-12T00:00:00Z',summaryOnly:false,rows:[{dimension:'month',id:'2026-11',label:'2026-11',currency:null,orderCount:42,amount:null,quantity:'71'}],orderCount:42,departments:[{id:'d1',name:'业务一部'}],warehouses:[],currencies:[],missingCurrencyCount:42,missingAmountCount:0,missingPaidAtCount:2}
beforeEach(()=>{vi.useFakeTimers();get.mockReset();get.mockResolvedValue(value)})
it.each(['customer_orders','order_volume'] as const)('groups %s main metrics with matching department subtotals',async chartId=>{
 for(const metric of chartId==='customer_orders'?['amount']:['orders','quantity']){
 const row=(dimension:string,id:string,label:string,count:number,quantity:string|null,extra={})=>({...value.rows[0],dimension,id,label,orderCount:count,quantity,...(metric==='amount'?{currency:'USD',amount:String(count*10+0.25)}:{}),...extra})
 get.mockResolvedValue({...value,chartId,orderCount:10,totalQuantity:'30',rows:[
  ...(chartId==='customer_orders'?[row('department','d1','业务一部',10,'30')]:[]),
  ...[4,2,3,1].flatMap(i=>[
   row(chartId==='customer_orders'?'person_department':'department',`d${i}`,`业务${['一','二','三','四'][i-1]}部`,i,String(i*3)),
   row('person',`p${i}`,'中文名',i,String(i*3),{departmentId:`d${i}`,englishName:`Person${i}`}),
  ]),
 ]})
 const w=mount(LocalDashboardAnalytics,{props:{chartId,title:'订单分析'}});await flushPromises()
 await w.find('.analysis-controls select').setValue('person')
 if(metric!=='amount')await w.findAll('.analysis-controls select')[1]!.setValue(metric)
 const chart=w.findComponent({name:'EChart'}).props('option')
 expect(chart.xAxis.data).toEqual(['业务一部','Person1','','业务二部','Person2','','业务三部','Person3','','业务四部','Person4'])
 expect(chart.series[0].data.map((r:any)=>r?.value??null)).toEqual(metric==='amount'?[10.25,10.25,null,20.25,20.25,null,30.25,30.25,null,40.25,40.25]:metric==='orders'?[1,1,null,2,2,null,3,3,null,4,4]:[3,3,null,6,6,null,9,9,null,12,12])
 expect(chart.tooltip.formatter([{dataIndex:0,seriesIndex:0,value:metric==='amount'?10.25:metric==='orders'?1:3}])).toContain(metric==='amount'?'订单量：1 笔':'订单数：1')
 if(metric==='quantity')expect(chart.tooltip.formatter([{dataIndex:0,seriesIndex:0,value:3}])).toContain('商品件数：3')
 expect(w.find('.analysis-controls').text()).toContain('10 笔')
 expect(w.text()).not.toContain('前 20 项')
 w.unmount()
 }
})

it.each([
 ['registrations',['注册日期','业务员','月度趋势'],'day'],
 ['salesperson_receipts',['业务员','月度趋势'],'person'],
 ['order_volume',['业务员','客户','仓库','国家','月度趋势'],'person'],
 ['customer_orders',['客户','业务员','月度趋势'],'customer'],
] as const)('merges the department dimension into salesperson without changing the %s default',async(chartId,labels,initial)=>{
 const w=mount(LocalDashboardAnalytics,{props:{chartId,title:'统计'}});await flushPromises()
 const selector=w.get('.analysis-controls select')
 expect(selector.findAll('option').map(o=>o.text())).toEqual(labels)
 expect((selector.element as HTMLSelectElement).value).toBe(initial)
 expect(w.find('select[aria-label="业务部门"]').exists()).toBe(true)
 w.unmount()
})
it('groups registrations by department with scoped counts, English names and no duplicate total',async()=>{
 const row=(dimension:string,id:string,label:string,count:number,extra={})=>({dimension,id,label,registrationCount:count,orderCount:count,amount:null,quantity:null,currency:null,...extra})
 get.mockResolvedValue({...value,chartId:'registrations',registrationCount:9,orderCount:9,rows:[
  row('department','d2','业务二部',4),row('department','d1','业务一部',5),
  row('person','a','甲',2,{departmentId:'d1',englishName:'Alex'}),
  row('person','b','乙',3,{departmentId:'d1',englishName:'Wendy'}),
  row('person','c','丙',4,{departmentId:'d2',englishName:'Alex'}),
 ]})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'registrations',title:'客户注册统计'}});await flushPromises()
 await w.find('.analysis-controls select').setValue('person')
 const chart=w.findComponent({name:'EChart'}).props('option')
 expect(chart.xAxis.data).toEqual(['业务一部','Wendy','Alex','','业务二部','Alex'])
 expect(chart.series[0].data.map((d:any)=>d===null?null:d.value)).toEqual([5,3,2,null,4,4])
 expect(chart.yAxis).toMatchObject({minInterval:1});expect(chart.yAxis.name).toBeUndefined()
 expect(chart.tooltip.formatter([{dataIndex:1,seriesIndex:0,value:3}])).toContain('注册客户数：3')
 expect(w.find('.analysis-controls').text()).toContain('9 位注册客户')
 expect(w.find('.revenue-legend').exists()).toBe(true)
 expect(w.text()).not.toContain('前 20 项')
 w.unmount()
})
it('groups salesperson bars by department with a subtotal first, English labels and gaps',async()=>{
 const row=(dimension:string,id:string,label:string,amount:string,extra={})=>({dimension,id,label,amount,currency:'USD',orderCount:1,quantity:'1',...extra})
 get.mockResolvedValue({...value,missingPaidAtCount:0,missingCurrencyCount:0,currencies:['USD'],amountsByCurrency:[{currency:'USD',amount:'170.70',orderCount:4}],rows:[
  row('department','d2','业务二部','100.00'),row('department','d1','业务一部','70.70'),
  row('person','a','甲（Alex）','30.30',{departmentId:'d1',englishName:'Alex'}),
  row('person','c','丙（Alex）','100.00',{departmentId:'d2',englishName:'Alex'}),
  row('person','b','乙（Wendy）','40.40',{departmentId:'d1',englishName:'Wendy'}),
 ]})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'salesperson_receipts',title:'业务员业绩收入'}});await flushPromises()
 const chart=()=>w.findComponent({name:'EChart'}).props('option')
 expect(chart().xAxis.data).toEqual(['业务一部','Wendy','Alex','','业务二部','Alex'])
 expect(chart().series[0].data.map((d:any)=>d===null?null:d.value)).toEqual([70.7,40.4,30.3,null,100,100])
 expect(chart().series[0].data[0].itemStyle.color).not.toBe(chart().series[0].data[1].itemStyle.color)
 expect(chart().tooltip.formatter([{dataIndex:5,seriesIndex:0,value:100}])).toContain('业务二部')
 expect(chart().tooltip.formatter([{dataIndex:5,seriesIndex:0,value:100}])).toContain('订单量：1 笔')
 expect(w.find('.income-total').text()).toContain('$170.70')
 expect(w.text()).not.toContain('前 20 项')
 expect(w.find('.analysis-controls select').find('option[value="department"]').exists()).toBe(false)
 w.unmount()
})
it.each(['salesperson_receipts','registrations','customer_orders','order_volume'] as const)('keeps every salesperson in their department for %s',async(chartId)=>{
 const people=Array.from({length:22},(_,i)=>({dimension:'person',id:`p${i}`,label:`员工${i}`,englishName:`Person${i}`,departmentId:'d1',currency:'USD',orderCount:1,amount:'1.00',quantity:'1'}))
 get.mockResolvedValue({...value,rows:[{...people[0],id:'d1',dimension:'department',label:'业务一部',amount:'22.00'},...people],missingCurrencyCount:0})
 const w=mount(LocalDashboardAnalytics,{props:{chartId,title:'统计'}});await flushPromises()
 await w.find('.analysis-controls select').setValue('person')
 const chart=w.findComponent({name:'EChart'}).props('option')
 expect(chart.xAxis.data).toHaveLength(23)
 expect(chart.xAxis.axisLabel.interval).toBe(0)
 expect(w.find('.chart').classes()).toContain('grouped-revenue')
 w.unmount()
})
it.each(['salesperson_receipts','registrations','customer_orders','order_volume'] as const)('keeps %s controls consistent without exposing personal summary rows',async(chartId)=>{
 get.mockResolvedValue({...value,summaryOnly:true,rows:[
  {...value.rows[0],id:'d1',dimension:'department',label:'业务一部',currency:'USD',amount:'100.00'},
  {...value.rows[0],id:'p1',dimension:'person',label:'张三（Alex）',englishName:'Alex',departmentId:'d1',currency:'USD',amount:'100.00'},
 ]})
 const w=mount(LocalDashboardAnalytics,{props:{chartId,title:'统计'}});await flushPromises()
 expect(w.find('[aria-label="展示维度"]').exists()).toBe(true)
 expect(w.find('.analysis-controls').text()).toContain('展示维度')
 expect(w.findAll('option').map(o=>o.text())).toContain('月度趋势')
 expect(w.find('.revenue-legend').exists()).toBe(false)
 expect(w.text()).not.toContain('Alex');w.unmount()
})
it('distinguishes unpaid exclusions from paid orders missing the FOP receipt date',async()=>{
 get.mockResolvedValue({...value,missingPaidAtCount:30060,missingPaidAtBreakdown:{unpaid:29938,paid:122,unknown:0}})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'订单量分析'}});await flushPromises()
 expect(w.text()).toContain('收款日期')
 expect(w.find('.payment-date-note').text()).toContain('未收款 29,938 笔未计入')
 expect(w.find('.payment-date-warning').text()).toContain('已收款缺日期 122 笔')
 expect(w.find('.payment-date-note').attributes('title')).toContain('不限定所选付款期间')
 expect(w.text()).not.toContain('30,060 笔缺少客户付款时间')
 w.unmount()
})
it('does not mark unpaid orders as missing-date warnings or unknown statuses as unpaid',async()=>{
 get.mockResolvedValue({...value,missingPaidAtCount:2,missingPaidAtBreakdown:{unpaid:2,paid:0,unknown:0}})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'订单量分析'}});await flushPromises()
 expect(w.find('.payment-date-warning').exists()).toBe(false)
 get.mockResolvedValue({...value,missingPaidAtCount:2,missingPaidAtBreakdown:{unpaid:0,paid:0,unknown:2}})
 await w.find('form').trigger('submit');await flushPromises()
 expect(w.find('.payment-date-warning').text()).toContain('收款信息待核查 2 笔')
 expect(w.find('.payment-date-note').text()).not.toContain('未收款')
 w.unmount()
})
it('keeps customer axis names while tooltips use the corresponding customer owner and amount data',async()=>{
 get.mockResolvedValue({...value,rows:[{...value.rows[0],currency:'USD',amount:'42'},
  {...value.rows[0],dimension:'customer',id:'c1',label:'Same Customer',currency:'USD',amount:'10',orderCount:2,quantity:'4',customerOwnerName:'叶力铭（Jenny）'},
  {...value.rows[0],dimension:'customer',id:'c2',label:'Same Customer',currency:'USD',amount:'30',orderCount:12,quantity:null,customerOwnerName:'陈宣竹（Joy）'},
  {...value.rows[0],dimension:'department',id:'d1',label:'业务一部'},
 ]})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'customer_orders',title:'客户订单分析'}});await flushPromises()
 const chart=()=>w.findComponent({name:'EChart'}).props('option')
 expect(chart().xAxis.data).toEqual(['Same Customer','Same Customer'])
 expect(chart().tooltip.formatter([{dataIndex:0}])).toBe('业务员：陈宣竹（Joy）\n订单金额：$30.00\n订单数：12')
 expect(chart().tooltip.formatter([{dataIndex:1}])).toBe('业务员：叶力铭（Jenny）\n订单金额：$10.00\n订单数：2')
 await w.find('.analysis-controls select').setValue('month')
 expect(chart().tooltip.formatter([{dataIndex:0,seriesIndex:0,value:42}])).toContain('订单金额：$42.00\n订单量：42 笔')
 w.unmount()
})
it('offers salesperson second and displays amounts with supporting counts under salesperson names',async()=>{
 get.mockResolvedValue({...value,rows:[
  {...value.rows[0],dimension:'person',id:'p1',label:'叶力铭（Jenny）',currency:'USD',amount:'100',orderCount:8,quantity:'12'},
  {...value.rows[0],dimension:'person',id:'p2',label:'陈宣竹（Joy）',currency:'USD',amount:'50',orderCount:34,quantity:'59'},
 ]})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'customer_orders',title:'客户订单分析'}});await flushPromises()
 const selector=w.find('.analysis-controls select')
 expect(selector.findAll('option').map(o=>o.text())).toEqual(['客户','业务员','月度趋势'])
 await selector.setValue('person')
 const option=w.findComponent({name:'EChart'}).props('option')
 expect(option.xAxis.data).toEqual(['叶力铭（Jenny）','陈宣竹（Joy）'])
 expect(option.series[0].data).toEqual([100,50]);expect(option.tooltip.formatter([{dataIndex:0,seriesIndex:0,value:100}])).toContain('订单量：8 笔')
 w.unmount()
})
it('shows an explicit unavailable owner instead of reusing the customer name',async()=>{
 get.mockResolvedValue({...value,rows:[{...value.rows[0],dimension:'customer',id:'c1',label:'Customer',currency:'USD',amount:'5',customerOwnerName:null}]})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'customer_orders',title:'客户订单分析'}});await flushPromises()
 const chart=w.findComponent({name:'EChart'}).props('option')
 expect(chart.tooltip.formatter([{dataIndex:0}])).toBe('业务员：未绑定业务员\n订单金额：$5.00\n订单数：42')
 expect(chart.xAxis.data).toEqual(['Customer']);w.unmount()
})
afterEach(()=>vi.useRealTimers())
it.each(['registrations','order_volume','customer_orders','department_receipts','salesperson_receipts'] as const)('automatically queries the completed date range for %s',async chartId=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-17T00:00:00Z'))
 const w=mount(LocalDashboardAnalytics,{props:{chartId,title:'分析'}});await flushPromises()
 const dates=w.findAll('input[type="date"]')
 await dates[0]!.setValue('2026-10-01');await vi.advanceTimersByTimeAsync(200)
 await dates[1]!.setValue('2026-10-31');await vi.advanceTimersByTimeAsync(400);await flushPromises()
 expect(get).toHaveBeenCalledTimes(2)
 expect(get.mock.lastCall?.[0]).toMatchObject({from:'2026-10-01',to:'2026-10-31'})
 await dates[0]!.setValue('2026-10-01');await vi.advanceTimersByTimeAsync(400)
 expect(get).toHaveBeenCalledTimes(2)
 w.unmount()
})
it('keeps the existing result and makes no request for incomplete, inverted or uncaptured dates',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-17T00:00:00Z'))
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'registrations',title:'注册',availableWindow:{from:'2026-01-01',to:'2026-11-16',asOf:'2026-11-16T00:00:00Z'}}});await flushPromises()
 const dates=w.findAll('input[type="date"]')
 for(const [from,to] of [['2025-12-31','2026-10-31'],['','2026-10-31'],['2026-11-01','2026-10-31'],['2026-11-01','2026-11-17']]){
  await dates[0]!.setValue(from);await dates[1]!.setValue(to);await vi.advanceTimersByTimeAsync(400)
  expect(get).toHaveBeenCalledTimes(1);expect(w.text()).toContain('42 位注册客户')
 }
 w.unmount()
})
it('does not repeat a manual query or query after unmount while a date query is pending',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-17T00:00:00Z'))
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'分析'}});await flushPromises()
 await w.findAll('input[type="date"]')[0]!.setValue('2026-10-01')
 await w.find('form').trigger('submit');await flushPromises();await vi.advanceTimersByTimeAsync(400)
 expect(get).toHaveBeenCalledTimes(2)
 await w.findAll('input[type="date"]')[0]!.setValue('2026-10-02');w.unmount()
 await vi.advanceTimersByTimeAsync(400);expect(get).toHaveBeenCalledTimes(2)
})
it('keeps the chart while loading and ignores an older date response arriving last',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-17T00:00:00Z'))
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'分析'}});await flushPromises()
 await w.get('select[aria-label="展示维度"]').setValue('month')
 let finishOld!:(result:typeof value)=>void
 get.mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve}))
 await w.findAll('input[type="date"]')[0]!.setValue('2026-10-01')
 await vi.advanceTimersByTimeAsync(400)
 expect(w.find('[data-chart]').exists()).toBe(true);expect(w.find('.chart').attributes('aria-busy')).toBe('true')
 get.mockResolvedValue({...value,orderCount:7})
 await w.findAll('input[type="date"]')[0]!.setValue('2026-11-01')
 await vi.advanceTimersByTimeAsync(400);await flushPromises()
 finishOld({...value,orderCount:99});await flushPromises()
 expect(w.text()).toContain('7 笔');expect(w.text()).not.toContain('99 笔')
 w.unmount()
})
it.each([
 ['marketing','营销中心',[{id:'marketing',name:'营销中心'},{id:'d1',name:'业务一部'},{id:'d2',name:'业务二部'}]],
 ['d1','业务一部',[{id:'d1',name:'业务一部'}]],
])('uses server default %s without a duplicate all-scope choice',async(id,label,departments)=>{
 get.mockResolvedValue({...value,defaultDepartmentId:id,departments})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'registrations',title:'客户注册统计'}});await flushPromises()
 const select=w.get('select[aria-label="业务部门"]')
 expect((select.element as HTMLSelectElement).value).toBe(id)
 expect(select.findAll('option').map(o=>o.text())).toEqual(departments.map(d=>d.name))
 expect(select.text()).not.toContain('授权范围')
 expect(select.findAll('option').filter(o=>o.text()===label)).toHaveLength(1)
 await w.find('form').trigger('submit');await flushPromises()
 expect(get.mock.lastCall?.[0].departmentId).toBe(id)
 w.unmount()
})
describe('local dashboard analytics',()=>{
 it('renders database aggregates into ECharts and applies filters to the local request',async()=>{
  const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'订单量分析'}});await flushPromises()
  await w.get('select[aria-label="展示维度"]').setValue('month')
  expect(w.find('[data-chart]').exists()).toBe(true);expect(w.text()).toContain('42 笔')
  await w.findAll('select')[0]!.setValue('d1');await w.find('form').trigger('submit');await flushPromises()
  expect(get.mock.lastCall?.[0]).toMatchObject({chartId:'order_volume',departmentId:'d1',entityType:'fulfillment'})
  expect(w.findComponent({name:'EChart'}).exists()||w.find('[data-chart]').exists()).toBe(true)
 })
 it('does not invent income or a currency when source currency is missing',async()=>{
  get.mockResolvedValue({...value,rows:[]})
  const w=mount(LocalDashboardAnalytics,{props:{chartId:'department_receipts',title:'部门业绩收入'}});await flushPromises()
  expect(w.text()).toContain('订单结算币种待补齐');expect(w.find('[data-chart]').exists()).toBe(false)
  expect(w.text()).not.toContain('$0')
 })
 it('clears previous results on a failed request',async()=>{
  const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'订单量分析'}});await flushPromises()
  get.mockRejectedValue(new Error('forbidden'));await w.find('form').trigger('submit');await flushPromises()
  expect(w.find('[data-chart]').exists()).toBe(false);expect(w.text()).toContain('加载失败')
 })
 it('hides customer dimensions when only department summaries are authorized',async()=>{
  get.mockResolvedValue({...value,summaryOnly:true,rows:[]})
  const w=mount(LocalDashboardAnalytics,{props:{chartId:'customer_orders',title:'客户订单分析'}});await flushPromises()
  expect(w.findAll('option').map(o=>o.text())).not.toContain('客户')
 })
})
it('shows salesperson revenue in USD, ranked by amount rather than order count',async()=>{
 get.mockResolvedValue({...value,missingCurrencyCount:0,currencies:['USD'],amountsByCurrency:[{currency:'USD',amount:'1050.25',orderCount:42}],rows:[{dimension:'person',id:'a',label:'Alex',currency:'USD',orderCount:40,amount:'50.25',quantity:'40'},{dimension:'person',id:'b',label:'Wendy',currency:'USD',orderCount:2,amount:'1000.00',quantity:'2'}]})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'salesperson_receipts',title:'业务员业绩收入'}});await flushPromises()
 expect(w.text()).toContain('$1,050.25');expect(w.text()).not.toContain('USD')
 expect(w.find('[data-chart]').exists()).toBe(true)
 const component=w.findComponent({name:'EChart'})
 expect(component?.props('option').xAxis.data).toEqual(['Wendy','Alex'])
 const chart=component.props('option')
 expect(chart.series[0].name).toBe('订单金额');expect(chart.series[0].data).toEqual([1000,50.25])
 expect(chart.tooltip.valueFormatter(1000)).toBe('$1,000.00')
 expect(chart.series[0].tooltip.valueFormatter(50.25)).toBe('$50.25')
 expect(chart.yAxis.axisLabel.formatter(1000)).toBe('$1,000.00')
 const dimensionSelect=w.get('.analysis-controls select')
 expect(dimensionSelect.findAll('option').map(option=>option.text())).toEqual(['业务员','月度趋势'])
 expect((dimensionSelect.element as HTMLSelectElement).value).toBe('person')
 expect(w.find('[aria-label="币种"]').exists()).toBe(false)
 expect(get.mock.lastCall?.[0].currency).toBe('USD')
 w.unmount()
})
it('fixes department performance to USD without a currency control and formats all chart money with dollars',async()=>{
 get.mockResolvedValue({...value,missingCurrencyCount:0,currencies:['USD','CNY'],amountsByCurrency:[{currency:'USD',amount:'1234.56',orderCount:2},{currency:'CNY',amount:'9000.00',orderCount:1}],rows:['department','month'].flatMap(dimension=>[{...value.rows[0],dimension,currency:'USD',amount:'1234.56'},{...value.rows[0],dimension,currency:'CNY',amount:'9000.00'}])})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'department_receipts',title:'部门业绩收入分析'}});await flushPromises()
 expect(get.mock.lastCall?.[0]).toMatchObject({chartId:'department_receipts',currency:'USD'})
 expect(w.findAll('label').some(label=>label.text().startsWith('币种'))).toBe(false)
 expect(w.text()).not.toContain('分别展示');expect(w.get('.income-total').text()).toContain('$1,234.56');expect(w.get('.income-total').text()).not.toContain('9,000.00')
 const chart=w.findComponent({name:'EChart'}).props('option')
 expect(chart.series).toHaveLength(1);expect(chart.series[0].name).toBe('订单金额');expect(chart.series[0].data).toEqual([1234.56]);expect(chart.legend.show).toBe(false)
 const dimensionSelect=w.get('.analysis-controls select')
 expect((dimensionSelect.element as HTMLSelectElement).value).toBe('department')
 expect(dimensionSelect.findAll('option').map(option=>option.text())).toEqual(['业务部门','月度趋势'])
 expect(chart.series[0].type).toBe('bar')
 expect(chart.yAxis.name).toBeUndefined();expect(chart.yAxis.axisLabel.formatter(1000)).toBe('$1,000.00')
 expect(chart.tooltip.formatter([{axisValueLabel:'业务三部',seriesIndex:0,value:1234.56}])).toBe('业务三部\n订单金额：$1,234.56');
 expect(chart.tooltip.valueFormatter(1234.56)).toBe('$1,234.56');expect(chart.tooltip.valueFormatter(null)).toBe('—')
 await dimensionSelect.setValue('month')
 expect(w.findComponent({name:'EChart'}).props('option').series[0].type).toBe('line')
 await w.findAll('select')[0]!.setValue('d1');await w.find('form').trigger('submit');await flushPromises()
 expect(get.mock.lastCall?.[0]).toMatchObject({departmentId:'d1',currency:'USD'})
 w.unmount()
})
it('shows customer creation registrations with no order/quantity filter or FOP request',async()=>{
 get.mockResolvedValue({...value,chartId:'registrations',rows:[{...value.rows[0],dimension:'day',id:'2026-11-01',label:'2026-11-01',registrationCount:42}],registrationCount:42,missingPaidAtCount:0,missingCreatedAtCount:2,unmatchedOwnerCount:1})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'registrations',title:'客户注册统计'}});await flushPromises()
 expect(w.text()).toContain('42 位注册客户')
 expect(w.text()).toContain('客户创建时间')
 expect(w.text()).toContain('2 位客户缺少创建时间')
 expect(w.text()).not.toContain('订单类型')
 expect(w.text()).not.toContain('商品件数')
 expect(get.mock.lastCall?.[0]).toMatchObject({chartId:'registrations',entityType:undefined})
 expect(w.findAll('option').map(o=>o.text())).toContain('业务员')
 w.unmount()
})
it('registration summary grants preserve date aggregates without personal dimensions',async()=>{
 get.mockResolvedValue({...value,summaryOnly:true,rows:[],registrationCount:0})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'registrations',title:'客户注册统计'}});await flushPromises()
 const options=w.findAll('option').map(o=>o.text())
 expect(options).not.toContain('业务员');expect(options).toContain('业务部门');expect(options).toContain('月度趋势');expect(options).toContain('注册日期')
 w.unmount()
})

it('registration daily trends remain chronological, untruncated and keep month optional',async()=>{
 const rows=Array.from({length:25},(_,i)=>({...value.rows[0],dimension:'day',id:`2026-11-${String(i+1).padStart(2,'0')}`,label:`2026-11-${String(i+1).padStart(2,'0')}`,registrationCount:i+1,orderCount:i+1}))
 get.mockResolvedValue({...value,rows,registrationCount:325})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'registrations',title:'客户注册统计'}});await flushPromises()
 const chart=w.findComponent({name:'EChart'}).props('option')
 expect(chart.xAxis.data).toEqual(rows.map(r=>r.label));expect(chart.series[0].type).toBe('line')
 expect(w.findAll('select').at(-1)!.element.value).toBe('day')
 expect(w.findAll('select').at(-1)!.findAll('option').map(o=>o.text())).toEqual(['注册日期','业务员','月度趋势'])
 expect(w.text()).not.toContain('前 20 项');w.unmount()
})
it.each([
 ['local_analytics_capture_unavailable','客户注册数据尚未完成本地采集'],
 ['registration_window_not_captured','所选创建日期尚未完整采集'],
 ['unexpected','分析数据加载失败'],
])('shows a safe registration availability message for %s',async(code,message)=>{
 get.mockRejectedValue({code,statusCode:503,message:'untrusted server details'})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'registrations',title:'客户注册统计'}});await flushPromises()
 expect(w.text()).toContain(message);expect(w.text()).not.toContain('untrusted server details');expect(w.text()).not.toContain('0 位注册客户');expect(w.find('[data-chart]').exists()).toBe(false)
 w.unmount()
})

it('also accepts the known availability code from an unwrapped Axios response',async()=>{
 get.mockRejectedValue({response:{data:{code:'local_analytics_capture_unavailable',message:'untrusted server details'}}})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'registrations',title:'客户注册统计'}});await flushPromises()
 expect(w.text()).toContain('客户注册数据尚未完成本地采集');expect(w.text()).not.toContain('untrusted server details')
 w.unmount()
})

it('defaults registrations to the captured business day after the calendar advances',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-17T01:00:00Z'))
 try{
  get.mockResolvedValue({...value,rows:[{...value.rows[0],dimension:'day',id:'2026-11-09',label:'2026-11-09',registrationCount:42}],registrationCount:42})
  const w=mount(LocalDashboardAnalytics,{props:{chartId:'registrations',title:'客户注册统计',availableWindow:{from:'1970-01-01',to:'2026-11-16',asOf:'2026-11-16T10:41:50Z'}}})
  await flushPromises()
  expect(get.mock.lastCall?.[0]).toMatchObject({from:'2026-11-01',to:'2026-11-16'})
  expect((w.get('input[aria-label="客户创建结束日期"]').element as HTMLInputElement).value).toBe('2026-11-16')
  expect(w.get('input[aria-label="客户创建结束日期"]').attributes('max')).toBe('2026-11-16')
  expect(w.text()).toContain('可查询至 2026-11-16');expect(w.text()).toContain('42 位注册客户')
  await w.findAll('input[type="date"]')[0]!.setValue('2026-11-01');await w.find('form').trigger('submit');await flushPromises()
  expect(get.mock.lastCall?.[0]).toMatchObject({from:'2026-11-01',to:'2026-11-16'})
  w.unmount()
 }finally{vi.useRealTimers()}
})
it('uses the available year and start boundary when the registration capture is from a prior year',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2027-01-02T01:00:00Z'))
 try{
  const w=mount(LocalDashboardAnalytics,{props:{chartId:'registrations',title:'客户注册统计',availableWindow:{from:'2026-11-01',to:'2026-11-16',asOf:'2026-11-16T10:41:50Z'}}})
  await flushPromises();expect(get.mock.lastCall?.[0]).toMatchObject({from:'2026-11-01',to:'2026-11-16'});w.unmount()
 }finally{vi.useRealTimers()}
})

it('submits comparison with the same filters and cancels comparison on custom dates',async()=>{
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'订单量'}});await flushPromises()
 await w.get('select[aria-label="对比方式"]').setValue('week');await flushPromises()
 expect(get.mock.lastCall?.[0]).toMatchObject({chartId:'order_volume',comparison:'week',departmentId:'d1',entityType:'fulfillment'})
 await w.find('input[type="date"]').setValue('2026-01-02')
 expect(w.get('select[aria-label="对比方式"]').element).toHaveProperty('value','')
 w.unmount()
})

it.each(['registrations','department_receipts','salesperson_receipts','order_volume','customer_orders'] as const)('shows combined weekly dates but requests current period for %s',async chartId=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-17T04:00:00Z'))
 const w=mount(LocalDashboardAnalytics,{props:{chartId,title:'分析'}})
 try{
  await flushPromises();await w.get('select[aria-label="对比方式"]').setValue('week');await flushPromises()
  let dates=w.findAll('input[type="date"]')
  expect((dates[0]!.element as HTMLInputElement).value).toBe('2026-11-09')
  expect((dates[1]!.element as HTMLInputElement).value).toBe('2026-11-17')
  expect(w.find('.comparison-periods').exists()).toBe(false)
  expect(get.mock.lastCall?.[0]).toMatchObject({from:'2026-11-16',to:'2026-11-17',comparison:'week'})
  await w.get('input[aria-label="对比周期日期"]').setValue('2026-11-03');await flushPromises()
  dates=w.findAll('input[type="date"]')
  expect((dates[0]!.element as HTMLInputElement).value).toBe('2026-10-26')
  expect((dates[1]!.element as HTMLInputElement).value).toBe('2026-11-08')
  expect(get.mock.lastCall?.[0]).toMatchObject({from:'2026-11-02',to:'2026-11-08',comparison:'week'})
 }finally{w.unmount();vi.useRealTimers()}
})

it.each(['order_volume','customer_orders','department_receipts','salesperson_receipts','registrations'] as const)('queries %s after each applicable select filter settles',async chartId=>{
 get.mockResolvedValue({...value,warehouses:[{id:'01',name:'Hangzhou'},{id:'HNDGLB',name:'Shenzhen'}],currencies:['USD','CNY'],departments:[{id:'d1',name:'业务一部'},{id:'d2',name:'业务二部'}]})
 const w=mount(LocalDashboardAnalytics,{props:{chartId,title:'分析'}});await flushPromises()
 expect(get).toHaveBeenCalledTimes(1)
 await w.get('[aria-label="业务部门"]').setValue('d2');await flushPromises()
 expect(get).toHaveBeenCalledTimes(chartId==='registrations'?3:2);expect(get.mock.calls.some(([q])=>q.departmentId==='d2')).toBe(true)
 if(chartId!=='registrations'){
  const warehouse=w.get('select[aria-label="仓库"]')
  expect(warehouse.text()).toContain('HangZhou');expect(warehouse.text()).toContain('ShenZhen')
  get.mockResolvedValue({...value,orderCount:7,warehouses:[{id:'01',name:'Hangzhou'},{id:'HNDGLB',name:'Shenzhen'}],currencies:['USD','CNY']})
  await warehouse.setValue('HNDGLB');await flushPromises();expect(get.mock.lastCall?.[0].warehouseCode).toBe('HNDGLB');expect(w.text()).toContain('7 笔')
 }
 if(chartId==='order_volume'||chartId==='customer_orders'){
  await w.get('[aria-label="订单类型"]').setValue('stock');await flushPromises();expect(get.mock.lastCall?.[0].entityType).toBe('stock')
 }
 if(chartId==='salesperson_receipts'){
  expect(w.find('[aria-label="币种"]').exists()).toBe(false);expect(get.mock.lastCall?.[0].currency).toBe('USD')
 }
 w.unmount()
})
it('ignores a stale warehouse response after a newer warehouse has finished',async()=>{
 const options={...value,warehouses:[{id:'01',name:'HangZhou'},{id:'HNDGLB',name:'ShenZhen'}]}
 get.mockResolvedValue(options)
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'分析'}});await flushPromises()
 let old!:(result:typeof options)=>void
 get.mockImplementationOnce(()=>new Promise(resolve=>{old=resolve}))
 await w.get('[aria-label="仓库"]').setValue('01')
 get.mockResolvedValue({...options,orderCount:7})
 await w.get('[aria-label="仓库"]').setValue('HNDGLB');await flushPromises()
 old({...options,orderCount:99});await flushPromises()
 expect(w.text()).toContain('7 笔');expect(w.text()).not.toContain('99 笔');w.unmount()
})

it.each(['registrations','salesperson_receipts','order_volume','customer_orders'] as const)('shows own-member bars and peer-department totals without fabricating peer people for %s',async chartId=>{
 const row=(dimension:string,id:string,label:string,count:number,extra={})=>({...value.rows[0],dimension,id,label,orderCount:count,registrationCount:count,quantity:String(count),currency:'USD',amount:String(count),...extra})
 const summary={...value,rows:[row('department','d1','业务一部',3),row('department','d2','业务二部',10)],orderCount:13,registrationCount:13,amountsByCurrency:[{currency:'USD',amount:'13',orderCount:13}]}
 get.mockResolvedValue({...value,chartId,orderCount:3,registrationCount:3,personalDepartmentId:'d1',defaultDepartmentId:'marketing',departmentSummary:summary,amountsByCurrency:[{currency:'USD',amount:'3',orderCount:3}],rows:[
  ...summary.rows.map(r=>({...r,dimension:chartId==='customer_orders'?'person_department':'department'})),
  row('person','a','甲（Alex）',1,{englishName:'Alex',departmentId:'d1'}),row('person','c','崔（Cici）',2,{englishName:'Cici',departmentId:'d1'}),
  row('month','2026-11','2026-11',3),row('day','2026-11-01','2026-11-01',3),row('customer','c1','Own Customer',3),
 ]})
 const w=mount(LocalDashboardAnalytics,{props:{chartId,title:'统计'}});await flushPromises()
 await w.get('[aria-label="展示维度"]').setValue('person')
 expect(w.findComponent({name:'EChart'}).props('option').xAxis.data).toEqual(['业务一部','Cici','Alex','','业务二部'])
 expect(w.get('.analysis-controls > span').text()).toContain('13 ')
 if(chartId==='salesperson_receipts')expect(w.get('.income-total').text()).toContain('$13.00')
 await w.get('[aria-label="展示维度"]').setValue('month')
 expect(w.get('.analysis-controls > span').text()).toContain('3 ')
 if(chartId==='salesperson_receipts')expect(w.get('.income-total').text()).toContain('$3.00')
 w.unmount()
})
it('renders peer summary bars even when the own department has no personal activity',async()=>{
 get.mockResolvedValue({...value,chartId:'order_volume',orderCount:0,personalDepartmentId:'d1',rows:[{...value.rows[0],dimension:'department',id:'d2',label:'业务二部'}],departmentSummary:{...value,orderCount:42}})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'订单量'}});await flushPromises()
 await w.get('[aria-label="展示维度"]').setValue('person')
 expect(w.findComponent({name:'EChart'}).props('option').xAxis.data).toEqual(['业务二部'])
 expect(w.text()).toContain('42 笔');w.unmount()
})
it('clears a personal warehouse filter before querying another department summary',async()=>{
 get.mockResolvedValue({...value,personalDepartmentId:'d1',defaultDepartmentId:'d1',departments:[{id:'d1',name:'业务一部'},{id:'d2',name:'业务二部'}],warehouses:[{id:'01',name:'HangZhou'}]})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'分析'}});await flushPromises()
 await w.get('[aria-label="仓库"]').setValue('01');await flushPromises()
 await w.get('[aria-label="业务部门"]').setValue('d2');await flushPromises()
 expect(get.mock.lastCall?.[0]).toMatchObject({departmentId:'d2',warehouseCode:undefined});w.unmount()
})

it('isolates filters, pending queries and failures between every mounted local chart',async()=>{
 const ids=['registrations','department_receipts','salesperson_receipts','order_volume','customer_orders'] as const
 const views=ids.map(chartId=>mount(LocalDashboardAnalytics,{props:{chartId,title:chartId}}))
 await flushPromises();get.mockClear()
 const snapshots=views.map(w=>w.html())
 let reject!:(cause:Error)=>void
 get.mockImplementationOnce(()=>new Promise((_resolve,no)=>{reject=no}))
 await views[3]!.get('select[aria-label="订单类型"]').setValue('stock');await flushPromises()
 expect(get).toHaveBeenCalledTimes(1)
 expect(get.mock.calls[0]![0]).toMatchObject({chartId:'order_volume',entityType:'stock'})
 for(const i of [0,1,2,4])expect(views[i]!.html()).toBe(snapshots[i])
 reject(new Error('only this chart'));await flushPromises()
 expect(views[3]!.find('[role=alert]').exists()).toBe(true)
 for(const i of [0,1,2,4])expect(views[i]!.html()).toBe(snapshots[i])
 get.mockResolvedValue(value);get.mockClear()
 await views[0]!.get('select[aria-label="对比方式"]').setValue('week');await flushPromises()
 expect(get).toHaveBeenCalledTimes(1)
 expect(get.mock.calls[0]![0]).toMatchObject({chartId:'registrations',comparison:'week'})
 for(const i of [1,2,4])expect(views[i]!.html()).toBe(snapshots[i])
 views.forEach(w=>w.unmount())
})

async function flushPromises(){await flushVuePromises();if(vi.isFakeTimers())await vi.advanceTimersByTimeAsync(200);else await new Promise(resolve=>setTimeout(resolve,205));await flushVuePromises()}

it('coalesces rapid warehouse choices and ignores the earlier response while final choice is queued',async()=>{
 const sample={...value,warehouses:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}]}
 get.mockResolvedValue(sample)
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'订单分析'}})
 await flushVuePromises()
 let resolveFirst!:(v:any)=>void
 get.mockImplementationOnce(()=>new Promise(resolve=>{resolveFirst=resolve})).mockResolvedValue(sample)
 const select=w.get('[aria-label="仓库"]')
 await select.setValue('a');await flushVuePromises()
 await select.setValue('b');await select.setValue('c')
 expect(get).toHaveBeenCalledTimes(2)
 resolveFirst({...sample,orderCount:999});await flushVuePromises()
 expect(w.text()).not.toContain('999 笔')
 await vi.advanceTimersByTimeAsync(200);await flushVuePromises()
 expect(get).toHaveBeenCalledTimes(3)
 expect(get.mock.lastCall?.[0].warehouseCode).toBe('c')
 w.unmount()
})

it('opens the clicked department or member by stable ID and closes the trend when filters change',async()=>{
 get.mockResolvedValue({...value,rows:[
  {...value.rows[0],dimension:'department',id:'d1',label:'业务一部'},
  {...value.rows[0],dimension:'person',id:'p1',label:'张三',englishName:'Alex',departmentId:'d1'},
  {...value.rows[0],dimension:'department',id:'d2',label:'业务二部'},
  {...value.rows[0],dimension:'person',id:'p2',label:'李四',englishName:'Alex',departmentId:'d2'},
 ]})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'订单量'},global:{stubs:{AnalyticsTrendDialog:{name:'AnalyticsTrendDialog',props:['target','query','targets','metric'],template:'<div data-trend />'}}}});await flushPromises()
 const chart=w.findComponent({name:'EChart'})
 chart.vm.$emit('select',{dataIndex:1});await flushPromises()
 expect(w.findComponent({name:'AnalyticsTrendDialog'}).props('target')).toMatchObject({id:'p1',dimension:'person'})
 chart.vm.$emit('select',{dataIndex:4});await flushPromises()
 expect(w.findComponent({name:'AnalyticsTrendDialog'}).props('target')).toMatchObject({id:'p2',dimension:'person'})
 chart.vm.$emit('select',{dataIndex:3});await flushPromises()
 expect(w.findComponent({name:'AnalyticsTrendDialog'}).props('target')).toMatchObject({id:'d2',dimension:'department'})
 await w.get('select[aria-label="展示维度"]').setValue('month');await flushPromises()
 expect(w.find('[data-trend]').exists()).toBe(false)
 expect(w.find('.trend-open').exists()).toBe(false)
 w.unmount()
})
it('opens the actual clicked comparison period rather than the parent date range',async()=>{
 const person={...value.rows[0],dimension:'person',id:'p1',label:'Alex',englishName:'Alex'}
 const current={from:'2026-11-09',to:'2026-11-15'},previous={from:'2026-11-02',to:'2026-11-08'}
 get.mockResolvedValue({...value,rows:[person],comparison:{available:true,mode:'week',current,previous,metrics:[],previousData:{...value,rows:[person]}}})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'订单量'},global:{stubs:{AnalyticsTrendDialog:{name:'AnalyticsTrendDialog',props:['target','query','targets','metric'],template:'<div data-trend />'}}}});await flushPromises()
 const chart=w.findComponent({name:'EChart'})
 chart.vm.$emit('select',{dataIndex:0,seriesIndex:0});await flushPromises()
 expect(w.findComponent({name:'AnalyticsTrendDialog'}).props('query')).toMatchObject({...previous,comparison:undefined})
 chart.vm.$emit('select',{dataIndex:0,seriesIndex:1});await flushPromises()
 expect(w.findComponent({name:'AnalyticsTrendDialog'}).props('query')).toMatchObject({...current,comparison:undefined})
 w.unmount()
})

it.each([
 ['2027-01-15T02:00:00Z','2027-01-01','2027-01-15','2026-12-01','2026-12-31'],
 ['2028-03-15T02:00:00Z','2028-03-01','2028-03-15','2028-02-01','2028-02-29'],
 ['2026-11-30T17:00:00Z','2026-12-01','2026-12-01','2026-11-01','2026-11-30'],
])('applies receipt month shortcuts in business time at %s without changing another chart',async(now,start,end,previousStart,previousEnd)=>{
 vi.setSystemTime(new Date(now))
 const first=mount(LocalDashboardAnalytics,{props:{chartId:'department_receipts',title:'部门'}})
 const other=mount(LocalDashboardAnalytics,{props:{chartId:'salesperson_receipts',title:'业务员'}})
 await flushPromises()
 const untouched=(other.find('input[type="date"]').element as HTMLInputElement).value
 get.mockClear()
 await first.get('.receipt-month-shortcuts button').trigger('click');await flushPromises()
 expect(get).not.toHaveBeenCalled()
 expect((first.find('input[type="date"]').element as HTMLInputElement).value).toBe(start)
 expect((first.findAll('input[type="date"]')[1]!.element as HTMLInputElement).value).toBe(end)
 expect((first.get('select[aria-label="业务部门"]').element as HTMLSelectElement).value).toBe('d1')
 expect((other.find('input[type="date"]').element as HTMLInputElement).value).toBe(untouched)
 get.mockClear()
 await first.findAll('.receipt-month-shortcuts button')[1]!.trigger('click');await flushPromises()
 expect(get).toHaveBeenCalledTimes(1)
 expect(get.mock.calls[0]![0]).toMatchObject({from:previousStart,to:previousEnd,comparison:undefined})
 await vi.advanceTimersByTimeAsync(400)
 expect(get).toHaveBeenCalledTimes(1)
 first.unmount();other.unmount();vi.useRealTimers()
})
it('offers registration month shortcuts using the registration date basis',async()=>{
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'registrations',title:'注册'}});await flushPromises()
 expect(w.get('.receipt-month-shortcuts').attributes('aria-label')).toBe('注册日期快捷选择');expect(w.get('.receipt-month-shortcuts button').attributes('aria-pressed')).toBe('true');w.unmount()
})

it('avoids re-querying the selected receipt month and lets a newer month supersede a slow request',async()=>{
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'department_receipts',title:'部门'}})
 await flushPromises()
 const buttons=w.findAll('.receipt-month-shortcuts button')
 await buttons[0]!.trigger('click');await flushPromises()
 get.mockClear()
 await buttons[0]!.trigger('click');await flushPromises()
 expect(get).not.toHaveBeenCalled()
 let resolvePrevious!:(v:any)=>void
 get.mockImplementationOnce(()=>new Promise(resolve=>{resolvePrevious=resolve})).mockResolvedValue({...value,orderCount:222})
 await buttons[1]!.trigger('click');await flushVuePromises()
 expect(buttons[0]!.attributes('disabled')).toBeUndefined()
 expect(w.text()).toContain('笔')
 await buttons[0]!.trigger('click');await flushPromises()
 expect(w.text()).toContain('222 笔')
 resolvePrevious({...value,orderCount:999});await flushPromises()
 expect(w.text()).not.toContain('999 笔')
 expect(get).toHaveBeenCalledTimes(2)
 w.unmount()
})

it.each(['registrations','department_receipts','salesperson_receipts','order_volume','customer_orders'] as const)('initially queries this month and selects its shortcut for %s',async chartId=>{
 vi.setSystemTime(new Date('2026-11-25T02:00:00Z'))
 const w=mount(LocalDashboardAnalytics,{props:{chartId,title:'分析'}});await flushPromises()
 expect(get.mock.calls[0]![0]).toMatchObject({from:'2026-11-01',to:'2026-11-25'})
 expect(w.get('.receipt-month-shortcuts button').attributes('aria-pressed')).toBe('true')
 w.unmount()
})

it.each(['registrations','department_receipts','salesperson_receipts','order_volume','customer_orders'] as const)('offers an immediate six-month query while keeping the month default for %s',async chartId=>{
 vi.setSystemTime(new Date('2026-11-25T02:00:00Z'))
 const w=mount(LocalDashboardAnalytics,{props:{chartId,title:'分析',workbench:true}});await flushPromises()
 expect(get.mock.calls[0]![0]).toMatchObject({from:'2026-11-01',to:'2026-11-25'})
 const recent=w.findAll('.receipt-month-shortcuts button').find(b=>b.text()==='近半年')
 expect(recent).toBeDefined()
 expect(recent!.attributes('aria-pressed')).toBe('false')
 const dimension=(w.get('select[aria-label="展示维度"]').element as HTMLSelectElement).value
 get.mockClear()
 await recent!.trigger('click');await flushPromises();await vi.advanceTimersByTimeAsync(400)
 expect(get).toHaveBeenCalledTimes(1)
 expect(get).toHaveBeenLastCalledWith(expect.objectContaining({chartId,from:'2026-06-01',to:'2026-11-25',departmentId:'d1',comparison:undefined}),{force:false},true)
 expect(w.findAll('input[type="date"]').map(i=>(i.element as HTMLInputElement).value)).toEqual(['2026-06-01','2026-11-25'])
 expect(recent!.attributes('aria-pressed')).toBe('true')
 expect((w.get('select[aria-label="展示维度"]').element as HTMLSelectElement).value).toBe(dimension)
 get.mockClear();await recent!.trigger('click');await flushPromises()
 expect(get).not.toHaveBeenCalled()
 await w.findAll('.receipt-month-shortcuts button').find(b=>b.text()==='本月')!.trigger('click');await flushPromises()
 expect(get.mock.lastCall?.[0]).toMatchObject({from:'2026-11-01',to:'2026-11-25'})
 w.unmount()
})

it.each([
 ['2026-12-31T16:30:00Z',undefined,'2026-08-01','2027-01-01'],
 ['2026-01-15T02:00:00Z',undefined,'2026-01-01','2026-01-15'],
 ['2026-02-15T02:00:00Z',undefined,'2026-01-01','2026-02-15'],
 ['2027-01-15T02:00:00Z',{from:'2026-09-10',to:'2026-12-31',asOf:'2027-01-01T00:00:00Z'},'2026-09-10','2026-12-31'],
] as const)('bounds the six-month query by the business start and registration capture at %s',async(now,availableWindow,start,end)=>{
 vi.setSystemTime(new Date(now))
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'registrations',title:'注册',availableWindow}});await flushPromises()
 const recent=w.findAll('.receipt-month-shortcuts button').find(b=>b.text()==='近半年')
 expect(recent).toBeDefined()
 expect(w.findAll('.receipt-month-shortcuts [aria-pressed="true"]').map(b=>b.text())).toEqual(['本月'])
 await recent!.trigger('click');await flushPromises()
 expect(get.mock.lastCall?.[0]).toMatchObject({from:start,to:end})
 expect(w.findAll('.receipt-month-shortcuts [aria-pressed="true"]').map(b=>b.text())).toEqual(['近半年'])
 w.unmount()
})

it('preserves business filters and exits period comparison for the six-month query',async()=>{
 vi.setSystemTime(new Date('2026-11-25T02:00:00Z'))
 get.mockResolvedValue({...value,warehouses:[{id:'HangZhou',name:'杭州仓'}]})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'订单量'}});await flushPromises()
 await w.get('select[aria-label="仓库"]').setValue('HangZhou')
 await w.get('select[aria-label="订单类型"]').setValue('stock')
 await w.get('select[aria-label="对比方式"]').setValue('month');await flushPromises()
 get.mockClear()
 const recent=w.findAll('.receipt-month-shortcuts button').find(b=>b.text()==='近半年')
 expect(recent).toBeDefined()
 await recent!.trigger('click');await flushPromises();await vi.advanceTimersByTimeAsync(400)
 expect(get).toHaveBeenCalledTimes(1)
 expect(get.mock.lastCall?.[0]).toMatchObject({from:'2026-06-01',to:'2026-11-25',departmentId:'d1',warehouseCode:'HangZhou',entityType:'stock',comparison:undefined})
 expect((w.get('select[aria-label="对比方式"]').element as HTMLSelectElement).value).toBe('')
 w.unmount()
})

it('separates the center scale and shares single-department peaks between departments',async()=>{
 const row=(count:number)=>({...value.rows[0],dimension:'day',id:'2026-11-01',label:'2026-11-01',orderCount:count,registrationCount:count})
 const departments=[{id:'center',name:'营销中心'},...['一','二','三','四'].map((name,i)=>({id:`d${i+1}`,name:`业务${name}部`}))]
 get.mockImplementation(async(query:any)=>({...value,chartId:'registrations',defaultDepartmentId:'center',rows:[row(({d1:4,d2:1,d3:2,d4:3} as Record<string,number>)[query.departmentId]??10)],departments}))
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'registrations',title:'注册统计'}})
 await flushPromises()
 const chart=()=>w.findComponent({name:'EChart'}).props('option')
 expect(chart().yAxis).toMatchObject({min:0,max:12,interval:2})
 await w.get('select[aria-label="业务部门"]').setValue('d2')
 await vi.advanceTimersByTimeAsync(1000);await flushPromises()
 const departmentAxis=chart().yAxis
 expect(departmentAxis).toMatchObject({min:0,max:5,interval:1})
 expect(chart().series[0].data).toEqual([1])
 await w.get('select[aria-label="业务部门"]').setValue('d3')
 await vi.advanceTimersByTimeAsync(1000);await flushPromises()
 expect(chart().yAxis).toEqual(departmentAxis)
 expect(chart().series[0].data).toEqual([2])
 await w.get('select[aria-label="业务部门"]').setValue('center')
 await vi.advanceTimersByTimeAsync(1000);await flushPromises()
 expect(chart().yAxis).toMatchObject({max:12,interval:2})
 w.unmount()
})
it('order volume adds customer after person and ranks 20 customers with archive ownership',async()=>{
 get.mockResolvedValue({...value,chartId:'order_volume',rows:Array.from({length:23},(_,i)=>({...value.rows[0],dimension:'customer',id:`c${i}`,label:`客户${i}`,orderCount:i+1,customerOwnerName:'Alex',customerDepartmentName:'业务一部'}))})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'订单量分析'}});await flushPromises()
 const select=w.find('.analysis-controls select')
 expect(select.findAll('option').map(o=>o.attributes('value')).slice(0,2)).toEqual(['person','customer'])
 await select.setValue('customer')
 const chart=w.findComponent({name:'EChart'}).props('option')
 expect(chart.xAxis.data).toHaveLength(20);expect(chart.xAxis.data[0]).toBe('客户22')
 expect(chart.series[0].data).toEqual(Array.from({length:20},(_,i)=>23-i))
 expect(chart.tooltip.formatter([{dataIndex:0}])).toContain('业务部门：业务一部')
 expect(chart.tooltip.formatter([{dataIndex:0}])).toContain('业务员：Alex')
 w.unmount()
})
