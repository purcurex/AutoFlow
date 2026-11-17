import {it,expect} from 'vitest'
import {warehouseName} from '@/utils/warehouse'
it.each(['HZ','01','Hangzhou','HangZhou','杭州仓'])('displays %s as HangZhou',value=>expect(warehouseName(value)).toBe('HangZhou'))
it.each(['SZ','HNDGLB','Shenzhen','ShenZhen','深圳仓'])('displays %s as ShenZhen',value=>expect(warehouseName(value)).toBe('ShenZhen'))
it('preserves unknown warehouses and does not invent missing names',()=>{
 expect(warehouseName('Other Warehouse')).toBe('Other Warehouse');expect(warehouseName(null)).toBe('—')
})
