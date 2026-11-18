import {Workbook} from 'exceljs'
import {buildFulfillmentWorkbook} from '../fop-data/fop-order-export'
import {buildStockWorkbook} from '../fop-data/fop-stock-export'
import {buildRmaWorkbook} from '../fop-data/rma-orders-export'
import {buildPurchaseReturnWorkbook} from '../fop-data/purchase-returns-export'
import {buildPurchaseGroupWorkbook} from '../fop-data/procurement-groups-export'
it.each([
 ['履约',()=>buildFulfillmentWorkbook([],{queue:'review',mode:'filtered'},'mock')],
 ['备货',()=>buildStockWorkbook([],'mock')],
 ['RMA',()=>buildRmaWorkbook([],{mode:'filtered'} as any,'mock')],
 ['退货',()=>buildPurchaseReturnWorkbook([],{mode:'filtered'} as any,'mock')],
 ['采购分组',()=>buildPurchaseGroupWorkbook([])]
] as const)('%s exports exactly one usable sheet even with no data',async(_name,build)=>{
 const b=new Workbook();await b.xlsx.load(await build() as any)
 expect(b.worksheets).toHaveLength(1)
 const sheet=b.worksheets[0]
 expect(sheet.getCell('B2').text).not.toBe('')
 expect(sheet.getCell('A4').text).not.toBe('')
 const values:string[]=[];sheet.eachRow(row=>row.eachCell(cell=>values.push(typeof cell.value==='string'?cell.value:'')))
 expect(values).toContain('当前筛选暂无数据')
 expect(values.some(value=>value.includes('HyperZone'))).toBe(true)
 expect(b.worksheets[0].properties.outlineProperties.summaryBelow).toBe(false)
})
