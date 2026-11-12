import { buildReplicaOrganization } from './local-workbench-organization'
import { User } from '../users/user.entity'
const nodes = [{id:'root',parent_id:null,name:'Company',kind:'organization'},{id:'dept',parent_id:'root',name:'Sales',kind:'department'},{id:'child',parent_id:'dept',name:'Child',kind:'department'}]
const user={id:'account',role:'user',businessRole:'salesperson',businessDepartmentId:'dept'} as User
const company={tenant_id:'tenant',source_company_id:'100000'}
const members=[{id:'employee',department_id:'dept',name:'Me',account_id:'account',account_disabled:false,binding_id:'binding',binding_enabled:true,binding_state:'directory_verified',employee_master_id:'123',person_record_id:'456',employee_number:'ID-1',directory_verified_at:new Date(),auth_user_id:null}]
describe('local replica directory authorization',()=>{
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
