// Verify source field/filter/permission contracts independently of the shared layout, tested in single-sheet.spec.ts.
jest.mock('../workbench-export/single-sheet',()=>({...jest.requireActual('../workbench-export/single-sheet'),singleSheetWorkbook:jest.fn()}))
import { Workbook } from 'exceljs'
import { CollectedWorkbenchService } from './collected-workbench.service'
import { ConfigService } from '@nestjs/config'
const group={id:'purchase:20',kind:'purchase',purchase:{id:'20',number:'P20',supplier:{id:null,name:null},payment:'paid',placement:'placed'},stage:'unknown',shipment:'unknown',association:{state:'verified'},rows:[{orderId:'10',orderNumber:'TO10',ownerEmployeeId:'70',lines:[{sku:'A',quantity:2,shippedQuantity:null}]},{orderId:'11',orderNumber:'TO11',ownerEmployeeId:'71',lines:[{sku:'B',quantity:8,shippedQuantity:null}]}]}
function setup(employeeIds: string[]|null=['70']){
 // Even administrators receive the verified marketing employee set; unresolved rows have no scope.
 const scopedIds=employeeIds??['70','71']
 const db={source:structuredClone(group) as any,query:jest.fn(async(_sql:string,_params?:unknown[]):Promise<any[]>=>[])}
 db.query.mockImplementation(async(sql,params)=>{
  if(sql.includes("entity_type IN ('purchase','purchase_demand')"))return [{display:db.source}]
  if(sql.includes("entity_type='product'"))return []
  if(sql.includes('FROM hz_fop_collected_orders'))return db.source.rows.filter((r:any)=>r.orderId&&scopedIds.includes(r.ownerEmployeeId)&&(!sql.includes('source_id=ANY')||(params?.[1] as string[]).includes(r.orderId))).map((r:any)=>({source_id:r.orderId,display:{id:r.orderId,orderNumber:r.orderNumber,owner:{id:r.ownerEmployeeId},items:[],procurementStage:'unknown',procurementQueueFlags:{pending:true}},raw:{id:r.orderId,billno:r.orderNumber,billstatus:'C',hzkj_orderstatus:'2',hzkj_orders_billentry:[]}}))
  throw new Error('Unexpected fixture query: '+sql)
 })
 const service=new CollectedWorkbenchService(db as any,{} as any,new ConfigService()),context={user:{sessionVersion:1},filter:{employeeIds:scopedIds},org:{members:[],departments:[],employeeIds:scopedIds},batch:{id:'b',company_id:'100000',metadata:{entityCaptures:{procurement_groups:{companyId:'100000',capturedAt:'2026-11-12T00:00:00Z',coverage:'full_parent_scan'},receipt_notices:{companyId:'100000',coverage:'full_parent_scan'}}}},signature:'stable'}
 jest.spyOn(service as any,'context').mockResolvedValue(context);return{service,db,context}
}
it('unknown shipments appear only in explicit investigation filter, with authorized totals and details',async()=>{const {service,db}=setup();const empty=await service.purchaseGroups('u',{queue:'procurement_shipping'});expect(empty.items).toEqual([]);expect(empty.dataAvailability.unclassifiedCount).toBe(1);const r=await service.purchaseGroups('u',{queue:'procurement',purchaseStage:'unknown'});expect(r.total).toBe(1);expect(r.items[0].quantity).toBe(2);expect(r.items[0].rows).toBeUndefined();const d=await service.purchaseGroups('u',{queue:'procurement',purchaseStage:'unknown'},'purchase:20');expect(d.total).toBe(1);expect(d.items[0].orderId).toBe('10');expect(JSON.stringify(d)).not.toContain('TO11');expect(db.query.mock.calls[0][0]).toContain('ownerEmployeeId')})
it('details cannot bypass the active queue predicate',async()=>{const {service}=setup();await expect(service.purchaseGroups('u',{queue:'procurement_shipping'},'purchase:20')).rejects.toThrow('not found')})
it('purchase selected export uses groups selector and excludes all other owner details',async()=>{const {service}=setup();const buffer=await service.export('u',{queue:'procurement',purchaseStage:'unknown',mode:'selected',groupIds:['purchase:20']},1,'groups');expect(buffer).toBeInstanceOf(Buffer);await expect(service.export('u',{queue:'procurement',purchaseStage:'unknown',mode:'selected',groupIds:['purchase:OTHER']},1,'groups')).rejects.toThrow('Selection outside')})
it('receipt order view scopes each fulfillment owner before counting or paging',async()=>{const {service,db}=setup();db.query.mockImplementation(async(sql?:string)=>sql?.includes('WITH inbound_orders')?[{counts:{total:0,quantity:null,inbound_quantity:null,pending_quantity:null},unclassified:1,rows:[]}] as any:[]);const r=await service.receiptNotices('u',{});expect(r.total).toBe(0);expect(r.totals.inboundQuantity).toBeNull();expect(r.dataAvailability.queueAvailable).toBe(false);expect(db.query.mock.calls.filter(call=>call[0].includes('WITH inbound_orders')).every(call=>call[0].includes('o.owner_employee_id=ANY($2::text[])'))).toBe(true)})

it.each(['70','71'])('hides conflicted purchase first-version details from ordinary owner %s even in investigation',async owner=>{const {service,db}=setup([owner]);db.source={...group,association:{state:'conflict'}};const result=await service.purchaseGroups('u',{queue:'procurement',purchaseStage:'unknown'});expect(result.items).toEqual([]);expect(result.total).toBe(0);expect(db.query.mock.calls[0][0]).toContain("IS DISTINCT FROM 'conflict'")})

const partialGroup={...group,association:{state:'partial'},rows:[...group.rows,
 {orderId:null,orderNumber:'UNRESOLVED-A',ownerEmployeeId:null,lines:[{purchaseLineId:'201',quantity:3,shippedQuantity:null}]},
 {orderId:null,orderNumber:'UNRESOLVED-B',ownerEmployeeId:null,lines:[{purchaseLineId:'202',quantity:4,shippedQuantity:null},{purchaseLineId:'203',quantity:5,shippedQuantity:null}]}]}
it.each(['selected','filtered'])('admin %s export excludes unresolved purchase rows outside verified marketing ownership',async mode=>{
 const {service,db}=setup(null);db.source=partialGroup;
 const detail=await service.purchaseGroups('u',{queue:'procurement',purchaseStage:'unknown'},group.id)
 const unresolved=detail.items.filter((r:any)=>r.orderId===null)
 expect(unresolved).toEqual([]);expect(detail.items.map((r:any)=>r.orderId)).toEqual(['10','11'])
 const again=await service.purchaseGroups('u',{queue:'procurement',purchaseStage:'unknown'},group.id);expect(again.items.map((r:any)=>r.id)).toEqual(detail.items.map((r:any)=>r.id))
 const buffer=await service.export('u',{queue:'procurement',purchaseStage:'unknown',mode,...(mode==='selected'?{groupIds:[group.id]}:{})},1,'groups')
 const wb=new Workbook();await wb.xlsx.load(buffer as any);const sheet=wb.getWorksheet('授权关联明细')!
 expect(sheet.rowCount).toBe(3);expect(JSON.stringify(sheet.getSheetValues())).not.toContain('UNRESOLVED');expect(sheet.getRow(2).getCell(2).value).toBe('TO10');expect(sheet.getRow(3).getCell(2).value).toBe('TO11')
})
it.each(['selected','filtered'])('ordinary %s export excludes unresolved and other-owner purchase rows',async mode=>{
 const {service,db}=setup();db.source=partialGroup;
 const buffer=await service.export('u',{queue:'procurement',purchaseStage:'unknown',mode,...(mode==='selected'?{groupIds:[group.id]}:{})},1,'groups')
 const wb=new Workbook();await wb.xlsx.load(buffer as any);expect(wb.getWorksheet('授权关联明细')!.rowCount).toBe(2)
 expect(wb.getWorksheet('授权关联明细')!.getRow(2).getCell(2).value).toBe('TO10')
})

it.each(['allocation','allocation_review'])('%s count, list and filtered export apply the same authorized dispatch predicate',async queue=>{
 for(const taskStatus of ['dispatch_complete','dispatch_incomplete']){
  const {service,db,context}=setup();(context.batch as any).source_as_of='2026-11-12T00:00:00Z';(context.batch.metadata.entityCaptures as any).allocation={companyId:'100000',coverage:'full_parent_scan',capturedAt:'2026-11-12T00:00:00Z'}
  db.query.mockImplementation(async sql=>sql.startsWith('SELECT count(*)')?[{total:1,quantity:1}]:sql.includes('DISTINCT country_code')?[]:[{source_id:'10',display:{id:'10',orderNumber:'TO10',items:[],dispatchDocuments:[{status:'approved'}]},raw:{id:'10',billno:'TO10',billstatus:'C',hzkj_orders_billentry:[]}}])
  const query={queue,taskStatus,mode:'filtered'}
  expect((await service.orders('u',query,'allocation')).total).toBe(1)
  const buffer=await service.export('u',query,1,'orders');const wb=new Workbook();await wb.xlsx.load(buffer as any);expect(wb.getWorksheet('已采集订单')!.getColumn(1).values.filter(v=>v==='TO10')).toHaveLength(1);expect(wb.getWorksheet('已采集订单')!.getRow(3).getCell(1).text).toBe('合计 · 1 笔订单')
  for(const [sql,params] of db.query.mock.calls){expect(sql).toContain('jsonb_array_elements');expect(sql).toContain('owner_employee_id = ANY');expect(params?.slice(0,2)).toEqual(['b',['70']]);expect(sql.includes('NOT EXISTS(SELECT 1 FROM jsonb_array_elements')).toBe(taskStatus==='dispatch_incomplete')}
 }
})

it('admin purchase export paginates more than 100 verified marketing order rows',async()=>{
 const {service,db}=setup(null)
 const rows=Array.from({length:102},(_,n)=>({orderId:String(1000+n),orderNumber:'TO'+(1000+n),ownerEmployeeId:'70',lines:[{purchaseLineId:String(1000+n),quantity:1,shippedQuantity:null}]}))
 db.source={...partialGroup,rows}
 const first=await service.purchaseGroups('u',{queue:'procurement',purchaseStage:'unknown',pageSize:100},group.id)
 const second=await service.purchaseGroups('u',{queue:'procurement',purchaseStage:'unknown',pageSize:100,page:2},group.id)
 expect(new Set([...first.items,...second.items].map((r:any)=>r.id)).size).toBe(102)
 expect([...first.items,...second.items].every((r:any)=>r.orderId!==null&&r.ownerEmployeeId==='70')).toBe(true)
 const buffer=await service.export('u',{queue:'procurement',purchaseStage:'unknown',mode:'selected',groupIds:[group.id]},1,'groups')
 const wb=new Workbook();await wb.xlsx.load(buffer as any);expect(wb.getWorksheet('授权关联明细')!.rowCount).toBe(103)
})

// Counts product detail rows before pagination; repeated SKUs are still separate lines.
it.each([1,2,3])('previews %i authorized product lines without changing detail pagination or totals',async count=>{
 const {service,db}=setup()
 const lines=Array.from({length:count},(_,i)=>({fulfillmentLineId:String(i),purchaseLineId:String(201+i),sku:'SAME',name:'Item '+i,quantity:7,shippedQuantity:null}))
 db.source={...group,rows:[{...group.rows[0],lines},group.rows[1]]}
 const list=await service.purchaseGroups('u',{queue:'procurement',purchaseStage:'unknown',pageSize:1})
 expect(list.items[0]).toMatchObject({detailLineCount:count,skuCount:1,quantity:7*count,previewLines:count<3?lines:lines.slice(0,1)})
 expect(list.items[0].rows).toBeUndefined()
 const detail=await service.purchaseGroups('u',{queue:'procurement',purchaseStage:'unknown',pageSize:1},group.id)
 expect(detail.total).toBe(1);expect(detail.items[0].lines).toEqual(lines.map(line=>({...line,isVirtual:null})))
 expect(detail.group.previewLines).toEqual(list.items[0].previewLines)
 expect(JSON.stringify(list)).not.toContain('TO11')
})
it('counts preview product rows across all fulfillment detail pages',async()=>{
 const {service,db}=setup(null)
 db.source=partialGroup
 const result=await service.purchaseGroups('u',{queue:'procurement',purchaseStage:'unknown',pageSize:1},group.id)
 expect(result.group.detailLineCount).toBe(2);expect(result.group.previewLines).toHaveLength(2)
 expect(result.total).toBe(2);expect(result.items).toHaveLength(1)
})
