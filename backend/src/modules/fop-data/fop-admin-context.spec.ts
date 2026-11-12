import { FopDataService } from './fop-data.service'
import { FopDataProvider, type FopIdentity } from './fop-data.types'
import { KingdeeFopDataProvider } from './fop-kingdee.provider'
import { UserRole, type User } from '../users/user.entity'
import type { UsersService } from '../users/users.service'
const identity={tenantId:'test',userId:'100'}
it('lets a current system administrator query through service context without stealing an employee binding',async()=>{
 const account={id:'admin',role:UserRole.ADMIN,businessRole:'none',workbenchRoles:[],fopTenantId:null,fopUserId:null,fopBindingDetails:null,sessionVersion:0} as unknown as User
 class Provider extends FopDataProvider {
  readonly supportsEmployeeBinding=true;readonly pagedOrders=true
  isConfigured(){return true}
  async listOrders(){return []}
  async administratorIdentity(){return identity}
  async resolvePermissions(subject:FopIdentity){return {subject,allowedOrderIds:[],orderQuery:{queues:['review' as const],organizationIds:['10']}}}
  async queryOrders(subject:FopIdentity,_permission:unknown,scope:any,query:any){
   expect(subject).toEqual(identity);expect(scope.role).toBe('admin')
   return {source:'fop' as const,items:[],total:0,page:query.page,pageSize:query.pageSize,totals:{orderCount:0,itemQuantity:0,amountsByCurrency:[]}}
  }
 }
 const service=new FopDataService({findById:async()=>account} as unknown as UsersService,new Provider())
 await expect(service.getOrders('admin',{queue:'review',completed:true,page:1,pageSize:20})).resolves.toMatchObject({source:'fop',total:0})
 expect(account.fopBindingDetails).toBeNull()
 account.role=UserRole.USER
 await expect(service.getOrders('admin',{queue:'review',completed:true,page:1,pageSize:20})).rejects.toThrow()
})
it('separates service authentication from employee resolver and requires opt-in',async()=>{
 const config:Record<string,string>={FOP_KINGDEE_QUERY_URL:'https://example.test/orders',FOP_KINGDEE_SUMMARY_URL:'https://example.test/summary',FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL:'https://example.test/permissions',FOP_KINGDEE_IDENTITY:'fixture',FOP_KINGDEE_ACCESS_TOKEN:'fixture',FOP_KINGDEE_ADMIN_SERVICE_ACCESS:'true'}
 const resolve=jest.fn(async()=>null)
 const provider=new KingdeeFopDataProvider({get:k=>config[k]},async()=>new Response(JSON.stringify({status:true,errorCode:'0',data:{subject:identity,currentOrganization:{id:'10',name:'Company'},grants:{orders:['10'],receipts:[],freight:[],registrations:[]}}})),resolve)
 const adminIdentity=await (provider as any).administratorIdentity()
 expect(adminIdentity).toMatchObject(identity)
 const grant=await provider.resolvePermissions(adminIdentity,{role:'admin',departmentId:null,employeeId:null})
 expect(grant.orderQuery?.organizationIds).toEqual(['10']);expect(resolve).not.toHaveBeenCalled()
 await expect(provider.resolvePermissions(adminIdentity,{role:'salesperson',departmentId:'20',employeeId:'30'})).rejects.toThrow()
 config.FOP_KINGDEE_ADMIN_SERVICE_ACCESS='false'
 expect(await (provider as any).administratorIdentity()).toBeNull()
})
