import { mount,flushPromises } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { beforeEach,afterEach,it,expect,vi } from 'vitest'
import { invalidateSession } from '@/utils/session'
import LocalDashboardAnalytics from '@/components/charts/LocalDashboardAnalytics.vue'
const mocks=vi.hoisted(()=>({get:vi.fn(),access:undefined as any}))
vi.mock('@/api/local-dashboard-analytics',()=>({getLocalDashboardAnalytics:mocks.get,getLocalDashboardTrend:vi.fn()}))
vi.mock('@/composables/useWorkbenchAccess',()=>({useWorkbenchAccess:()=>({access:mocks.access})}))
vi.mock('@/components/charts/EChart.vue',()=>({default:{name:'EChart',props:['option'],template:'<div data-chart />'}}))
const departments=[{id:'marketing',name:'营销中心'},...['一','二','三','四'].map((n,i)=>({id:`d${i+1}`,name:`业务${n}部`}))]
const data={source:'local',asOf:'2026-11-25T00:00:00Z',summaryOnly:false,rows:[],orderCount:0,departments,defaultDepartmentId:'marketing',warehouses:[{id:'HZ',name:'杭州仓'},{id:'SZ',name:'深圳仓'}],currencies:[]}
beforeEach(()=>{vi.useFakeTimers();mocks.access=shallowRef({businessRole:'salesperson',businessDepartment:{id:'d2',name:'业务二部'},isAdmin:false});mocks.get.mockReset();mocks.get.mockResolvedValue(data)})
afterEach(()=>vi.useRealTimers())
it.each(['salesperson'])('keeps %s department choices within own department even with a stale broad option response',async role=>{
 mocks.access.value={...mocks.access.value,businessRole:role}
 for(const chartId of ['registrations','department_receipts','salesperson_receipts','order_volume','customer_orders'] as const){
  mocks.get.mockClear()
  const w=mount(LocalDashboardAnalytics,{props:{chartId,title:'统计'}});await flushPromises()
  const select=w.get('select[aria-label="业务部门"]')
  expect(select.findAll('option').map(o=>o.text())).toEqual(['业务二部'])
  expect((select.element as HTMLSelectElement).value).toBe('d2')
  if(chartId!=='registrations')expect(w.get('select[aria-label="仓库"]').findAll('option').map(o=>o.attributes('value'))).toEqual(['','HZ','SZ'])
  await w.get('form').trigger('submit');await flushPromises()
  expect(mocks.get.mock.calls.slice(1).every(([query])=>query.departmentId==='d2')).toBe(true)
  w.unmount()
 }
})
it('preserves marketing and four departments for administrators with an employee assignment',async()=>{
 mocks.access.value={...mocks.access.value,isAdmin:true}
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'统计'}});await flushPromises()
 expect(w.get('select[aria-label="业务部门"]').findAll('option').map(o=>o.text())).toEqual(departments.map(d=>d.name))
 w.unmount()
})
it.each([{response:{status:403,data:{code:'forbidden'}}},{code:'chart_scope_changed'}])('clears old department choices and statistics after a scope rejection %j',async failure=>{
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'统计'}});await flushPromises()
 mocks.get.mockRejectedValue(failure)
 await w.get('form').trigger('submit');await flushPromises()
 expect(w.find('[data-chart]').exists()).toBe(false)
 expect(w.get('select[aria-label="业务部门"]').attributes('disabled')).toBeDefined()
 expect(w.get('select[aria-label="业务部门"]').findAll('option').map(o=>o.attributes('value'))).toEqual([''])
 w.unmount()
})

it('keeps manager marketing and granted peer summary choices, hiding ungranted departments',async()=>{
 mocks.access.value={...mocks.access.value,businessRole:'department_manager'}
 for(const chartId of ['registrations','department_receipts','salesperson_receipts','order_volume','customer_orders'] as const){
  const w=mount(LocalDashboardAnalytics,{props:{chartId,title:'统计'}});await flushPromises()
  expect(w.get('select[aria-label="业务部门"]').findAll('option').map(o=>o.text())).toEqual(departments.map(d=>d.name))
  expect((w.get('select[aria-label="业务部门"]').element as HTMLSelectElement).value).toBe('marketing')
  w.unmount()
 }
 mocks.get.mockResolvedValue({...data,departments:departments.slice(0,3)})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'统计'}});await flushPromises()
 expect(w.get('select[aria-label="业务部门"]').findAll('option').map(o=>o.text())).toEqual(['营销中心','业务一部','业务二部'])
 w.unmount()
})
it.each(['registrations','department_receipts','salesperson_receipts','order_volume','customer_orders'] as const)('displays peer %s aggregates without offering personal/customer dimensions',async chartId=>{
 mocks.access.value={...mocks.access.value,businessRole:'department_manager'}
 mocks.get.mockResolvedValue({...data,summaryOnly:true,defaultDepartmentId:'d1',rows:[{dimension:'department',id:'d1',label:'业务一部',currency:'USD',amount:'120',orderCount:3,registrationCount:3}]})
 const w=mount(LocalDashboardAnalytics,{props:{chartId,title:'统计'}});await flushPromises()
 const select=w.get('select[aria-label="展示维度"]')
 const dimensions=select.findAll('option').map(o=>o.attributes('value'))
 expect(dimensions).not.toContain('person');expect(dimensions).not.toContain('customer')
 if(chartId==='registrations')await select.setValue('department')
 else expect((select.element as HTMLSelectElement).value).toBe('department')
 const option=w.findComponent({name:'EChart'}).props('option')
 expect(option.xAxis.data).toEqual(['业务一部'])
 w.unmount()
})

it('submits the salesperson own department on the initial request',async()=>{
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'统计'}});await flushPromises()
 expect(mocks.get.mock.calls[0][0]).toMatchObject({departmentId:'d2',entityType:'fulfillment'})
 const q=mocks.get.mock.calls[0][0];expect(q.from.slice(0,7)).toBe(q.to.slice(0,7));expect(q.from.endsWith('-01')).toBe(true)
 expect((w.get('select[aria-label="仓库"]').element as HTMLInputElement).value).toBe('')
 expect((w.get('select[aria-label="对比方式"]').element as HTMLInputElement).value).toBe('')
 w.unmount()
})
it('aligns the displayed department and subsequent queries with the backend applied initial scope',async()=>{
 mocks.access.value={...mocks.access.value,businessRole:'admin',isAdmin:false,businessDepartment:null}
 mocks.get.mockResolvedValue({...data,departments:departments.slice(1,3),defaultDepartmentId:'d1',selectedDepartmentId:'d2'})
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'统计'}});await flushPromises()
 expect((w.get('select[aria-label="业务部门"]').element as HTMLInputElement).value).toBe('d2')
 await w.get('form').trigger('submit');await flushPromises()
 expect(mocks.get.mock.lastCall?.[0].departmentId).toBe('d2')
 w.unmount()
})
it('resets date, entity, comparison and department filters on account logout without requerying the old session',async()=>{
 const w=mount(LocalDashboardAnalytics,{props:{chartId:'order_volume',title:'统计'}});await flushPromises()
 const initial=mocks.get.mock.calls[0][0]
 await w.get('select[aria-label="订单类型"]').setValue('stock');await flushPromises()
 await w.get('select[aria-label="展示维度"]').setValue('customer')
 await w.get('input[type="date"]').setValue('2026-01-01')
 const count=mocks.get.mock.calls.length
 invalidateSession();await flushPromises();await vi.advanceTimersByTimeAsync(500)
 expect((w.get('select[aria-label="订单类型"]').element as HTMLInputElement).value).toBe('fulfillment')
 expect((w.get('select[aria-label="展示维度"]').element as HTMLInputElement).value).toBe('person')
 expect((w.get('input[type="date"]').element as HTMLInputElement).value).toBe(initial.from)
 expect(w.find('[data-chart]').exists()).toBe(false)
 expect(mocks.get.mock.calls.length).toBe(count)
 w.unmount()
})
