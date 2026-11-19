import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { ListFulfillmentOrdersDto } from './workbench.dto'
import { StockOrdersQueryDto } from '../../fop-data/fop-stock.dto'
import { RmaQueryDto } from '../../fop-data/rma-orders.dto'
import { PurchaseReturnQueryDto } from '../../fop-data/purchase-returns.dto'
import { PurchaseGroupQueryDto } from '../../fop-data/procurement-groups.dto'
import { ReceiptNoticesQueryDto } from '../../workbench-replica/receipt-notices.dto'
const types:any[]=[ListFulfillmentOrdersDto,StockOrdersQueryDto,RmaQueryDto,PurchaseReturnQueryDto,PurchaseGroupQueryDto,ReceiptNoticesQueryDto]
it.each(types)('%p defaults to 100 and accepts all new sizes without exceeding 1000', Type=>{
 expect(new Type().pageSize).toBe(100)
 for(const pageSize of [100,200,500,1000]) expect(validateSync(plainToInstance(Type,{pageSize})).filter(e=>e.property==='pageSize')).toEqual([])
 expect(validateSync(plainToInstance(Type,{pageSize:1001})).some(e=>e.property==='pageSize')).toBe(true)
})

it('accepts only explicit boolean values for the local inbound cache bypass',()=>{
 for(const [value,expected] of [['true',true],['false',false],[true,true],[false,false]] as const){
  const dto=plainToInstance(ReceiptNoticesQueryDto,{refresh:value})
  expect(validateSync(dto)).toEqual([]);expect(dto.refresh).toBe(expected)
 }
 expect(validateSync(plainToInstance(ReceiptNoticesQueryDto,{refresh:'anything'})).some(e=>e.property==='refresh')).toBe(true)
})
