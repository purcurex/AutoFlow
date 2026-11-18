import { ConfigService } from '@nestjs/config'
import { Workbook } from 'exceljs'
import { CollectedWorkbenchService } from './collected-workbench.service'
const query={grain:'month',year:2026,currency:'CNY',dimension:'carrier'} as any
function setup(){
 const db={query:jest.fn(async(_sql:string,_params?:unknown[])=>[{total:1,amount:'12.34567890123456789',items:[{id:'d1',documentNumber:'FY1',confirmedAt:'2026-11-18T00:00:00Z',amount:'12.34567890123456789',currency:'CNY',weightKg:null}]}])}
 const c:any={signature:'v1',user:{id:'admin',role:'admin',sessionVersion:2},org:{employeeIds:['owner'],members:[{employeeId:'owner',departmentId:'d'}],departments:[{id:'d',name:'业务一部',pathIds:['m','d']}],marketingScope:{rootId:'m',departmentIds:['d']}},batch:{id:'b',company_id:'company',metadata:{analyticsCaptures:{dispatch:{nativeOwnership:true,companyId:'company',capturedAt:'2026-11-18T00:00:00Z'}}}}}
 const service=new CollectedWorkbenchService(db as any,{} as any,new ConfigService({WORKBENCH_COLLECTED_ENABLED:'true',WORKBENCH_READ_MODE:'local'})) as any
 const context=jest.spyOn(service,'context').mockResolvedValue(c)
 return {service,db,c,context}
}
describe('freight detail authorization and export',()=>{
 it('returns actual source headers and rechecks scope after the local read',async()=>{
  const {service,db,context,c}=setup();expect(service.freightDetails).toEqual(expect.any(Function))
  expect(await service.freightDetails('admin',query)).toMatchObject({total:1,amount:'12.34567890123456789',items:[{documentNumber:'FY1',weightKg:null}]})
  expect(db.query.mock.calls[0]?.[1]).toContainEqual(['owner'])
  context.mockResolvedValueOnce(c).mockResolvedValueOnce({...c,signature:'changed'})
  await expect(service.freightDetails('admin',query)).rejects.toThrow('changed')
 })
 it('rejects non-admin and unverified capture',async()=>{
  const {service,c}=setup();expect(service.freightDetails).toEqual(expect.any(Function))
  c.user.role='user';await expect(service.freightDetails('admin',query)).rejects.toThrow()
  c.user.role='admin';c.batch.metadata.analyticsCaptures.dispatch.nativeOwnership=false
  await expect(service.freightDetails('admin',query)).rejects.toThrow('not ready')
 })
 it('does not advertise CNY-only source details for another aggregate currency',async()=>{
  const {service,db}=setup();db.query.mockResolvedValueOnce([{buckets:[],missing_currency:0,missing_date:0,currencies:['USD'],warehouses:[],warehouse_options:[]}] as any)
  expect(await service.freightAnalytics('admin',{...query,currency:'USD'})).toMatchObject({canViewDetails:false,canExport:false})
 })
 it('rejects disabled mode before reading a context or record',async()=>{
  const db={query:jest.fn()},service=new CollectedWorkbenchService(db as any,{} as any,new ConfigService({WORKBENCH_COLLECTED_ENABLED:'true',WORKBENCH_READ_MODE:'live'}))
  await expect(service.freightDetails('admin',query)).rejects.toThrow('not enabled');expect(db.query).not.toHaveBeenCalled()
 })
 it('exports exact values with a bounded dataset and rejects an oversized export',async()=>{
  const {service,db}=setup();expect(service.exportFreightDetails).toEqual(expect.any(Function))
  const buffer=await service.exportFreightDetails('admin',query),wb=new Workbook();await wb.xlsx.load(buffer)
  expect(wb.worksheets[0].getRow(2).values).toContain('FY1')
  expect(wb.worksheets[0].getRow(2).values).toContain('12.34567890123456789')
  db.query.mockResolvedValueOnce([{total:10001,amount:'0',items:[]}]);await expect(service.exportFreightDetails('admin',query)).rejects.toThrow('10,000')
 })
})
