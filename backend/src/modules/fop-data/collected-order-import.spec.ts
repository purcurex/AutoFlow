import { validateCollectedPage } from './collected-order-import'
const context={tenantId:'test',userId:'10',companyId:'100000'}
const page=(patch:Record<string,unknown>={})=>({workbenchFactsSchemaVersion:1,queue:'review',subject:{tenantId:'test',userId:'10'},organizationIds:['100000'],page:1,pageSize:100,items:[{id:'9007199254740993123',hzkj_org:{id:'100000'}}],hasMore:false,nextAfterOrderId:null,...patch})
describe('single-shot collected envelope',()=>{
 it('accepts terminal partial pages and retains huge IDs',()=>expect(validateCollectedPage(page(),context,1,null)).toEqual({ids:['9007199254740993123'],next:null}))
 it.each([{workbenchFactsSchemaVersion:2},{queue:'other'},{subject:{tenantId:'other',userId:'10'}},{organizationIds:['100000','200000']},{page:2},{hasMore:true,nextAfterOrderId:null},{items:[{id:9007199254740993000}]},{items:[{id:'10'},{id:'10'}]},{hasMore:true,nextAfterOrderId:'2'}])('rejects unsafe or wrong capture envelope %j',patch=>expect(()=>validateCollectedPage(page(patch),context,1,null)).toThrow())
 it('rejects replay and cursor retreat',()=>expect(()=>validateCollectedPage(page(),context,2,'9007199254740993123')).toThrow())
})
