import * as fs from 'node:fs'
import * as path from 'node:path'
import {Workbook,Worksheet} from 'exceljs'
import {singleSheetWorkbook,exportRowIdentity,exportProductRow} from './single-sheet'
const column=(s:Worksheet,h:string)=>{let col=0;s.getRow(4).eachCell((c,n)=>{if(c.text===h)col=n});return col}
const cells=(s:Worksheet)=>s.getSheetValues().flat().filter(v=>v!==null&&v!==undefined)
it('roundtrips compact merged documents, exact IDs and amounts, explicit case identities and all supplementary fields',async()=>{
 const b=new Workbook(),m=b.addWorksheet('订单'),d=b.addWorksheet('商品明细')
 m.columns=['订单编号','客户','金额','收件地址','币种','电子邮箱','备注'].map(header=>({header}))
 d.columns=['订单编号','SKU','商品名称','规格','数量'].map(header=>({header}))
 for(const id of ['case1','case2']){
  exportRowIdentity(m.addRow(['0001234567890123456789','=CMD()',12.34,'24 Demo Road, Flat 2','USD','a@example.com','完整长文本'.repeat(60)]),id)
  for(const item of [{sku:`${id}-virtual`,isVirtual:true},{sku:`${id}-gift`,isGift:true},{sku:`${id}-main`}])exportRowIdentity(exportProductRow(d.addRow(['0001234567890123456789',item.sku,'商品名','长规格'.repeat(20),2]),item),id)
 }
 b.addWorksheet('说明').addRow(['范围','当前权限内'])
 await singleSheetWorkbook(b,{main:'订单',details:['商品明细']})
 const loaded=new Workbook();await loaded.xlsx.load(await b.xlsx.writeBuffer() as any);expect(loaded.worksheets).toHaveLength(1)
 const s=loaded.worksheets[0],sku=column(s,'SKU'),amount=column(s,'金额'),order=column(s,'订单编号')
 expect(s.columnCount).toBeLessThanOrEqual(14);expect(s.getCell(5,order).value).toBe('0001234567890123456789');expect(s.getCell(6,order).isMerged).toBe(true)
 expect(s.getCell(5,amount).value).toBe(12.34);expect(s.getCell(6,amount).master.address).toBe(s.getCell(5,amount).address)
 const skus:string[]=[];s.eachRow(r=>{if(/case\d-/.test(r.getCell(sku).text))skus.push(r.getCell(sku).text)})
 expect(skus).toEqual(['case1-main','case1-gift','case1-virtual','case2-main','case2-gift','case2-virtual'])
 expect(cells(s)).toContain('=CMD()');expect(cells(s)).toContain('当前权限内');expect(cells(s)).toContain('完整长文本'.repeat(60));expect(cells(s)).toContain('a@example.com')
 expect(s.getCell(5,sku).alignment.wrapText).not.toBe(true);expect(s.getColumn(sku).width).toBeLessThanOrEqual(28)
 expect(s.views[0]).toMatchObject({state:'frozen',xSplit:1,ySplit:4,showGridLines:false});expect(s.pageSetup).toMatchObject({fitToWidth:1,fitToHeight:0,orientation:'landscape',printTitlesRow:'1:4'});expect(s.getImages().length).toBeGreaterThan(0)
})
it('keeps missing values, literal zero totals and orphan rows without joining blank identity groups',async()=>{
 const b=new Workbook(),s=b.addWorksheet('主表'),d=b.addWorksheet('商品明细');s.columns=[{header:'订单',key:'id'},{header:'金额',key:'amount'}];d.columns=[{header:'订单',key:'id'},{header:'SKU',key:'sku'}]
 exportRowIdentity(s.addRow({id:'',amount:null}),'a');exportRowIdentity(s.addRow({id:'',amount:0}),'b');s.addRow({id:'合计',amount:0})
 exportRowIdentity(d.addRow({id:'',sku:'a'}),'a');exportRowIdentity(d.addRow({id:'',sku:'b'}),'b');d.addRow({id:'unresolved',sku:'orphan'})
 await singleSheetWorkbook(b,{main:'主表',details:['商品明细']});const out=b.worksheets[0]
 expect(out.getCell(5,column(out,'金额')).value).toBeNull();expect(cells(out)).toContain(0);expect(cells(out)).toContain('unresolved');expect(cells(out)).toContain('待核查')
})
it('exports an empty result with readable headings and no invented data',async()=>{const b=new Workbook(),s=b.addWorksheet('清单');s.columns=[{header:'订单编号'}];await singleSheetWorkbook(b,{main:'清单',details:[]});expect(cells(b.worksheets[0])).toContain('当前筛选暂无数据')})

it('publishes the HTML brand asset and collapses only supplementary rows while retaining Shopify and warehouse core fields',async()=>{
 const b=new Workbook(),m=b.addWorksheet('订单'),d=b.addWorksheet('商品明细')
 m.columns=['订单编号','Shopify单号','客户','订单金额','审核状态','仓库','业务员','部门','详细地址'].map(header=>({header}))
 m.addRow(['A','#1001','客户',12,'已审核','HangZhou','Alex','业务一部','完整收件地址'])
 d.columns=['订单编号','SKU','数量'].map(header=>({header}));d.addRow(['A','SKU-1',2]);b.addWorksheet('说明').addRow(['来源','本地库'])
 await singleSheetWorkbook(b,{main:'订单',details:['商品明细']})
 const loaded=new Workbook();await loaded.xlsx.load(await b.xlsx.writeBuffer() as any);const s=loaded.worksheets[0]
 expect(column(s,'仓库')).toBeGreaterThan(0);expect(column(s,'Shopify单号')).toBe(2);expect(column(s,'业务员')).toBe(0);expect(column(s,'部门')).toBe(0)
 const addressRows:number[]=[];s.eachRow(r=>{r.eachCell(c=>{if(c.value==='完整收件地址')addressRows.push(r.number)})})
 expect(addressRows.length).toBeGreaterThan(0);for(const n of addressRows){expect(s.getRow(n).hidden).toBe(true);expect(s.getRow(n).outlineLevel).toBe(1)}
 expect(s.getRow(5).hidden).not.toBe(true)
 s.eachRow(r=>{r.eachCell(c=>{if(c.value==='本地库')expect(r.hidden).not.toBe(true)})})
 const logo=s.getImages().find(i=>i.range.tl.nativeRow===1)!;expect(logo).toBeDefined()
 expect(Buffer.from(loaded.getImage(Number(logo.imageId)).buffer!)).toEqual(fs.readFileSync(path.join(__dirname,'assets/hyperzone-logo.png')))
 const nest=JSON.parse(fs.readFileSync(path.join(__dirname,'../../..','nest-cli.json'),'utf8'))
 expect(nest.compilerOptions.assets).toContainEqual({include:'modules/workbench-export/assets/**/*',outDir:'dist/src'})
})

it('centers numeric quantities and frames each document after merging and XLSX roundtrip',async()=>{
 const b=new Workbook(),m=b.addWorksheet('订单'),d=b.addWorksheet('商品明细')
 m.columns=['订单编号','金额'].map(header=>({header}));d.columns=['订单编号','SKU','数量'].map(header=>({header}))
 m.addRow(['A',20]);m.addRow(['B',30]);d.addRow(['A','A1',2]);d.addRow(['A','A2',3]);d.addRow(['B','B1',4])
 await singleSheetWorkbook(b,{main:'订单',details:['商品明细']})
 const loaded=new Workbook();await loaded.xlsx.load(await b.xlsx.writeBuffer() as any);const s=loaded.worksheets[0],q=column(s,'数量')
 expect(s.getCell(5,q).value).toBe(2);expect(s.getCell(5,q).alignment.horizontal).toBe('center');expect(s.getCell(6,q).alignment.horizontal).toBe('center')
 expect(s.getCell(5,q).border.top?.style).toBe('medium');expect(s.getCell(6,q).border.bottom?.style).toBe('medium')
 expect(s.getCell(5,1).border.left?.style).toBe('medium');expect(s.getCell(5,1).border.bottom?.style).toBe('medium')
 expect(s.getCell(5,s.columnCount).border.right?.style).toBe('medium')
 expect(s.getCell(8,q).border.top?.style).toBe('medium');expect(s.getCell(8,q).border.bottom?.style).toBe('medium')
})

it('shows only SKU attributes as product information and groups preserved supplementary fields by business category',async()=>{
 const b=new Workbook(),m=b.addWorksheet('订单'),d=b.addWorksheet('商品明细')
 m.columns=['订单编号','Shopify单号','客户','订单金额','审核状态','仓库','业务员','备注','运费','联系电话'].map(header=>({header}))
 m.addRow(['A','#123','客户',10,'已审核','HangZhou','Alice','仅此订单备注',2,'10086'])
 d.columns=['订单编号','SKU','商品名称','属性','数量'].map(header=>({header}));d.addRow(['A','SKU1','Old English name','颜色：蓝色；尺寸：L',2]);d.addRow(['A','SKU2','Do not fallback',null,1])
 await singleSheetWorkbook(b,{main:'订单',details:['商品明细']})
 const loaded=new Workbook();await loaded.xlsx.load(await b.xlsx.writeBuffer() as any);const s=loaded.worksheets[0]
 expect(column(s,'Shopify单号')).toBe(2);expect(column(s,'业务员')).toBe(0);expect(column(s,'规格')).toBe(0)
 expect(s.getCell(5,column(s,'商品信息')).value).toBe('颜色：蓝色；尺寸：L');expect(s.getCell(6,column(s,'商品信息')).value).toBeNull()
 expect(cells(s)).not.toContain('Old English name');expect(cells(s)).not.toContain('Do not fallback')
 for(const v of ['Alice','仅此订单备注',2,'10086'])expect(cells(s)).toContain(v)
 const captions:string[]=[];s.eachRow(r=>{const v=r.getCell(1).value;if(typeof v==='string'&&v.startsWith('A · '))captions.push(v)})
 expect(captions).toEqual(['A · 订单与归属','A · 金额与支付','A · 收件信息','A · 备注与异常'])
})
