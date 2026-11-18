import { expect, it } from 'vitest'
import { skuPickingName,physicalProductsFirst } from '@/utils/product-display'
it('uses Chinese picking names and leaves missing values blank without English fallback',()=>{
 expect(skuPickingName({name:'  蓝色L码上衣  '})).toBe('蓝色L码上衣')
 for(const name of [undefined,null,'','  ','—'])expect(skuPickingName({name})).toBe('')
})

it('orders normal products, explicit gifts and virtual lines stably without inferring names or prices',()=>{
 const rows=[{sku:'HZ000020-001'},{sku:'GIFT',isGift:true},{sku:'MAIN',name:'赠品',price:0},{sku:'MAIN2'},{sku:'V',isVirtual:true}]
 expect(physicalProductsFirst(rows).map(r=>r.sku)).toEqual(['MAIN','MAIN2','GIFT','HZ000020-001','V']);expect(rows[0]!.sku).toBe('HZ000020-001')
})
