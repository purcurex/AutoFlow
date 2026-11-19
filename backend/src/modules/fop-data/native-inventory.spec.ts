import {inventoryPages,reservedInventoryRow} from './native-inventory'
const row={id:'1',org_id:'100000',org_number:'org',hzkj_customer_id:'c',hzkj_local_sku_id:'s',hzkj_local_sku_number:'SKU',hzkj_warehouse_number:'01',hzkj_total_available_qty:0,hzkj_lock_qty:2,hzkj_deposit_avail_qty:3,hzkj_deposit_lock_qty:4}
it('keeps real zero and missing stock distinct; rights are not physical stock',()=>{
 const r=reservedInventoryRow(row);expect(r.fullPayment).toEqual({available:0,locked:2,onHand:null});expect(r.onHand).toBeNull()
 expect(reservedInventoryRow({...row,hzkj_lock_qty:null}).fullPayment.locked).toBeNull()
 expect(()=>reservedInventoryRow({...row,hzkj_customer_id:123})).toThrow()
})
const page={pageNo:1,pageSize:100,rows:[row],totalCount:1,lastPage:true}
it('reads authenticated bounded native pages',async()=>{const call=jest.fn().mockResolvedValue(page);expect(await inventoryPages(call,'reserved','100000','org')).toEqual([row]);expect(call).toHaveBeenCalledWith('reserved',{data:{org_number:'org'},pageNo:1,pageSize:100})})
it.each([{...page,rows:[{...row,org_id:'other'}]},{...page,totalCount:2},{...page,rows:[row,row],totalCount:2},{...page,pageNo:2}])('rejects foreign, incomplete, duplicate or wrong pages',async p=>{await expect(inventoryPages(async()=>p,'reserved','100000','org')).rejects.toThrow()})
import {inventoryMaterial} from './native-inventory'
it('uses explicit material relation, never SKU identity or code as a substitute',()=>{
 expect(inventoryMaterial({hzkj_local_sku:{id:'sku-id',number:'SKU',hzkj_material:{id:'material-id'}}})).toMatchObject({id:'material-id',sku:'SKU'})
 expect(()=>inventoryMaterial({hzkj_local_sku:{id:'sku-id',number:'SKU'}})).toThrow()
 expect(()=>inventoryMaterial({hzkj_local_sku:{number:'SKU',hzkj_material:{id:'a'}},hzkj_material:{id:'b'}})).toThrow()
})
it('accepts explicit flattened material relation returned by collection APIs',()=>{
 expect(inventoryMaterial({hzkj_material_id:'material',hzkj_local_sku_number:'SKU',hzkj_local_sku_name:'中文配货名'})).toEqual({id:'material',sku:'SKU',name:'中文配货名'})
 expect(()=>inventoryMaterial({hzkj_material_id:'a',hzkj_material:{id:'b'},hzkj_local_sku_number:'SKU'})).toThrow('Conflicting')
})
