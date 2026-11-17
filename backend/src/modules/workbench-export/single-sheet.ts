import { exportStatusName } from './status-names'
import { embedProductThumbnails } from './thumbnails'
import { Workbook, Row, Worksheet, CellValue } from 'exceljs'
const identities=new WeakMap<Row,string>()
/** Explicit instance identity prevents different RMA cases on one order sharing children. */
export function exportRowIdentity(row:Row,id:string){identities.set(row,id)}
type Options={main:string;details:string[];name?:string}
export async function singleSheetWorkbook(book:Workbook,options:Options){
 const main=book.getWorksheet(options.main)!
 if(!main)throw Error('Export main worksheet missing')
 const details=options.details.map(name=>book.getWorksheet(name)).filter((s):s is Worksheet=>!!s)
 const source=[main,...details],headers:string[]=[],maps=new Map<Worksheet,number[]>()
 for(const s of source){const map:number[]=[];s.columns.forEach((column,i)=>{const original=s.getRow(1).getCell(i+1).text;const header=({名称:'商品信息',商品:'商品信息',商品名称:'商品信息',属性:'规格',订单号:'订单编号',图片:'商品图片',商品图片链接:'商品图片'} as Record<string,string>)[original]??original;let at=headers.indexOf(header);if(at<0){at=headers.length;headers.push(header)}map.push(at+2)});maps.set(s,map)}
 const output=book.addWorksheet('_export_single',{views:[{state:'frozen',xSplit:2,ySplit:1}],properties:{outlineLevelRow:1,outlineProperties:{summaryBelow:false,summaryRight:false}}})
 output.columns=[{header:'行类型',width:12},...headers.map(header=>({header,width:/地址|原因|商品信息|商品名称|名称/.test(header)?38:/金额|数量|币种/.test(header)?16:24}))]
 const style=(row:Row,kind:string)=>{row.outlineLevel=kind==='主行'||kind==='汇总'||kind==='说明'||kind==='待核查'?0:1;row.hidden=false;row.height=kind==='主行'?42:32;row.eachCell({includeEmpty:true},cell=>{cell.font={name:'Microsoft YaHei',size:10,bold:kind==='主行'||kind==='汇总',color:{argb:'FF243C50'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:kind==='主行'?'FFEAF2FA':'FFFFFFFF'}};cell.alignment={vertical:'middle',wrapText:true};cell.numFmt=typeof cell.value==='number'?'#,##0.00########':'@';if(row.outlineLevel&&headers[Number(cell.col)-2]==='商品信息')cell.alignment={...cell.alignment,indent:1}})}
 const append=(s:Worksheet,row:Row,kind:string)=>{const values:CellValue[]=[kind];const map=maps.get(s)!;row.eachCell({includeEmpty:true},(cell,col)=>{if(map[col-1])values[map[col-1]-1]=kind==='主行'&&s.getColumn(col).key==='products'?'展开商品明细':exportStatusName(s.getRow(1).getCell(col).text,cell.value)});const target=output.addRow(values);style(target,kind);target.height=Math.min(409,Math.max(target.height??32,...Array.from(values,(v,i)=>Math.ceil(String(v??'').length/Math.max(8,(output.getColumn(i+1).width??24)/1.5))*15+10)));return target}
 const key=(row:Row)=>identities.get(row)??row.getCell(1).text
 const groups=new Map<Worksheet,Map<string,Row[]>>(),used=new Set<Row>()
 for(const sheet of details){const index=new Map<string,Row[]>();sheet.eachRow((row,n)=>{if(n>1){const id=key(row);const rows=index.get(id)??[];rows.push(row);index.set(id,rows)}});groups.set(sheet,index)}
 main.eachRow((row,n)=>{if(n===1)return;const id=key(row);append(main,row,/合计|汇总/.test(row.getCell(1).text)?'汇总':'主行');for(const sheet of details)for(const child of groups.get(sheet)!.get(id)??[]){if(used.has(child))continue;append(sheet,child,sheet.name==='商品明细'?'商品':sheet.name);used.add(child)}})
 // Keep totals and unassociated source records visible; never silently discard them.
 for(const sheet of details)sheet.eachRow((row,n)=>{if(n>1&&!used.has(row))append(sheet,row,/合计|汇总/.test(row.getCell(1).text)?'汇总':'待核查')})
 for(const sheet of book.worksheets.filter(s=>s!==output&&!source.includes(s))){output.addRow([]);sheet.eachRow(row=>{const r=output.addRow(['说明',...Array.from({length:row.cellCount},(_,i)=>row.getCell(i+1).value)]);style(r,'说明')})}
 const hint=output.addRow(['说明','明细展开／收起','使用左侧 1／2 层级按钮或 ＋／－；默认展开。金额仅在订单主行展示，缺失值留空。']);style(hint,'说明');hint.height=60
 output.getRow(1).height=32;output.getRow(1).eachCell(cell=>{cell.font={name:'Microsoft YaHei',size:10,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF173B55'}};cell.alignment={vertical:'middle',wrapText:true}})
 output.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1'}
 for(const sheet of [...book.worksheets])if(sheet!==output)book.removeWorksheet(sheet.id)
 output.name=options.name??'待办清单';book.creator='HyperZone'
 await embedProductThumbnails(book,output)
}

/** Preserve recipient fields when available; missing source fields remain blank. */
export function appendExportRecipients(sheet:Worksheet,orders:readonly any[]){
 const columns=[['收件人','name'],['联系电话','phone'],['电子邮箱','email'],['州／省','state'],['城市','city'],['邮编','postalCode'],['详细地址','address']] as const
 const start=sheet.columnCount
 columns.forEach(([header],i)=>{sheet.getColumn(start+i+1).width=header==='详细地址'?48:24;sheet.getRow(1).getCell(start+i+1).value=header})
 orders.forEach((order,index)=>{const r=order.shippingRecipient;columns.forEach(([,key],i)=>{sheet.getRow(index+2).getCell(start+i+1).value=key==='address'?[r?.addressLine1,r?.addressLine2].filter(Boolean).join(', '):r?.[key]??null})})
}
