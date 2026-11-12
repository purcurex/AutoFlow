import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EmployeeLoginDialog from '@/components/admin/EmployeeLoginDialog.vue'
import { getEmployeeLogin, updateEmployeeLogin } from '@/api/organization'
import { bindFopEmployee, unbindFopEmployee, getFopBindingEmployees, type FopBindingEmployeePage } from '@/api/fop-access'
import { invalidateSession } from '@/utils/session'
vi.mock('@/api/organization', () => ({ getEmployeeLogin: vi.fn(), updateEmployeeLogin: vi.fn() }))
vi.mock('@/api/fop-access', async importOriginal => ({ ...await importOriginal<typeof import('@/api/fop-access')>(), bindFopEmployee:vi.fn(),unbindFopEmployee:vi.fn(),getFopBindingEmployees:vi.fn() }))
const page: FopBindingEmployeePage = { scopeVersion:'a'.repeat(64),nextCursor:null,items:[
  {id:'11',masterId:'111',membershipId:'201',departmentId:'301',employeeNumber:'ID-000007',name:'测试职员甲',username:'offline-a',state:'active'},
  {id:'22',masterId:'222',membershipId:'202',departmentId:'302',employeeNumber:'ID-000008',name:'测试职员乙',username:'offline-b',state:'disabled'},
] }
const account = { id:'local-a',username:'Local A',email:'a@example.test',fopBinding:null }
const saved = { ...account,fopBinding:{tenantId:'offline',userId:'11'},fopBindingDetails:{employeeNumber:'ID-000007',name:'测试职员甲',username:'offline-a',employeeRecordId:'11',employeeMasterId:'111',departmentId:'301',organizationId:'100',verifiedAt:'2026-10-29T00:00:00Z'} }
async function setup() {
  vi.mocked(getEmployeeLogin).mockResolvedValue(account)
  vi.mocked(getFopBindingEmployees).mockResolvedValue(page)
  const wrapper=mount(EmployeeLoginDialog,{props:{accountId:account.id},global:{plugins:[createI18n({legacy:false,locale:'zh-CN',messages:{}})],stubs:{OrganizationModal:{template:'<div><slot/><slot name="footer"/></div>'}}}})
  await flushPromises();return wrapper
}
function button(wrapper: ReturnType<typeof mount>, text:string) {return wrapper.findAll('button').find(item=>item.text()===text)!}

describe('管理员验证并绑定每个账号对应的金蝶员工',()=>{
  beforeEach(()=>vi.resetAllMocks())
  it('真实Teleport在读取目录的忙碌状态切换后保留选择器和响应',async()=>{
    vi.mocked(getEmployeeLogin).mockResolvedValue(account);vi.mocked(getFopBindingEmployees).mockResolvedValue(page)
    const wrapper=mount(EmployeeLoginDialog,{attachTo:document.body,props:{accountId:account.id},global:{plugins:[createI18n({legacy:false,locale:'zh-CN',messages:{}})]}})
    await flushPromises()
    const load=Array.from(document.querySelectorAll('button')).find(item=>item.textContent==='读取金蝶员工')!
    load.click();await flushPromises()
    expect(getFopBindingEmployees).toHaveBeenCalledTimes(1)
    expect(document.querySelector('option[value="11:201"]')).not.toBeNull()
    wrapper.unmount()
  })
  it('只能选择可用任职行，提交工号与人员任职ID供服务端复验，登录资料及权限不随绑定请求提交',async()=>{
    const wrapper=await setup();vi.mocked(bindFopEmployee).mockResolvedValue(saved)
    expect(button(wrapper,'验证并绑定金蝶员工').attributes('disabled')).toBeDefined()
    await button(wrapper,'读取金蝶员工').trigger('click');await flushPromises()
    expect(wrapper.get('option[value="22:202"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="对应金蝶员工"]').setValue('11:201')
    await button(wrapper,'验证并绑定金蝶员工').trigger('click');await flushPromises()
    expect(bindFopEmployee).toHaveBeenCalledExactlyOnceWith('local-a','11','201','ID-000007')
    expect(updateEmployeeLogin).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('测试职员甲');expect(wrapper.get('[role=status]').text()).toContain('重新登录')
    wrapper.unmount()
  })
  it('代理用户失败显示独立原因，保留可重试选择且不显示绑定成功',async()=>{
    const wrapper=await setup();vi.mocked(bindFopEmployee).mockRejectedValue({code:'fop_proxy_user_required'})
    await button(wrapper,'读取金蝶员工').trigger('click');await flushPromises()
    await wrapper.get('[aria-label="对应金蝶员工"]').setValue('11:201')
    await button(wrapper,'验证并绑定金蝶员工').trigger('click');await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('代理用户名单');expect(wrapper.find('[role=status]').exists()).toBe(false)
    expect(button(wrapper,'验证并绑定金蝶员工').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
  it('重复绑定返回冲突原因，不覆盖旧绑定信息',async()=>{
    const wrapper=await setup();vi.mocked(bindFopEmployee).mockRejectedValue({statusCode:409,message:'该金蝶身份已绑定其他账号'})
    await button(wrapper,'读取金蝶员工').trigger('click');await flushPromises()
    await wrapper.get('[aria-label="对应金蝶员工"]').setValue('11:201')
    await button(wrapper,'验证并绑定金蝶员工').trigger('click');await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('已绑定其他账号');expect(wrapper.text()).toContain('尚未绑定金蝶员工')
    wrapper.unmount()
  })
  it('员工目录继续分页时携带原范围版本，并保留已加载的任职行',async()=>{
    const wrapper=await setup();vi.mocked(getFopBindingEmployees).mockResolvedValueOnce({...page,nextCursor:'11:201'})
    await button(wrapper,'读取金蝶员工').trigger('click');await flushPromises()
    vi.mocked(getFopBindingEmployees).mockResolvedValueOnce({...page,items:[{...page.items[0]!,id:'33',membershipId:'203',name:'测试职员丙'}]})
    await button(wrapper,'加载更多员工').trigger('click');await flushPromises()
    expect(getFopBindingEmployees).toHaveBeenLastCalledWith({cursor:'11:201',scopeVersion:'a'.repeat(64)})
    expect(wrapper.find('option[value="11:201"]').exists()).toBe(true);expect(wrapper.find('option[value="33:203"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('切换登录账号后丢弃未返回的旧目录和人员信息',async()=>{
    const wrapper=await setup();let finish!:(value:FopBindingEmployeePage)=>void
    vi.mocked(getFopBindingEmployees).mockReturnValueOnce(new Promise(resolve=>{finish=resolve}))
    await button(wrapper,'读取金蝶员工').trigger('click');invalidateSession();finish(page);await flushPromises()
    expect(wrapper.emitted('close')).toBeTruthy();expect(wrapper.find('[aria-label="对应金蝶员工"]').exists()).toBe(false)
    expect(bindFopEmployee).not.toHaveBeenCalled();wrapper.unmount()
  })
  it('解绑使用专用接口，保留本地登录资料且要求目标重新登录',async()=>{
    vi.mocked(getEmployeeLogin).mockResolvedValue(saved)
    const linked=mount(EmployeeLoginDialog,{props:{accountId:account.id},global:{plugins:[createI18n({legacy:false,locale:'zh-CN',messages:{}})],stubs:{OrganizationModal:{template:'<div><slot/><slot name="footer"/></div>'}}}});await flushPromises()
    vi.mocked(unbindFopEmployee).mockResolvedValue(account)
    await button(linked,'解除金蝶绑定').trigger('click');await flushPromises()
    expect(unbindFopEmployee).toHaveBeenCalledExactlyOnceWith('local-a');expect(updateEmployeeLogin).not.toHaveBeenCalled()
    expect(linked.text()).toContain('尚未绑定金蝶员工');linked.unmount()
  })
  it('按工号查找人员，缺少工号的记录不可绑定', async () => {
    const wrapper=await setup()
    vi.mocked(getFopBindingEmployees).mockResolvedValueOnce({...page,items:[...page.items,{...page.items[0]!,id:'33',membershipId:'203',employeeNumber:null}]})
    await button(wrapper,'读取金蝶员工').trigger('click');await flushPromises()
    expect(wrapper.get('option[value="33:203"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="筛选已加载员工"]').setValue('ID-000007')
    expect(wrapper.get('option[value="11:201"]').text()).toContain('ID-000007')
    expect(wrapper.find('option[value="22:202"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('相同工号的多任职仍显示可区分的部门与任职信息', async () => {
    const wrapper=await setup()
    vi.mocked(getFopBindingEmployees).mockResolvedValueOnce({...page,items:[page.items[0]!,{...page.items[0]!,membershipId:'203',departmentId:'303'}]})
    await button(wrapper,'读取金蝶员工').trigger('click');await flushPromises()
    const a=wrapper.get('option[value="11:201"]').text(),b=wrapper.get('option[value="11:203"]').text()
    expect(a).not.toBe(b);expect(a).toContain('301');expect(b).toContain('303')
    wrapper.unmount()
  })

})
