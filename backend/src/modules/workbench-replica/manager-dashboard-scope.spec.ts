import { managerDashboardScope } from './manager-dashboard-scope'
import { collaborationChartPermissions } from '../users/chart-permissions'
import { type User, UserRole } from '../users/user.entity'
import type { LocalWorkbenchOrganization } from '../users/local-workbench-organization'
const departments=[{id:'marketing',name:'营销中心',parentId:'root',pathIds:['root','marketing']},...[1,2,3,4].map((n,i)=>({id:`d${n}`,name:`业务${['一','二','三','四'][i]}部`,parentId:'marketing',pathIds:['root','marketing',`d${n}`]}))]
const members=[1,2,3,4].flatMap(n=>[1,2].map(i=>({employeeId:`${n}${i}`,localEmployeeId:`l${n}${i}`,departmentId:`d${n}`,name:`Private${n}${i}`})))
function fixture(n=1){
 const user={role:UserRole.USER,businessRole:'department_manager',businessDepartmentId:`d${n}`,dataDisplayScope:'self',workbenchRoles:['sales'],chartPermissions:[]} as unknown as User
 const org={version:'v1',departmentId:`d${n}`,employeeId:null,employeeIds:[`${n}1`,`${n}2`],members:members.filter(m=>m.departmentId===`d${n}`),departments:departments.filter(d=>d.id===`d${n}`),marketingScope:{rootId:'marketing',departmentIds:['d1','d2','d3','d4']},analyticsPeers:{departments,members}} as LocalWorkbenchOrganization
 return {user,org}
}
it.each([1,2,3,4])('gives manager %s own members plus independent four-department summaries',n=>{
 const {user,org}=fixture(n),r=managerDashboardScope(user,org,{},'order_volume')!
 expect(r.employeeIds).toEqual([`${n}1`,`${n}2`]);expect(r.summaryEmployeeIds).toHaveLength(8)
 expect(r.defaultDepartmentId).toBe('marketing');expect(r.summaryOnly).toBe(false)
 const peer=managerDashboardScope(user,org,{departmentId:`d${n%4+1}`},'customer_orders')!
 expect(peer.summaryOnly).toBe(true);expect(peer.employeeIds).toEqual([]);expect(peer.summaryEmployeeIds).toHaveLength(2)
 expect(()=>managerDashboardScope(user,org,{ownerId:`${n%4+1}1`},'order_volume')).toThrow()
 expect(()=>managerDashboardScope(user,org,{departmentId:'outside'},'order_volume')).toThrow()
})
it('requires a verified manager directory and keeps collaboration accounts summary-only',()=>{
 const {user,org}=fixture()
 expect(managerDashboardScope({...user,businessRole:'salesperson'},org,{},'order_volume')).toBeUndefined()
 expect(managerDashboardScope(user,{...org,analyticsPeers:undefined},{},'order_volume')).toBeUndefined()
 expect(managerDashboardScope({...user,businessRole:'admin',chartPermissions:collaborationChartPermissions()},org,{},'order_volume')).toBeUndefined()
})
it('honors explicit deny and summary restrictions without granting peer records',()=>{
 const {user,org}=fixture()
 user.chartPermissions=[{chartId:'order_volume',visibility:'deny',dataScope:'inherit',summaryMode:'inherit',summaryDepartments:[],details:'inherit',export:'inherit'}]
 expect(()=>managerDashboardScope(user,org,{},'order_volume')).toThrow()
 user.chartPermissions[0].visibility='inherit';user.chartPermissions[0].summaryMode='none'
 expect(managerDashboardScope(user,org,{},'order_volume')?.summaryEmployeeIds).toEqual(['11','12'])
 expect(()=>managerDashboardScope(user,org,{departmentId:'d2'},'order_volume')).toThrow()
})
