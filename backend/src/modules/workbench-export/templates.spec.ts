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
 expect(b.worksheets).toHaveLength(1);expect(b.worksheets[0].getCell('A1').value).toBe('行类型')
 expect(b.worksheets[0].properties.outlineProperties.summaryBelow).toBe(false)
})
