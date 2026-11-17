import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import WorkbenchAnalytics from '@/components/charts/WorkbenchAnalytics.vue'
import { getFopDashboardCharts } from '@/api/fop-dashboard'
vi.mock('@/api/fop-dashboard',()=>({getFopDashboardCharts:vi.fn(),localDate:()=> '2026-11-17'}))
vi.mock('@/utils/session',()=>({captureSession:()=>1,assertCurrentSession:vi.fn()}))
vi.mock('@/components/charts/LocalDashboardAnalytics.vue',()=>({default:{props:['chartId','workbench','availableWindow'],template:'<div class="local-chart">{{chartId}}</div>'}}))
vi.mock('@/components/freight/LocalFreightAnalysis.vue',()=>({default:{template:'<div class="freight-chart" />'}}))
beforeEach(()=>vi.mocked(getFopDashboardCharts).mockReset())
describe('workbench analytics local loading',()=>{
 it('loads remaining performance panels independently of dashboard metadata',async()=>{
  for(const page of ['performance','receipts']){
   const wrapper=mount(WorkbenchAnalytics,{props:{page}});await flushPromises()
   expect(wrapper.find('[role=alert]').exists()).toBe(false)
   expect(wrapper.find('.local-chart').exists()).toBe(true)
   wrapper.unmount()
  }
  expect(getFopDashboardCharts).not.toHaveBeenCalled()
 })
 it.each(['order-analysis','order-volume','freight'])('does not mount the retired %s analytics feature',async page=>{
  const wrapper=mount(WorkbenchAnalytics,{props:{page}});await flushPromises()
  expect(wrapper.find('.local-chart').exists()).toBe(false)
  expect(wrapper.find('.freight-chart').exists()).toBe(false)
  expect(getFopDashboardCharts).not.toHaveBeenCalled()
  wrapper.unmount()
 })
 it('supplies the required date query when obtaining the registration coverage window',async()=>{
  vi.mocked(getFopDashboardCharts).mockResolvedValue({registrationWindow:{from:'2026-01-01',to:'2026-11-17',asOf:'2026-11-17'}} as any)
  const wrapper=mount(WorkbenchAnalytics,{props:{page:'overview'}});await flushPromises()
  expect(getFopDashboardCharts).toHaveBeenCalledWith({from:'2026-01-01',to:'2026-11-17',year:2026})
  expect(wrapper.findAll('.local-chart')).toHaveLength(2)
  wrapper.unmount()
 })
})
