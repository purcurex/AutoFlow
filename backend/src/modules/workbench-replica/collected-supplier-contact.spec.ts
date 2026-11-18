import { ConfigService } from '@nestjs/config'
import { CollectedWorkbenchService } from './collected-workbench.service'
function setup(){
 const db={query:jest.fn().mockResolvedValue([])},s=new CollectedWorkbenchService(db as any,{} as any,new ConfigService({FOP_MANUAL_SUPPLIER_CONTACT_ENABLED:'true',FOP_KINGDEE_SUPPLIER_ORG_NUMBER:'hyperzone.test'}))
 const context={signature:'v1',batch:{id:'b',company_id:'100000'},filter:{employeeIds:['e']}}
 const auth=jest.spyOn(s as any,'context').mockResolvedValue(context)
 const read=jest.fn(async(_kind:any,body:any)=>({pageNo:1,pageSize:10,totalCount:1,lastPage:true,filter:"[org in (100000) AND org.number = 'hyperzone.test']",rows:[{id:'21',billno:'CG21',hzkj_1688_order_n:'5127372039298022434',hzkj_sellers_ww:'Seller',hzkj_billentry:[{id:'l',hzkj_salbillnumber:'TO1'}]}]}));(s as any).nativeSupplier={queryManualSupplierSource:read}
 return {s,db,read,auth,context}
}
const query={context:'fulfillment' as const,orderId:'o1',queue:'procurement_shipping' as const}
const order={source_id:'o1',display:{orderNumber:'TO1'}},group={display:{purchase:{id:'21',number:'CG21',platformOrderNumber:'5127372039298022434'},stage:'supplier_pending'}}
it('rejects an unavailable local order before any remote lookup',async()=>{
 const {s,db,read}=setup();await expect(s.supplierContacts('user',query)).rejects.toThrow('current queue');expect(read).not.toHaveBeenCalled();expect(db.query.mock.calls[0][1]).toContainEqual(['e'])
})
it('does not use a return from another order',async()=>{
 const {s,db,read}=setup();db.query.mockResolvedValueOnce([order]).mockResolvedValueOnce([{display:{lines:[{orderNumber:'FOREIGN'}]}}]);await expect(s.supplierContacts('u',{context:'purchase_return',orderId:'o1',returnId:'r1',workbenchRole:'procurement'})).rejects.toThrow('does not belong');expect(read).not.toHaveBeenCalled()
})
it('returns a verified contact without a launch URL and rechecks permission',async()=>{
 const {s,db,auth,context}=setup();db.query.mockResolvedValueOnce([order]).mockResolvedValueOnce([group]);const r=await s.supplierContacts('u',query);expect(r.items[0]).toMatchObject({purchaseOrderId:'21',availability:'ready'});expect(r.items[0].url).toBeUndefined()
 auth.mockResolvedValueOnce(context).mockResolvedValueOnce({...context,signature:'revoked'});db.query.mockResolvedValueOnce([order]).mockResolvedValueOnce([group]);await expect(s.supplierContacts('u',query)).rejects.toThrow('权限')
})
it('requires the current supplier version before launching',async()=>{
 const {s,db}=setup();db.query.mockResolvedValueOnce([order]).mockResolvedValueOnce([group]);const r=await s.supplierContacts('u',query)
 db.query.mockResolvedValueOnce([order]).mockResolvedValueOnce([group]);await expect(s.supplierContacts('u',query,{contactVersion:'0'.repeat(64),purchaseOrderId:'21'})).rejects.toThrow('变化')
 db.query.mockResolvedValueOnce([order]).mockResolvedValueOnce([group]);const launched=await s.supplierContacts('u',query,{contactVersion:r.items[0].contactVersion,purchaseOrderId:'21'});expect(launched.url).toBe('aliim:sendmsg?touid=cnalichnSeller')
})
