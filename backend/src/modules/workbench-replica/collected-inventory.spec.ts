import {ConfigService} from '@nestjs/config'
import {CollectedWorkbenchService} from './collected-workbench.service'
const inventory={id:'i',status:'C',org_id:'100000',org_number:'org',hzkj_customer_id:'c',hzkj_local_sku_id:'s',hzkj_local_sku_number:'SKU',hzkj_warehouse_number:'01',hzkj_total_available_qty:4,hzkj_lock_qty:1,hzkj_deposit_avail_qty:2,hzkj_deposit_lock_qty:0}
function setup(){
 const db={query:jest.fn().mockResolvedValue([{source_id:'c'}])},s=new CollectedWorkbenchService(db as any,{} as any,new ConfigService({FOP_MANUAL_INVENTORY_ENABLED:'true',FOP_KINGDEE_INVENTORY_ORG_NUMBER:'org'}))
 const context={signature:'v1',batch:{id:'b',company_id:'100000'},filter:{employeeIds:['e']},org:{members:[{employeeId:'e',fopUserId:'u'}]}}
 jest.spyOn(s as any,'context').mockResolvedValue(context)
 const read=jest.fn().mockResolvedValue({pageNo:1,pageSize:100,totalCount:1,lastPage:true,rows:[inventory]});(s as any).nativeInventory={queryManualInventory:read}
 return {s,db,read}
}
it('filters customer rights before pagination, retains native warehouse and never invents physical stock',async()=>{
 const {s,read}=setup();const r=await s.inventory('user',{page:1,pageSize:50,warehouseCode:'HZ'},'reserved')
 expect(r.total).toBe(1);expect(r.items[0]).toMatchObject({customerId:'c',onHand:null,fullPayment:{available:4,locked:1}})
 expect(read).toHaveBeenCalledTimes(1)
})
it('rejects foreign explicit customer before upstream call',async()=>{const {s,read}=setup();await expect(s.inventory('user',{customerId:'foreign'},'reserved')).rejects.toThrow();expect(read).not.toHaveBeenCalled()})
it('rechecks revocation before response',async()=>{const {s,db}=setup();db.query.mockResolvedValueOnce([{source_id:'c'}]).mockResolvedValueOnce([]);expect((await s.inventory('user',{page:1,pageSize:50},'reserved')).total).toBe(0)})
it('rejects inaccessible selected orders before inventory call',async()=>{const {s,db,read}=setup();db.query.mockResolvedValueOnce([{source_id:'c'}]).mockResolvedValueOnce([]);await expect(s.inventory('user',{orderIds:['foreign']},'reserved')).rejects.toThrow();expect(read).not.toHaveBeenCalled()})
it('does not substitute SKU id for missing material mapping',async()=>{
 const {s,db,read}=setup()
 db.query.mockResolvedValueOnce([{source_id:'c'}]).mockResolvedValueOnce([{source_id:'order',raw:{hzkj_orders_billentry:[{hzkj_local_sku:{id:'sku',number:'SKU'}}]}}])
 await expect(s.inventory('user',{mode:'selected',orderIds:['order'],page:1,pageSize:50},'current')).rejects.toThrow()
 expect(read).not.toHaveBeenCalled()
})
it('does not expose inventory with unresolved customer pools',async()=>{
 const {s,db,read}=setup()
 db.query.mockResolvedValueOnce([{source_id:'c'}]).mockResolvedValueOnce([{source_id:'order',raw:{hzkj_orders_billentry:[{hzkj_local_sku:{id:'sku',number:'SKU'},hzkj_material:{id:'material'}}]}}])
 read.mockResolvedValue({pageNo:1,pageSize:100,totalCount:1,lastPage:true,rows:[{id:'i',org_id:'100000',org_number:'org',material_id:'material',qty:99}]})
 await expect(s.inventory('user',{mode:'selected',orderIds:['order'],page:1,pageSize:50},'current')).rejects.toThrow()
 expect(read).toHaveBeenCalledWith('current',expect.objectContaining({data:{org_number:'org',material_id:'material'}}))
})

it('always binds each authorized customer in reserved-stock source requests',async()=>{
 const {s,db,read}=setup();db.query.mockResolvedValue([{source_id:'c'},{source_id:'c2'}])
 read.mockImplementation(async(_kind,body)=>({pageNo:1,pageSize:100,totalCount:1,lastPage:true,rows:[{...inventory,id:body.data.hzkj_customer_id??'unscoped',hzkj_customer_id:body.data.hzkj_customer_id??'c'}]}))
 const result=await s.inventory('user',{page:1,pageSize:50},'reserved')
 expect(read.mock.calls.map(([,body])=>body.data)).toEqual([{org_number:'org',hzkj_customer_id:'c'},{org_number:'org',hzkj_customer_id:'c2'}])
 expect(result.total).toBe(2)
})
it('narrows selected stock orders to their authorized customer before querying FOP',async()=>{
 const {s,db,read}=setup();db.query.mockResolvedValueOnce([{source_id:'c'},{source_id:'c2'}]).mockResolvedValueOnce([{source_id:'stock',display:{customerId:'c2',items:[{sku:'SKU'}]}}]).mockResolvedValue([{source_id:'c'},{source_id:'c2'}])
 read.mockResolvedValue({pageNo:1,pageSize:100,totalCount:1,lastPage:true,rows:[{...inventory,hzkj_customer_id:'c2'}]})
 const result=await s.inventory('user',{orderIds:['stock'],page:1,pageSize:50},'reserved')
 expect(read).toHaveBeenCalledTimes(1);expect(read.mock.calls[0][1].data.hzkj_customer_id).toBe('c2');expect(result.total).toBe(1)
})
it('requires a narrower customer scope before exceeding the reserved inventory request budget',async()=>{
 const {s,db,read}=setup();db.query.mockResolvedValue(Array.from({length:21},(_,i)=>({source_id:'c'+i})))
 await expect(s.inventory('user',{page:1,pageSize:50},'reserved')).rejects.toThrow('请选择客户')
 expect(read).not.toHaveBeenCalled()
})
it('fails closed if FOP ignores the selected customer filter',async()=>{
 const {s,read}=setup()
 read.mockResolvedValue({pageNo:1,pageSize:100,totalCount:2,lastPage:true,rows:[inventory,{...inventory,id:'other',hzkj_customer_id:'foreign'}]})
 await expect(s.inventory('user',{customerId:'c'},'reserved')).rejects.toMatchObject({response:{code:'fop_inventory_filter_unverified'}})
 expect(read).toHaveBeenCalledTimes(1)
})
