import { buildReplicaOrganization } from './local-workbench-organization'
import { User } from '../users/user.entity'
const nodes = [{id:'root',parent_id:null,name:'Company',kind:'organization'},{id:'dept',parent_id:'root',name:'Sales',kind:'department'},{id:'child',parent_id:'dept',name:'Child',kind:'department'}]
const user={id:'account',role:'user',businessRole:'salesperson',businessDepartmentId:'dept'} as User
const company={tenant_id:'tenant',source_company_id:'100000'}
const members=[{id:'employee',department_id:'dept',name:'Me',account_id:'account',account_disabled:false,binding_id:'binding',binding_enabled:true,binding_state:'directory_verified',employee_master_id:'123',person_record_id:'456',employee_number:'ID-1',directory_verified_at:new Date(),auth_user_id:null}]
describe('local replica directory authorization',()=>{
  it('maps source user IDs only through verified same-tenant directory members and revisions the mapping',()=>{
    const rows=[{...members[0],fop_user_id:'999',fop_tenant_id:'tenant'}]
    const result=buildReplicaOrganization(user,'workspace',nodes,rows,company)
    expect(result.members[0]).toMatchObject({employeeId:'123',fopUserId:'999'})
    const changed=buildReplicaOrganization(user,'workspace',nodes,[{...rows[0],fop_user_id:'998'}],company)
    expect(changed.version).not.toBe(result.version)
    expect(buildReplicaOrganization(user,'workspace',nodes,[{...rows[0],fop_tenant_id:'other'}],company).members[0]).not.toHaveProperty('fopUserId')
  })
  it('quarantines duplicate source user mappings before self permissions hide the other member',()=>{
    const rows=[{...members[0],fop_user_id:'999',fop_tenant_id:'tenant'},{...members[0],id:'other',account_id:'other',employee_master_id:'124',fop_user_id:'999',fop_tenant_id:'tenant'}]
    expect(buildReplicaOrganization(user,'workspace',nodes,rows,company).members[0]).not.toHaveProperty('fopUserId')
  })
  it('projects the local bilingual name and changes the scope revision when that display changes',()=>{
    const local=[{...members[0],name:'叶力铭',english_name:'Jennie'}]
    const result=buildReplicaOrganization(user,'workspace',nodes,local,company)
    expect(result.members[0].name).toBe('叶力铭（Jennie）')
    expect(result.members[0]).toMatchObject({englishName:'Jennie'})
    expect(buildReplicaOrganization(user,'workspace',nodes,[{...local[0],english_name:'Jenny'}],company).version).not.toBe(result.version)
  })
  it('accepts a verified business employee directory mapping without a personal authentication proxy',()=>{
    const result=buildReplicaOrganization(user,'workspace',nodes,members,company)
    expect(result.employeeIds).toEqual(['123'])
    expect(result.employeeId).toBe('123')
  })
  it('rejects ID-only pending mappings instead of using a person record as a master ID',()=>{
    expect(()=>buildReplicaOrganization(user,'workspace',nodes,[{...members[0],binding_state:'pending',employee_master_id:null}],company)).toThrow('Verified local employee')
  })
  it('uses current descendant members for department preference and keeps self preference narrow',()=>{
    const employees=[...members,{...members[0],id:'colleague',department_id:'child',account_id:'colleague',binding_id:'other',employee_master_id:'789'}]
    const manager={...user,businessRole:'department_manager',dataDisplayScope:'department'} as User
    expect(buildReplicaOrganization(manager,'workspace',nodes,employees,company).employeeIds).toEqual(['123','789'])
    expect(buildReplicaOrganization({...manager,dataDisplayScope:'self'},'workspace',nodes,employees,company).employeeIds).toEqual(['123'])
  })
})

it('exposes a separate verified marketing directory only for manager analytics, leaving workbench records narrow',()=>{
 const marketing=[{id:'root',parent_id:null,name:'Company',kind:'organization'},
  {id:'marketing',parent_id:'root',name:'营销中心',kind:'department'},
  {id:'dept',parent_id:'marketing',name:'业务一部',kind:'department'},
  {id:'peer',parent_id:'marketing',name:'业务二部',kind:'department'},
  {id:'other',parent_id:'root',name:'业务三部',kind:'department'}]
 const employees=[...members,{...members[0],id:'colleague',account_id:'colleague',employee_master_id:'124'},
  {...members[0],id:'peer',department_id:'peer',account_id:'peer',employee_master_id:'125'},
  {...members[0],id:'other',department_id:'other',account_id:'other',employee_master_id:'126'}]
 const manager={...user,businessRole:'department_manager',dataDisplayScope:'self'} as User
 const ordinary=buildReplicaOrganization(manager,'workspace',marketing,employees,company)
 expect(ordinary.employeeIds).toEqual(['123'])
 expect(ordinary).not.toHaveProperty('analyticsPeers')
 const chart=buildReplicaOrganization(manager,'workspace',marketing,employees,company,{managerAnalytics:true})
 expect(chart.employeeIds).toEqual(['123','124'])
 expect(chart.analyticsPeers?.members.map(m=>m.employeeId)).toEqual(['123','124','125'])
 expect(chart.analyticsPeers?.departments.map(d=>d.id)).toEqual(['marketing','dept','peer'])
 expect(buildReplicaOrganization(user,'workspace',marketing,employees,company,{managerAnalytics:true})).not.toHaveProperty('analyticsPeers')
})
