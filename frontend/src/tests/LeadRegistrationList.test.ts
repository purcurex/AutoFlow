import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import LeadRegistrationList from '@/components/leads/LeadRegistrationList.vue'
import { crmMockAutoflowApi as autoflowApi } from '@/mocks/crm'
vi.mock('@/mocks/crm',()=>({isCrmMockId:()=>true,crmMockOpportunitiesApi:{fromLead:vi.fn()},crmMockAutoflowApi:{listRegisteredLeads:vi.fn(),registerLead:vi.fn(),leadImportTemplate:vi.fn(),importLeads:vi.fn()}}))
async function setup(){const router=createRouter({history:createMemoryHistory(),routes:[{path:'/leads',component:{template:'<div />'}}]});await router.push('/leads');const wrapper=mount(LeadRegistrationList,{global:{plugins:[router,createI18n({legacy:false,locale:'zh-CN',messages:{}})]}});await flushPromises();return wrapper}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(autoflowApi.listRegisteredLeads).mockResolvedValue({items:[],total:0,page:1,pageSize:100})})
describe('lead registration list',()=>{
 it('queries type server-side with page reset',async()=>{const w=await setup();await w.get('select[aria-label="线索类型"]').setValue('manual');await flushPromises();expect(autoflowApi.listRegisteredLeads).toHaveBeenLastCalledWith(expect.objectContaining({leadType:'manual',page:1,pageSize:100}));w.unmount()})
 it('submits manual fields without an editable source or owner',async()=>{vi.mocked(autoflowApi.registerLead).mockResolvedValue({id:'1'} as any);const w=await setup();await w.findAll('button').find(b=>b.text().includes('新增线索'))!.trigger('click');const fields=w.findAll('.lead-form-grid input');await fields[0]!.setValue('Demo');expect(fields[1]!.attributes('disabled')).toBeDefined();w.findComponent({name:'CountryPicker'}).vm.$emit('update:modelValue','US');await flushPromises();await w.get('input[placeholder="https://"]').setValue('https://example.com');await w.get('.lead-modal form').trigger('submit');await flushPromises();expect(autoflowApi.registerLead).toHaveBeenCalledWith(expect.objectContaining({brandName:'Demo',country:'US',storeUrl:'https://example.com'}));expect(vi.mocked(autoflowApi.registerLead).mock.calls[0]![0]).not.toHaveProperty('leadType');expect(w.find('[role="dialog"]').exists()).toBe(false);expect(w.text()).toContain('线索已登记');w.unmount()})
})

it('toggles date ordering, resets pagination and preserves order with filters',async()=>{
 vi.mocked(autoflowApi.listRegisteredLeads).mockResolvedValue({items:[],total:201,page:1,pageSize:100})
 const w=await setup()
 await w.findAll('button').find(b=>b.text()==='下一页')!.trigger('click');await flushPromises()
 expect(autoflowApi.listRegisteredLeads).toHaveBeenLastCalledWith(expect.objectContaining({page:2}))
 await w.get('button[aria-label="联系日期：按时间升序排列"]').trigger('click');await flushPromises()
 expect(autoflowApi.listRegisteredLeads).toHaveBeenLastCalledWith(expect.objectContaining({page:1,sortBy:'contactedOn',sortDirection:'asc'}))
 expect(w.get('th[aria-sort="ascending"]').text()).toBe('联系日期')
 await w.get('button[aria-label="联系日期：按时间降序排列"]').trigger('click');await flushPromises()
 await w.get('select[aria-label="线索类型"]').setValue('manual');await flushPromises()
 expect(autoflowApi.listRegisteredLeads).toHaveBeenLastCalledWith(expect.objectContaining({leadType:'manual',sortBy:'contactedOn',sortDirection:'desc'}))
 w.unmount()
})
