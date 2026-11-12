import { KingdeeWorkbenchDiagnosticProvider as KingdeeFopDataProvider } from './fop-kingdee.diagnostic'
import { isStageCompleted } from './completed-orders'
const identity = { tenantId: 'test', userId: '100' }
const scope = { role: 'salesperson' as const, employeeId: '500', departmentId: '400' }
const grant = { subject: identity, allowedOrderIds: [], orderQuery: { queues: ['review'] as 'review'[], organizationIds: ['10'] } }
const ref = (id: string) => ({ id, name: id })
const at = new Date(Date.now()-1000).toISOString()
const row = (id: string, patch: Record<string, unknown> = {}) => ({ id, billno: `TO-${id}`, billstatus: 'C', auditdate: at, createtime: at, hzkj_datetimefield: at,
  hzkj_billtype: { number: 'hzkj_orders_BT' }, hzkj_org: ref('10'), hzkj_operator: ref('500'), hzkj_dept: ref('400'), departmentPathIds: ['10','400'],
  hzkj_customer: ref('200'), hzkj_shop: ref('300'), hzkj_dst_warehouse: ref('20'), hzkj_currency: { number: 'USD' }, hzkj_order_amount: '10.25', hzkj_receipt_status: '1',
  hzkj_source_number: '#123', hzkj_receipt_date: at, hzkj_orderstatus: '4', hzkj_country: { twocountrycode: 'GB' },
  hzkj_orders_billentry: [{ id: `6${id}`, pid: '0', seq: '1', hzkj_qty: '2', hzkj_local_sku: { number: 'SKU', name: 'Product', hzkj_picturefield: 'https://example.test/sku.jpg' } }], ...patch })
function setup(patch: Record<string,unknown> = {}, custom?: Record<string,unknown>[]) {
  const requests: any[]=[]
  const config: Record<string,string> = { FOP_KINGDEE_WORKBENCH_FACTS_MODE: 'raw', FOP_KINGDEE_CUSTOMER_RECEIPTS_URL:'https://example.test/receipts', FOP_KINGDEE_ORGANIZATION_NUMBERS:'{"10":"company"}', FOP_KINGDEE_QUERY_URL:'https://example.test/page', FOP_KINGDEE_SUMMARY_URL:'https://example.test/summary', FOP_KINGDEE_TENANT_ID:'test', FOP_KINGDEE_USER_ID:'100', FOP_KINGDEE_ORGANIZATION_IDS:'10', FOP_KINGDEE_ACCESS_TOKEN:'fixture', FOP_KINGDEE_IDENTITY:'fixture' }
  const provider = new KingdeeFopDataProvider({ get:key=>config[key] }, async (_url, init)=> {
    if(String(_url).endsWith('/receipts')) throw new Error('Unnecessary receipt read')
    const query=JSON.parse(String(init?.body)).query;requests.push(query)
    const data = { subject:identity, organizationIds:['10'], workbenchFactsSchemaVersion:1, queue:'review', page:query.page, pageSize:100,
      hasMore:!query.afterOrderId, nextAfterOrderId:query.afterOrderId?null:'1000', items:query.afterOrderId ? custom??[row('1001', { hzkj_receipt_status:'0', hzkj_orderstatus:'1' })] : [row('1000',{billstatus:'A'})], ...patch }
    return new Response(JSON.stringify({ status:true,errorCode:'0',data }))
  })
  return { provider, requests, read:()=>provider.queryOrders(identity,grant,scope,{queue:'review',completed:true,timeRange:'1w',page:1,pageSize:20}) }
}
it('collects all authorized pages then includes audited orders irrespective of order/payment stage', async()=>{
  const {read,requests}=setup();const result=await read()
  expect(result.total).toBe(1);expect(result.items[0]).toMatchObject({id:'1001',reviewStatus:'approved',paymentStatus:'unpaid',reviewedAt:at,amount:10.25})
  expect(isStageCompleted(result.items[0],'review')).toBe(true)
  expect(requests).toHaveLength(2);expect(requests[0]).toMatchObject({rawWorkbenchFacts:true});expect(requests[0].completed).toBeUndefined()
  expect(result.totals).toEqual({orderCount:1,itemQuantity:2,amountsByCurrency:[{currency:'USD',amount:10.25}]})
})
it.each([{subject:{tenantId:'test',userId:'101'}},{organizationIds:['11']},{workbenchFactsSchemaVersion:0},{nextAfterOrderId:null}])('rejects wrong authority, version or incomplete pagination %j',async patch=>{
  await expect(setup(patch).read()).rejects.toThrow()
})
it('filters by the own-document receipt date before sorting and pagination, preserving all SKU lines on a match', async()=>{
  const rows=[row('1001',{hzkj_receipt_date:'2020-01-01T00:00:00Z'}),row('1002',{hzkj_receipt_date:at}),row('1003',{hzkj_receipt_date:new Date(Date.now()-500).toISOString()})]
  const {provider}=setup({},rows)
  const page=await provider.queryOrders(identity,grant,scope,{queue:'review',completed:true,timeRange:'1w',page:1,pageSize:1,search:'SKU'})
  expect(page.total).toBe(2);expect(page.items.map(i=>i.id)).toEqual(['1003']);expect(page.items[0].items).toHaveLength(1)
})
it('rejects a foreign employee rather than hiding it in an otherwise valid page',async()=>{
  await expect(setup({},[row('1001',{hzkj_operator:ref('501')})]).read()).rejects.toThrow()
})

import * as ExcelJS from 'exceljs'
import { FopDataService } from './fop-data.service'
import type { UsersService } from '../users/users.service'
import type { User } from '../users/user.entity'
function serviceSetup(custom?: Record<string,unknown>[]) {
  const x=setup({},custom)
  const user={id:'local',role:'user',businessRole:'salesperson',businessEmployeeId:'500',businessDepartmentId:'400',workbenchRoles:['sales'],fopTenantId:'test',fopUserId:'100',sessionVersion:0,
    fopBindingDetails:{username:'alex',employeeRecordId:'500',employeeMasterId:'500',departmentId:'400',organizationId:'10',verifiedAt:at}} as unknown as User
  const permissions=jest.spyOn(x.provider,'resolvePermissions').mockResolvedValue(grant)
  const service=new FopDataService({findById:async()=>user} as unknown as UsersService,x.provider)
  return {...x,service,permissions}
}
it('exposes sales history through the service and exports the full filtered scope as well as a selection',async()=>{
  const {service,permissions}=serviceSetup([row('1001'),row('1002')])
  const list=await service.getOrders('local',{queue:'review',completed:true,page:1,pageSize:1})
  expect(list.total).toBe(2);expect(list.items).toHaveLength(1)
  for(const mode of ['filtered','selected'] as const){
    const book=new ExcelJS.Workbook()
    const data=await service.exportOrders('local',{queue:'review',completed:true,timeRange:'1w',mode,...(mode==='selected'?{orderIds:['1002']}:{})},0)
    await book.xlsx.load(data as never)
    const values=JSON.stringify(book.getWorksheet('订单清单')!.getSheetValues())
    expect(values).toContain('TO-1002')
    expect(values.includes('TO-1001')).toBe(mode==='filtered')
  }
  expect(permissions).toHaveBeenCalledTimes(5)
})
it('rechecks current approval state before releasing an export',async()=>{
  const records=[row('1001')],{service,permissions}=serviceSetup(records)
  permissions.mockResolvedValueOnce(grant).mockImplementationOnce(async()=>{records[0].billstatus='A';return grant})
  await expect(service.exportOrders('local',{queue:'review',completed:true,timeRange:'1w',mode:'filtered'},0)).rejects.toMatchObject({response:{code:'export_selection_changed'}})
})

import { completedSalesRows } from './fop-kingdee.sales-completed'
it('uses receipt date even when audit and source times disagree, and never fills missing dates',()=>{
 const recent=new Date(Date.now()-3600000).toISOString()
 const rows=[row('1001',{hzkj_receipt_date:'2020-01-01T00:00:00Z'}),row('1002',{auditdate:'2020-01-01T00:00:00Z',hzkj_receipt_date:recent}),row('1003',{hzkj_receipt_date:null}),row('1004',{hzkj_receipt_date:'invalid'})]
 const result=completedSalesRows(rows,{queue:'review',completed:true,timeRange:'1w',page:1,pageSize:20},{})
 expect(result.map(r=>r.id)).toEqual(['1002'])
 expect(result[0].consumerPaidAt).toBe(recent)
})
