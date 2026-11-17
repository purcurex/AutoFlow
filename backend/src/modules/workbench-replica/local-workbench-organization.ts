import { ForbiddenException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { User } from '../users/user.entity'
import { businessScope, effectiveBusinessScope } from '../users/business-scope'
import { LocalWorkbenchOrganization } from '../users/local-workbench-organization'
import { LocalRow } from './local-workbench-mapping'
import { employeeDisplayName } from '../organization/employee-display-name'
import { marketingDepartments } from '../users/marketing-departments'

/** Business-directory verification is independent of FOP authentication-proxy verification. */
export function buildReplicaOrganization(user: User, workspaceOwner: string, nodes: LocalRow[], employees: LocalRow[], company: { tenant_id: string; source_company_id: string }, options: { managerAnalytics?: boolean } = {}): LocalWorkbenchOrganization {
  const deny=(message: string): never=>{throw new ForbiddenException({code:'local_organization_scope_required',message})}
  const managerAnalytics=options.managerAnalytics&&businessScope(user).role==='department_manager'
  const scope=managerAnalytics?businessScope(user):effectiveBusinessScope(user)
  if(user.accountDisabled || scope.role==='none') deny('Local business access is disabled')
  const byId=new Map(nodes.map(node=>[node.id,node])), paths=new Map<string,string[]>()
  if(byId.size!==nodes.length || nodes.length && nodes.filter(node=>node.parent_id===null && node.kind==='organization').length!==1) deny('Invalid local organization root')
  for(const node of nodes) {
    const seen=new Set<string>(), path:string[]=[]; let current: LocalRow|undefined=node
    while(current) {
      if(seen.has(current.id)) deny('Invalid local organization cycle')
      seen.add(current.id);path.unshift(current.id)
      if(current.parent_id===null) {if(current.kind!=='organization')deny('Invalid local organization root');break}
      current=byId.get(current.parent_id)
      if(!current)deny('Missing local organization ancestor')
    }
    paths.set(node.id,path)
  }
  const own=employees.filter(employee=>employee.account_id===user.id && !employee.archived_at)
  if(own.length>1)deny('Ambiguous local account assignment')
  const members: LocalWorkbenchOrganization['members']=[], seenMaster=new Set<string>(), seenAccount=new Set<string>()
  const numeric=(value: unknown)=>typeof value==='string' && /^[1-9]\d{0,18}$/.test(value)
  for(const employee of employees) {
    if(employee.archived_at || !employee.account_id || employee.account_disabled)continue
    if(seenAccount.has(employee.account_id))deny('Ambiguous local account assignment')
    seenAccount.add(employee.account_id)
    if(byId.get(employee.department_id)?.kind!=='department')deny('Missing local employee department')
    let master:string|null=null
    if(employee.binding_id) {
      if(employee.binding_enabled && ['directory_verified','identity_verified'].includes(employee.binding_state)
        && numeric(employee.employee_master_id) && numeric(employee.person_record_id) && employee.employee_number?.trim()
        && employee.directory_verified_at && Number.isFinite(Date.parse(employee.directory_verified_at)) && Date.parse(employee.directory_verified_at)<=Date.now()) master=employee.employee_master_id
    } else {
      // Migration fallback only for the existing verified master-ID mapping, never bare fop_user_id/person_record_id.
      const binding=employee.fop_binding_details
      if(employee.fop_tenant_id===company.tenant_id && binding?.organizationId===company.source_company_id && binding.localEmployeeId===employee.id
        && numeric(binding.employeeMasterId) && numeric(binding.employeeRecordId) && binding.employeeNumber?.trim()
        && Number.isFinite(Date.parse(binding.verifiedAt)) && Date.parse(binding.verifiedAt)<=Date.now()) master=binding.employeeMasterId
    }
    if(!master)continue
    if(seenMaster.has(master))deny('Ambiguous FOP business employee mapping')
    seenMaster.add(master)
    members.push({employeeId:master,localEmployeeId:employee.id,departmentId:employee.department_id,name:employeeDisplayName(employee.name,employee.english_name),
      ...employee.english_name?.trim()?{englishName:employee.english_name.trim()}:{},
      ...employee.fop_tenant_id===company.tenant_id&&numeric(employee.fop_user_id)?{fopUserId:employee.fop_user_id}:{}})
  }
  // A customer UserField is not an employee master ID. Ambiguity must be resolved
  // before permission narrowing; a self-only view must not hide a duplicate mapping.
  const userCounts=new Map<string,number>()
  for(const member of members)if(member.fopUserId)userCounts.set(member.fopUserId,(userCounts.get(member.fopUserId)??0)+1)
  for(const member of members)if(member.fopUserId&&userCounts.get(member.fopUserId)!==1)delete member.fopUserId
  let departments=nodes.filter(node=>node.kind==='department'), visible=members, departmentId:string|null=null, employeeId:string|null=null
  if(scope.role==='department_manager') {
    departmentId=scope.departmentId
    if(!departmentId || byId.get(departmentId)?.kind!=='department')deny('Local manager department is missing')
    departments=departments.filter(node=>paths.get(node.id)?.includes(departmentId!))
    visible=members.filter(member=>paths.get(member.departmentId)?.includes(departmentId!))
  } else if(scope.role==='salesperson') {
    const member=own.length===1 ? members.find(member=>member.localEmployeeId===own[0].id):undefined
    if(!member)deny('Verified local employee directory mapping is required')
    departmentId=member!.departmentId;employeeId=member!.employeeId;visible=[member!];departments=departments.filter(node=>node.id===departmentId)
  }
  const version=createHash('sha256').update(JSON.stringify([workspaceOwner,user.id,company.tenant_id,company.source_company_id,user.role,user.businessRole,user.businessDepartmentId,user.dataDisplayScope,!!managerAnalytics,nodes,members,own.map(e=>[e.id,e.department_id])])).digest('hex')
  const marketingScope=marketingDepartments(nodes.filter(node=>node.kind==='department').map(node=>({id:node.id,name:node.name,parentId:node.parent_id})))
  const analyticsPeers=managerAnalytics&&departmentId&&marketingScope.departmentIds.includes(departmentId)?{
    departments:nodes.filter(node=>node.id===marketingScope.rootId||marketingScope.departmentIds.includes(node.id)).map(node=>({id:node.id,name:node.name,parentId:node.parent_id,pathIds:paths.get(node.id)!})),
    members:members.filter(member=>marketingScope.departmentIds.includes(member.departmentId)),
  }:undefined
  return { version,marketingScope,departments:departments.map(node=>({id:node.id,name:node.name,parentId:node.parent_id,pathIds:paths.get(node.id)!})),members:visible,
    ...analyticsPeers?{analyticsPeers}:{},
    employeeIds:scope.role==='admin'?null:visible.map(member=>member.employeeId).sort(),departmentId,employeeId }
}
