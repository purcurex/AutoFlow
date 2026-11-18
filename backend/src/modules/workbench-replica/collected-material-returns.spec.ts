import { collectedMaterialReturnsQuery } from './collected-material-returns'
it('uses batch, current employee permission and unique explicit order numbers; never SKU joins',()=>{
 const q=collectedMaterialReturnsQuery('b',['employee'],{search:"%'x",warehouseCode:'HZ',mode:'selected',orderIds:['o']})
 expect(q.params.slice(0,2)).toEqual(['b',['employee']]);expect(q.params).toContainEqual(['o']);expect(q.cte).toContain('o.owner_employee_id=ANY($2::text[])')
 expect(q.cte).toContain("o.order_number=l->>'orderNumber'");expect(q.cte).toContain('u.order_number=o.order_number)=1');expect(q.cte).not.toContain("%'x")
 expect(q.cte).not.toContain("l->>'sku'=")
})
import { CollectedWorkbenchService } from './collected-workbench.service'
import { ConfigService } from '@nestjs/config'
it('shows the full order and only its associated return lines, with unknown execution left blank',async()=>{
 const service:any=new CollectedWorkbenchService({} as any,{} as any,new ConfigService())
 const context={signature:'same',filter:{employeeIds:['e']},batch:{id:'b',company_id:'100000',metadata:{entityCaptures:{purchase_material_return:{companyId:'100000',capturedAt:'2026-11-17T00:00:00Z'}}}},org:{members:[],departments:[]}}
 service.context=jest.fn(async()=>context);service.metadata=()=>({replica:{readMode:'local'}});service.productDisplay=async(_b:string,items:any)=>items
 service.db={query:jest.fn().mockResolvedValueOnce([{total:1,return_count:1,quantity:'2'}]).mockResolvedValueOnce([{display:{id:'o',orderNumber:'O1',items:[{id:'a'},{id:'b'}]},raw:{},documents:[{id:'r',number:'R1',lines:[{id:'l',quantity:2,orderPurchases:[{id:'p1',number:'P1'},{id:'p2',number:'P2'}]}]}]}])}
 const result=await service.purchaseReturns('u',{workbenchRole:'procurement',page:1,pageSize:50})
 expect(result.items[0].items).toHaveLength(2);expect(result.items[0].purchaseReturns[0].lines[0].sourceOrder.number).toBe('O1');expect(result.items[0].returnQuantity).toBe(2);expect(result.items[0].returnedQuantity).toBeNull()
 expect(result.items[0].relatedPurchaseOrders.map((p:any)=>p.number)).toEqual(['P1','P2'])
 expect(service.context).toHaveBeenCalledTimes(2)
})
