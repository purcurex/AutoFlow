import { Workbook } from 'exceljs'
import { SourcingImageResolverService } from '../sourcing/sourcing-image-resolver.service'
import { exportRowIdentity, singleSheetWorkbook } from './single-sheet'
import { exportStatusName } from './status-names'
afterEach(()=>jest.restoreAllMocks())
it.each([['付款状态','paid','已支付'],['审核状态','approved','已审核'],['配货原生审核状态','A / C','暂存 / 已审核'],['备货类型','full_payment','全款备货'],['采购状态','partial','部分采购'],['原生售后类型','A','退货退款'],['原生流程状态','3','处理完成'],['已取消',false,'否'],['付款状态','future','待核查'],['SKU','paid','paid']])('translates %s %s', (header,value,expected)=>expect(exportStatusName(header as string,value)).toBe(expected))
it('embeds and deduplicates PNGs, retains failed links and children after XLSX roundtrip',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6JAAAAABJRU5ErkJggg==','base64')
 const resolve=jest.spyOn(SourcingImageResolverService.prototype,'resolveExportThumbnail').mockImplementation(async url=>{if(url.includes('bad'))throw Error('offline');return png})
 const b=new Workbook(),m=b.addWorksheet('主表'),d=b.addWorksheet('商品明细');m.columns=[{header:'订单编号',key:'id'},{header:'付款状态',key:'status'}];d.columns=[{header:'订单编号',key:'id'},{header:'图片',key:'url'}];m.addRow({id:'A',status:'paid'});for(const url of ['https://example.com/a.png','https://example.com/a.png','https://example.com/bad.png'])d.addRow({id:'A',url})
 await singleSheetWorkbook(b,{main:'主表',details:['商品明细']});const loaded=new Workbook();await loaded.xlsx.load(await b.xlsx.writeBuffer() as any);const s=loaded.worksheets[0]
 expect(resolve).toHaveBeenCalledTimes(2)
 const images=s.getImages().filter(i=>i.range.tl.nativeRow>=4)
 expect(images).toHaveLength(2);expect(images[0].imageId).toBe(images[1].imageId)
 let imageCol=0,statusCol=0;s.getRow(4).eachCell((c,n)=>{if(c.text==='商品图片')imageCol=n;if(c.text==='付款状态')statusCol=n})
 expect(s.getCell(5,statusCol).value).toBe('已支付');expect(s.getRow(5).height).toBeGreaterThanOrEqual(62)
 expect(s.getCell(7,imageCol).value).toEqual({text:'查看原图',hyperlink:'https://example.com/bad.png'})

})
it('does not attempt local file or data URLs',async()=>{const spy=jest.spyOn(SourcingImageResolverService.prototype,'resolveExportThumbnail');const b=new Workbook(),s=b.addWorksheet('a');s.columns=[{header:'商品图片'}];s.addRow(['file:///etc/passwd']);await singleSheetWorkbook(b,{main:'a',details:[]});expect(spy).not.toHaveBeenCalled()})

it('handles merged blank document identifiers without losing thumbnail links',async()=>{
 const spy=jest.spyOn(SourcingImageResolverService.prototype,'resolveExportThumbnail').mockRejectedValue(Error('offline'))
 const b=new Workbook(),m=b.addWorksheet('主表'),d=b.addWorksheet('商品明细')
 m.columns=[{header:'采购单号',key:'id'}];d.columns=[{header:'采购单号',key:'id'},{header:'图片',key:'url'}]
 exportRowIdentity(m.addRow({id:null}),'pending-group')
 for(let n=0;n<2;n++)exportRowIdentity(d.addRow({id:null,url:'https://example.com/a.png'}),'pending-group')
 await singleSheetWorkbook(b,{main:'主表',details:['商品明细']})
 expect(spy).toHaveBeenCalledTimes(1)
 expect(b.worksheets[0].getCell('A6').isMerged).toBe(true)
})
