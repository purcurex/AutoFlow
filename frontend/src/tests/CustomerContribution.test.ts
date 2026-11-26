import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import LocalDashboardAnalytics from '@/components/charts/LocalDashboardAnalytics.vue'
import { invalidateSession } from '@/utils/session'
const api = vi.hoisted(() => ({ main: vi.fn(), contribution: vi.fn(), trend: vi.fn() }))
const refreshes=vi.hoisted(()=>[] as Array<()=>Promise<unknown>>)
vi.mock('@/composables/useAnalyticsRefresh',()=>({useAnalyticsRefresh:(refresh:()=>Promise<unknown>)=>{refreshes.push(refresh);return {updated:vi.fn()}}}))
vi.mock('@/api/local-dashboard-analytics', () => ({ getLocalDashboardAnalytics: api.main, getCustomerContribution: api.contribution, getLocalDashboardTrend: api.trend }))
vi.mock('@/components/charts/EChart.vue', () => ({ default: { name: 'EChart', props: ['option'], template: '<div />' } }))
const row = (dimension:string,id:string,label:string,amount:string,departmentId?:string) => ({ dimension,id,label,amount,currency:'USD',orderCount:3,quantity:'3',departmentId,englishName:label })
const main = () => ({ source:'local',chartId:'customer_orders',asOf:'2026-11-25',summaryOnly:false,orderCount:9,missingCurrencyCount:0,missingAmountCount:0,missingPaidAtCount:0,currencies:['USD'],warehouses:[],departments:[{id:'marketing',name:'营销中心'}],defaultDepartmentId:'marketing',amountsByCurrency:[{currency:'USD',amount:'1500.50'}],rows:[row('person_department','d1','业务一部','1000.50'),row('person','p1','Alex','1000.50','d1'),row('person_department','d2','业务二部','500.00')],customerContributionTargets:[{dimension:'department',id:'d1'},{dimension:'person',id:'p1'}] })
const detail = () => ({source:'local',dimension:'department',id:'d1',limit:10,from:'2026-11-01',to:'2026-11-25',asOf:'2026-11-25',currency:'USD',amount:'1000.50',orderCount:3,customerCount:2,missingAmountCount:0,rows:[{...row('customer','c1','Maple','800.50'),orderCount:1},{...row('customer','c2','Maple','200.00'),orderCount:2}]})
let w:ReturnType<typeof mount>|undefined
beforeEach(() => { api.main.mockResolvedValue(main());api.contribution.mockResolvedValue(detail());HTMLDialogElement.prototype.showModal=vi.fn(function(this:HTMLDialogElement){this.setAttribute('open','')});HTMLDialogElement.prototype.close=vi.fn() })
afterEach(() => {w?.unmount();w=undefined;document.body.innerHTML='';refreshes.length=0;vi.clearAllMocks()})
async function open(index=0){ w=mount(LocalDashboardAnalytics,{props:{chartId:'customer_orders',title:'客户订单分析'},attachTo:document.body});await flushPromises();await w.get('[aria-label="展示维度"]').setValue('person');w.findComponent({name:'EChart'}).vm.$emit('select',{dataIndex:index,seriesIndex:0});await flushPromises();return w }
it('opens department customer bars with dollar amounts, contribution share and supporting counts',async()=>{
 const view=await open()
 expect(document.querySelector('dialog h2')?.textContent).toBe('业务一部 · 客户业绩贡献')
 expect(document.querySelector('dialog')?.textContent).toContain('前 10 名')
 const chart=view.findComponent({name:'CustomerContributionDialog'}).findComponent({name:'EChart'}).props('option')
 expect(chart.xAxis.data).toEqual(['Maple','Maple'])
 expect(chart.series[0].data.map((v:any)=>typeof v==='number'?v:v.value)).toEqual([800.5,200])
 expect(chart.yAxis.axisLabel.formatter(800.5)).toBe('$800.50')
 expect(chart.tooltip.formatter([{dataIndex:0}])).toContain('80.01%')
 expect(chart.tooltip.formatter([{dataIndex:0}])).toContain('1 笔')
 expect(api.contribution.mock.lastCall![0]).toMatchObject({dimension:'department',id:'d1',chartId:'customer_orders',currency:'USD',entityType:'fulfillment'})
 expect(api.trend).not.toHaveBeenCalled()
})
it('opens the selected salesperson and does not drill into peer summary-only departments',async()=>{
 await open(1)
 expect(document.querySelector('dialog h2')?.textContent).toBe('Alex · 客户业绩贡献')
 expect(api.contribution.mock.lastCall![0]).toMatchObject({dimension:'person',id:'p1'})
 document.querySelector<HTMLButtonElement>('[aria-label="关闭客户贡献"]')!.click();await flushPromises()
 w!.findComponent({name:'EChart'}).vm.$emit('select',{dataIndex:3,seriesIndex:0});await flushPromises()
 expect(document.querySelector('dialog')).toBeNull()
 expect(api.contribution).toHaveBeenCalledTimes(1)
})
it('uses the clicked comparison period for customer contribution',async()=>{
 const d:any=main();d.comparison={mode:'week',available:true,current:{from:'2026-11-16',to:'2026-11-22'},previous:{from:'2026-11-09',to:'2026-11-15'},previousData:main(),metrics:[]};api.main.mockResolvedValue(d)
 await open()
 expect(api.contribution.mock.lastCall![0]).toMatchObject({from:'2026-11-09',to:'2026-11-15'})
 expect(api.contribution.mock.lastCall![0]).not.toHaveProperty('comparison')
})
it('clears a customer breakdown on session reset',async()=>{
 await open();invalidateSession();await flushPromises()
 expect(document.querySelector('dialog')).toBeNull()
})

it('clears previous customers during target changes and ignores delayed responses',async()=>{
 await open()
 let finish!:(value:unknown)=>void
 api.contribution.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 const select=document.querySelector<HTMLSelectElement>('[aria-label="客户贡献分析对象"]')!
 select.value='1';select.dispatchEvent(new Event('change'));await flushPromises()
 expect(document.querySelector('dialog')?.textContent).not.toContain('$1,000.50')
 expect(document.querySelector('dialog')?.textContent).toContain('正在查询客户贡献')
 w!.unmount();w=undefined
 finish(detail());await flushPromises()
 expect(document.querySelector('dialog')).toBeNull()
})
it('keeps the chart instance while switching targets without displaying previous customer data',async()=>{
 await open()
 const modal=w!.findComponent({name:'CustomerContributionDialog'}),chart=modal.findComponent({name:'EChart'}).vm
 let finish!:(value:unknown)=>void
 api.contribution.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 const select=document.querySelector<HTMLSelectElement>('[aria-label="客户贡献分析对象"]')!
 select.value='1';select.dispatchEvent(new Event('change'));await flushPromises()
 expect(modal.findComponent({name:'EChart'}).vm).toBe(chart)
 expect(modal.findComponent({name:'EChart'}).props('option').xAxis.data).toEqual([])
 finish({...detail(),dimension:'person',id:'p1',limit:5});await flushPromises()
 expect(modal.findComponent({name:'EChart'}).vm).toBe(chart)
 expect(modal.findComponent({name:'EChart'}).props('option').xAxis.data).toEqual(['Maple','Maple'])
})
it('keeps an open contribution during background main-chart refresh and revalidates its own data',async()=>{
 await open()
 const modal=document.querySelector('dialog')
 await refreshes[0]!();await flushPromises()
 expect(document.querySelector('dialog')).toBe(modal)
 expect(refreshes).toHaveLength(2)
 let finish!:(value:unknown)=>void
 api.contribution.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 const pending=refreshes[1]!();await flushPromises()
 expect(document.querySelector('dialog')?.textContent).toContain('$1,000.50')
 finish({...detail(),amount:'1200.00'});await pending;await flushPromises()
 expect(document.querySelector('dialog')?.textContent).toContain('$1,200.00')
 api.contribution.mockRejectedValueOnce({statusCode:403});await refreshes[1]!();await flushPromises()
 expect(document.querySelector('dialog')?.textContent).not.toContain('$1,200.00')
 expect(document.querySelector('[role=alert]')).not.toBeNull()
})
it('closes the open detail when the main refresh removes its detail grant',async()=>{
 await open();api.main.mockResolvedValue({...main(),customerContributionTargets:[]})
 await refreshes[0]!();await flushPromises()
 expect(document.querySelector('dialog')).toBeNull()
})
it('shows a recoverable error without stale customer names, and uses the five-customer limit for a person',async()=>{
 api.contribution.mockRejectedValueOnce({statusCode:403})
 await open(1)
 expect(document.querySelector('[role=alert]')?.textContent).toContain('检查数据权限')
 expect(document.querySelector('dialog')?.textContent).not.toContain('Maple')
 const retry=[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='重试') as HTMLButtonElement
 api.contribution.mockResolvedValueOnce({...detail(),dimension:'person',id:'p1',limit:5})
 retry.click();await flushPromises()
 expect(document.querySelector('dialog')?.textContent).toContain('前 5 名')
 expect(document.querySelector('[role=alert]')).toBeNull()
})

it.each([
 {amount:'200.00',values:['40.00','30.00','15.00','10.00','5.00'],topThree:'42.50%',ranked:'50.00%'},
 {amount:'100.00',values:['60.00','40.00'],topThree:'100.00%',ranked:'100.00%'},
 {amount:'0',values:[],topThree:'—',ranked:'—'},
 {amount:null,values:['40.00','30.00','15.00','10.00'],topThree:'—',ranked:'—'},
])('shows first-three share before ranked share using the full-scope denominator: $amount',async({amount,values,topThree,ranked})=>{
 api.contribution.mockResolvedValue({...detail(),amount,rows:values.map((value,i)=>row('customer',String(i),`Customer ${i}`,value))})
 await open()
 const totals=[...document.querySelectorAll('dialog .totals>div')]
 expect(totals.map(item=>item.querySelector('span')?.textContent)).toEqual(['订单金额合计','前三客户贡献','上榜客户贡献'])
 expect(totals[1]?.querySelector('strong')?.textContent).toBe(topThree)
 expect(totals[2]?.querySelector('strong')?.textContent).toBe(ranked)
})
