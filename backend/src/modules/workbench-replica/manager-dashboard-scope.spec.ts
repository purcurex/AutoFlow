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
it.each([1,2,3,4])('gives manager %s own records and authorized marketing/peer summaries',n=>{
 const {user,org}=fixture(n)
 for(const chartId of ['registrations','department_receipts','salesperson_receipts','order_volume','customer_orders'] as const){
  const r=managerDashboardScope(user,org,{},chartId)!
  expect(r.employeeIds).toEqual(chartId==='department_receipts'?[]:[`${n}1`,`${n}2`])
  expect(r.summaryEmployeeIds).toEqual(['11','12','21','22','31','32','41','42'])
  expect(r.departments.map(d=>d.id)).toEqual(['marketing','d1','d2','d3','d4'])
  expect(r.defaultDepartmentId).toBe('marketing')
  const peer=managerDashboardScope(user,org,{departmentId:`d${n%4+1}`},chartId)!
  expect(peer.summaryOnly).toBe(true);expect(peer.employeeIds).toEqual([])
  expect(peer.summaryEmployeeIds).toEqual([`${n%4+1}1`,`${n%4+1}2`])
  expect(()=>managerDashboardScope(user,org,{departmentId:'outside'},chartId)).toThrow()
  expect(()=>managerDashboardScope(user,org,{ownerId:`${n%4+1}1`},chartId)).toThrow()
 }
})
it('hides ungranted peer departments when an account has a narrower summary override',()=>{
 const {user,org}=fixture()
 user.chartPermissions=[{chartId:'order_volume',visibility:'allow',dataScope:'inherit',summaryMode:'selected',summaryDepartments:['sales2'],details:'inherit',export:'inherit'}]
 const r=managerDashboardScope(user,org,{},'order_volume')!
 expect(r.departments.map(d=>d.id)).toEqual(['marketing','d1','d2'])
 expect(r.summaryEmployeeIds).toEqual(['11','12','21','22'])
 expect(()=>managerDashboardScope(user,org,{departmentId:'d3'},'order_volume')).toThrow()
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
it('retains the assigned department option when it has no verified members or activity',()=>{
 const {user,org}=fixture()
 org.members=[];org.employeeIds=[];org.analyticsPeers!.members=org.analyticsPeers!.members.filter(m=>m.departmentId!=='d1')
 user.chartPermissions=[{chartId:'order_volume',visibility:'inherit',dataScope:'inherit',summaryMode:'none',summaryDepartments:[],details:'inherit',export:'inherit'}]
 const scope=managerDashboardScope(user,org,{},'order_volume')!
 expect(scope.departments).toEqual([{id:'d1',name:'业务一部'}])
 expect(scope.employeeIds).toEqual([]);expect(scope.summaryEmployeeIds).toEqual([])
 expect(()=>managerDashboardScope(user,org,{departmentId:'d2'},'order_volume')).toThrow()
})
