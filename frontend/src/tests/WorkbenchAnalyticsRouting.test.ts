import {mount,flushPromises,enableAutoUnmount} from '@vue/test-utils'
import {createRouter,createMemoryHistory} from 'vue-router'
import {createI18n} from 'vue-i18n'
import {ref} from 'vue'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import WorkbenchView from '@/views/autoflow/WorkbenchView.vue'
const state=vi.hoisted(()=>({admin:true}))
vi.mock('@/composables/useWorkbenchAccess',()=>({useWorkbenchAccess:()=>({roles:ref(['sales']),isAdmin:ref(state.admin),access:ref({isAdmin:state.admin})})}))
vi.mock('@/components/layout',()=>({AppLayout:{template:'<div><slot /></div>'}}))
vi.mock('@/components/autoflow/WorkbenchReplicaControls.vue',()=>({default:{template:'<div />'}}))
vi.mock('@/components/charts/WorkbenchAnalytics.vue',()=>({default:{props:['page'],template:'<div data-testid="local-analysis">{{page}}</div>'}}))
vi.mock('@/views/autoflow/FopOrdersView.vue',()=>({default:{template:'<div data-testid="orders" />'}}))
enableAutoUnmount(afterEach)
beforeEach(()=>vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}}))
afterEach(()=>{state.admin=true;vi.unstubAllGlobals()})
async function setup(path:string){
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/workbench/:role',name:'RoleWorkbench',component:WorkbenchView},{path:'/workbench/:role/receipts',name:'RoleWorkbenchReceipts',component:WorkbenchView},{path:'/dashboard',component:{template:'<div />'}}]})
 await router.push(path)
 const wrapper=mount(WorkbenchView,{global:{plugins:[router,createI18n({legacy:false,locale:'zh-CN',messages:{}})]}});await flushPromises();return wrapper
}
it.each(['performance'])('routes the current %s page to local analytics instead of legacy source details',async page=>{
 const wrapper=await setup('/workbench/sales?queue='+page)
 expect(wrapper.get('[data-testid=local-analysis]').text()).toBe(page)
 expect(wrapper.find('[data-testid=orders]').exists()).toBe(false)
})
it('uses local analytics for the retained receipts URL',async()=>{
 const wrapper=await setup('/workbench/sales/receipts')
 expect(wrapper.get('[data-testid=local-analysis]').text()).toBe('receipts')
})
it('keeps management-only analytics hidden for ordinary accounts',async()=>{
 state.admin=false;const wrapper=await setup('/workbench/sales?queue=performance')
 expect(wrapper.find('[data-testid=local-analysis]').exists()).toBe(false)
 expect(wrapper.get('[role=alert]').text()).toContain('暂无此功能权限')
})
