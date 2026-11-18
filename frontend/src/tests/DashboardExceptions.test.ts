import { clearDashboardExceptionCache } from '@/utils/dashboard-exception-cache'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory } from 'vue-router'
import { beforeEach, expect, it, vi } from 'vitest'
import DashboardExceptions from '@/components/charts/DashboardExceptions.vue'
import { getFopOrders } from '@/api/fop-orders'
vi.mock('@/api/fop-orders',()=>({getFopOrders:vi.fn()}))
async function setup(){const router=createRouter({history:createMemoryHistory(),routes:[{path:'/workbench/:role',name:'RoleWorkbench',component:{template:'<div />'}},{path:'/:pathMatch(.*)*',component:{template:'<div />'}}]});await router.push('/dashboard');return mount(DashboardExceptions,{global:{plugins:[router,createI18n({legacy:false,locale:'zh-CN',messages:{}})]}})}
beforeEach(()=>{clearDashboardExceptionCache();vi.resetAllMocks()})
it('uses the authorized exception list, its total and order-specific navigation',async()=>{
 vi.mocked(getFopOrders).mockResolvedValue({total:42,items:[{id:'source-id',orderNumber:'TO123',exception:{type:'procurement_exception',reason:'质量问题，已申请退货'}}]} as never)
 const wrapper=await setup();await flushPromises()
 expect(getFopOrders).toHaveBeenCalledWith({queue:'exceptions',page:1,pageSize:5,sortBy:'paidAt',sortOrder:'desc'},expect.any(AbortSignal))
 expect(wrapper.text()).toContain('42');expect(wrapper.text()).toContain('TO123');expect(wrapper.text()).toContain('采购异常');expect(wrapper.text()).toContain('质量问题，已申请退货')
 expect(wrapper.find('.exception-item').attributes('href')).toContain('orderNumber=TO123')
 expect(wrapper.text()).not.toContain('source-id');wrapper.unmount()
})
it('leaves unknown exception facts blank rather than exposing technical diagnostics',async()=>{
 vi.mocked(getFopOrders).mockResolvedValue({total:1,items:[{id:'x',orderNumber:'TO1',exception:null,dataQuality:{reasons:['missing_api_field']}}]} as never)
 const wrapper=await setup();await flushPromises();expect(wrapper.find('.type').exists()).toBe(false);expect(wrapper.find('.reason').exists()).toBe(false);expect(wrapper.text()).not.toContain('missing_api');wrapper.unmount()
})
it.each([['outbound_exception','出库异常','部分出库无法核实'],['allocation_exception','配货异常','配货单报错']])('shows classified %s with its actionable reason',async(type,label,reason)=>{
 vi.mocked(getFopOrders).mockResolvedValue({total:1,items:[{id:'x',orderNumber:'TO1',exception:{type,reason}}]} as never)
 const wrapper=await setup();await flushPromises()
 expect(wrapper.get('.type').text()).toBe(label);expect(wrapper.get('.reason').text()).toBe(reason)
 wrapper.unmount()
})
it('does not report an empty list when loading fails',async()=>{
 vi.mocked(getFopOrders).mockRejectedValue(new Error('denied'))
 const wrapper=await setup();await flushPromises();expect(wrapper.text()).toContain('暂时无法加载');expect(wrapper.text()).not.toContain('暂无异常订单');wrapper.unmount()
})
