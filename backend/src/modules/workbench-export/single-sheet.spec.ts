import {Workbook} from 'exceljs'
import {singleSheetWorkbook,exportRowIdentity} from './single-sheet'
it('roundtrips one sheet with parent-above outline, explicit case identities, numbers and literal IDs',async()=>{
 const book=new Workbook(),main=book.addWorksheet('订单'),items=book.addWorksheet('商品明细')
 main.columns=[{header:'订单编号',key:'order'},{header:'客户',key:'customer'},{header:'金额',key:'amount'},{header:'收件地址',key:'address'}]
 items.columns=[{header:'订单编号',key:'order'},{header:'SKU',key:'sku'},{header:'数量',key:'quantity'}]
 for(const [id,sku] of [['case1','001'],['case2','002']]){exportRowIdentity(main.addRow({order:'0001234567890123456789',customer:'=CMD()',amount:12.34,address:'24 Demo Road, Flat 2'}),id);exportRowIdentity(items.addRow({order:'0001234567890123456789',sku,quantity:2}),id)}
 book.addWorksheet('说明').addRow(['范围','当前权限内'])
 await singleSheetWorkbook(book,{main:'订单',details:['商品明细']})
 const result=new Workbook();await result.xlsx.load(await book.xlsx.writeBuffer() as any)
 expect(result.worksheets).toHaveLength(1);const s=result.worksheets[0]
 expect(s.getRow(2).getCell(2).value).toBe('0001234567890123456789')
 expect(s.getRow(2).getCell(3).value).toBe('=CMD()')
 expect(s.getRow(2).getCell(4).value).toBe(12.34)
 expect(s.getRow(3).getCell(4).value).toBeNull()
 expect(s.getRow(3).getCell(6).value).toBe('001');expect(s.getRow(5).getCell(6).value).toBe('002')
 expect(s.getRow(3).outlineLevel).toBe(1);expect(s.getRow(3).hidden).toBe(false);expect(s.getRow(4).outlineLevel).toBe(0)
 expect(s.properties.outlineProperties.summaryBelow).toBe(false);expect(s.views[0]).toMatchObject({state:'frozen',xSplit:2,ySplit:1})
 expect(JSON.stringify(s.getSheetValues())).toContain('当前权限内')
})
it('keeps missing amounts empty, retains independent totals, and never drops unmatched details',async()=>{
 const b=new Workbook(),s=b.addWorksheet('主表'),d=b.addWorksheet('商品明细');s.columns=[{header:'订单',key:'id'},{header:'金额',key:'amount'}];d.columns=[{header:'订单',key:'id'},{header:'SKU',key:'sku'}]
 s.addRow({id:'A',amount:null});s.addRow({id:'合计',amount:0});d.addRow({id:'A',sku:'a'});d.addRow({id:'unresolved',sku:'b'})
 await singleSheetWorkbook(b,{main:'主表',details:['商品明细']});const out=b.worksheets[0]
 expect(out.getRow(2).getCell(3).value).toBeNull();expect(out.getRow(4).getCell(3).value).toBe(0);expect(JSON.stringify(out.getSheetValues())).toContain('unresolved')
})
