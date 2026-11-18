import { exportStatusName } from './status-names'
import { embedProductThumbnails } from './thumbnails'
import { columnWidth, palette, productKind, productRank, styleCell } from './presentation'
import { Workbook, Row, Worksheet, CellValue, PaperSize } from 'exceljs'
import { join } from 'node:path'
export { exportProductRow } from './presentation'
const identities=new WeakMap<Row,string>()
/** Explicit instance identity prevents different RMA cases on one order sharing children. */
export function exportRowIdentity(row:Row,id:string){identities.set(row,id);return row}
type Options={main:string;details:string[];name?:string;title?:string}
type Field={header:string;index:number;key:string}
type Entry={header:string;value:CellValue;format?:string}
const quantityField=(header:string)=>/数量|件数|种数/.test(header)
const alias:Record<string,string>={名称:'商品信息',商品:'商品信息',商品名称:'商品信息',属性:'规格',订单号:'订单编号',图片:'商品图片',商品图片链接:'商品图片'}
const fields=(sheet:Worksheet):Field[]=>sheet.columns.map((c,i)=>({header:alias[sheet.getRow(1).getCell(i+1).text]??sheet.getRow(1).getCell(i+1).text,index:i+1,key:c.key??''}))
const key=(row:Row)=>identities.get(row)??row.getCell(1).text
const totalRow=(row:Row)=>/^(合计|汇总|订单金额合计|金额合计|已知金额合计)/.test(row.getCell(1).text)
const entries=(row:Row,fs:Field[]):Entry[]=>fs.map(f=>({header:f.header,value:row.getCell(f.index).value===''?null:exportStatusName(f.header,row.getCell(f.index).value),format:row.getCell(f.index).numFmt}))
const value=(row:Row,fs:Field[],header:string)=>{const f=fs.find(f=>f.header===(header==='商品信息'?'规格':header));const v=f?exportStatusName(header,row.getCell(f.index).value):null;return v===''?null:v}
const text=(v:CellValue)=>v==null?'':typeof v==='object'?'text' in v?String(v.text):v instanceof Date?v.toISOString():'':String(v)
/** One readable page width, with all secondary fields retained below their document. */
export async function singleSheetWorkbook(book:Workbook,options:Options){
 const main=book.getWorksheet(options.main)
 if(!main)throw Error('Export main worksheet missing')
 const details=options.details.map(n=>book.getWorksheet(n)).filter((s):s is Worksheet=>!!s)
 const mainFields=fields(main),detailFields=new Map(details.map(s=>[s,fields(s)]))
 const mainRows:Row[]=[];main.eachRow((r,n)=>{if(n>1)mainRows.push(r)})
 const mainCandidates=mainFields.filter(f=>f.key!=='products'&&f.header!=='商品信息')
 const priorities=[/Shopify.*单号/i,/客户名称|^客户$|供应商/, /订单.*金额|^金额$/, /履约状态|单据状态|审核状态|采购单状态|出库状态/, /物流渠道|实际物流|物流信息/, /仓库/]
 const coreMain:Field[]=[]
 if(mainCandidates[0])coreMain.push(mainCandidates[0])
 for(const pattern of priorities){const f=mainCandidates.find(f=>!coreMain.includes(f)&&pattern.test(f.header));if(f&&coreMain.length<7)coreMain.push(f)}
 for(const f of mainCandidates)if(coreMain.length<Math.min(4,mainCandidates.length)&&!coreMain.includes(f)&&!/业务员|部门/.test(f.header))coreMain.push(f)
 const detailHeaders=[...new Set([...detailFields.values()].flatMap(fs=>fs.slice(1).map(f=>f.header)))]
 const coreDetail=['商品图片','SKU','商品信息',detailHeaders.find(h=>/^(数量|订单商品数量|采购数量)$/.test(h))??'数量','商品采购状态'].filter(h=>detailHeaders.includes(h)||h==='商品信息'&&detailHeaders.includes('规格'))
 const hasProducts=details.length>0
 const headers=[...coreMain.map(f=>f.header),...(hasProducts?['明细类型',...coreDetail]:[])]
 while(headers.length<8)headers.push('')
 const output=book.addWorksheet('_export_single',{views:[{state:'frozen',xSplit:1,ySplit:4,showGridLines:false,zoomScale:85}],properties:{defaultRowHeight:26,outlineLevelRow:1,tabColor:{argb:palette.navy},outlineProperties:{summaryBelow:false,summaryRight:false}}})
 const width=headers.length
 headers.forEach((h,i)=>{const samples=mainRows.slice(0,200).map(r=>text(value(r,mainFields,h)));for(const sheet of details){const fs=detailFields.get(sheet)!;for(let n=2;n<=Math.min(sheet.rowCount,201);n++)samples.push(text(value(sheet.getRow(n),fs,h)))}output.getColumn(i+1).width=columnWidth(h,samples);output.getColumn(i+1).numFmt='@'})
 const fillRow=(r:Row,shade=palette.white)=>{for(let c=1;c<=width;c++){styleCell(r.getCell(c));r.getCell(c).fill={type:'pattern',pattern:'solid',fgColor:{argb:shade}}}}
 output.getRow(1).height=9
 // The full HTML brand wordmark is white; use the continuous dark title band.
 for(let c=1;c<=width;c++)output.getCell(2,c).fill={type:'pattern',pattern:'solid',fgColor:{argb:palette.navy}}
 output.getColumn(1).width=Math.max(output.getColumn(1).width??0,30)
 output.mergeCells(2,2,2,width);output.getCell(2,2).value=options.title??options.name??(options.main==='已采集订单'?'待办清单':options.main);output.getCell(2,2).font={name:'Microsoft YaHei',size:16,bold:true,color:{argb:palette.white}};output.getCell(2,2).alignment={vertical:'middle'};output.getRow(2).height=52
 // PNG is a proportional rasterization of the shared HTML SVG, not a redesigned logo.
 const logo=join(__dirname,'assets/hyperzone-logo.png')
 const logoId=book.addImage({filename:logo,extension:'png'});output.addImage(logoId,{tl:{col:0.07,row:1.16},ext:{width:190,height:43.7},editAs:'oneCell'})
 output.mergeCells(3,1,3,width);output.getCell(3,1).value=`HyperZone  ·  ${mainRows.filter(r=>!totalRow(r)).length} 笔单据  ·  导出 ${new Date(Date.now()+8*3600_000).toISOString().slice(0,19).replace('T',' ')} UTC+8  ·  补充信息默认收起，可用左侧＋展开；长文本可选中查看`;output.getCell(3,1).font={name:'Microsoft YaHei',size:9,color:{argb:palette.muted}};output.getRow(3).height=24
 headers.forEach((h,i)=>{const c=output.getRow(4).getCell(i+1);c.value=h;styleCell(c,true);c.alignment={vertical:'middle',horizontal:'center',wrapText:true}});output.getRow(4).height=32
 // Reserve the empty-result row before notes/totals create their own merged cells.
 const hasData=mainRows.some(r=>!totalRow(r))||details.some(sheet=>{let found=false;sheet.eachRow((r,n)=>{if(n>1&&!totalRow(r))found=true});return found})
 if(!hasData){const empty=output.addRow(['当前筛选暂无数据']);output.mergeCells(empty.number,1,empty.number,width);empty.height=36;empty.getCell(1).alignment={vertical:'middle',horizontal:'center'}}
 const pairs=(list:Entry[],label:string,collapsed=false,classified=false)=>{
  if(collapsed&&!classified){
   const categories=[['订单与归属',/业务员|部门|店铺|客户名称|^客户$|单号|编号|备货类型/],['金额与支付',/金额|币种|运费|税费|优惠|付款状态|支付状态/],['状态与进度',/状态|阶段|进度|取消|数量|种数|件数/],['业务时间',/时间|日期/],['收件信息',/收件|电话|邮箱|邮编|地址|国家|城市|州|省/],['物流信息',/物流|渠道|仓库|包裹|跟踪/],['备注与异常',/备注|原因|异常/]] as const
   const grouped=new Map<string,Entry[]>()
   for(const entry of list){const category=categories.find(([,pattern])=>pattern.test(entry.header))?.[0]??'其他信息';grouped.set(category,[...(grouped.get(category)??[]),entry])}
   for(const category of [...categories.map(([name])=>name),'其他信息']){const values=grouped.get(category);if(values?.length)pairs(values,`${label} · ${category}`,true,true)}
   return
  }
  if(!list.length)return
  if(label.includes(' · ')){const caption=output.addRow([label]);output.mergeCells(caption.number,1,caption.number,width);caption.height=21;caption.hidden=collapsed;caption.outlineLevel=collapsed?1:0;caption.getCell(1).font={name:'Microsoft YaHei',size:9,color:{argb:palette.teal}}}
  const groups=width>=9?3:2,span=Math.floor(width/groups)
  for(let i=0;i<list.length;i+=groups){const r=output.addRow([]);r.height=27;fillRow(r,palette.tint);r.outlineLevel=collapsed?1:0;r.hidden=collapsed
   list.slice(i,i+groups).forEach((e,j)=>{const start=j*span+1,end=j===groups-1?width:(j+1)*span;const c=r.getCell(start);c.value=e.header;c.font={name:'Microsoft YaHei',size:9,color:{argb:palette.muted}};c.alignment={vertical:'middle',wrapText:true};output.mergeCells(r.number,start+1,r.number,end);const v=r.getCell(start+1);v.value=e.value;styleCell(v);if(quantityField(e.header))v.alignment={...v.alignment,horizontal:'center'};v.fill={type:'pattern',pattern:'solid',fgColor:{argb:palette.tint}};if(e.format&&e.format!=='General'&&e.format!=='@')v.numFmt=e.format;v.note=label})
  }
 }
 const groups=new Map<Worksheet,Map<string,Row[]>>(),used=new Set<Row>()
 for(const s of details){const map=new Map<string,Row[]>();s.eachRow((r,n)=>{if(n>1){const rs=map.get(key(r))??[];rs.push(r);map.set(key(r),rs)}});groups.set(s,map)}
 let orderIndex=0
 const append=(parent:Row|undefined,children:{sheet:Worksheet;row:Row}[],orphan=false)=>{
  const first=output.rowCount+1,shade=orderIndex++%2? 'FFF8FAFC':palette.white
  children=children.map((c,i)=>({...c,i})).sort((a,b)=>{if(a.sheet!==b.sheet)return details.indexOf(a.sheet)-details.indexOf(b.sheet);const fs=detailFields.get(a.sheet)!;return productRank(productKind(a.row,text(value(a.row,fs,'SKU'))))-productRank(productKind(b.row,text(value(b.row,fs,'SKU'))))||a.i-b.i})
  for(let i=0;i<Math.max(1,children.length);i++){const child=children[i],r=output.addRow([]);fillRow(r,shade);r.height=38
   if(i===0&&parent)coreMain.forEach((f,c)=>{const cell=r.getCell(c+1);cell.value=parent.getCell(f.index).value===''?null:exportStatusName(f.header,parent.getCell(f.index).value);cell.font={...cell.font,bold:c===0,color:{argb:c===0?palette.teal:palette.ink}};cell.alignment={...cell.alignment,wrapText:/物流|渠道|状态/.test(f.header),...(quantityField(f.header)?{horizontal:'center' as const}:{})};if(typeof cell.value==='number')cell.numFmt=/金额/.test(f.header)?'#,##0.00':'#,##0.########'})
   if(child){const fs=detailFields.get(child.sheet)!;const category=productKind(child.row,text(value(child.row,fs,'SKU')));r.getCell(coreMain.length+1).value=orphan?'待核查':child.sheet.name==='商品明细'?category:child.sheet.name
    coreDetail.forEach((h,c)=>{const cell=r.getCell(coreMain.length+c+2);cell.value=value(child.row,fs,h);styleCell(cell);if(quantityField(h))cell.alignment={...cell.alignment,horizontal:'center'};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:shade}}});used.add(child.row)
   }
  }
  const last=output.rowCount
  if(parent&&last>first)coreMain.forEach((_,c)=>output.mergeCells(first,c+1,last,c+1))
  // Frame the visible document block, including merged parent cells, independently
  // of the optional collapsed supplementary rows.
  const edge={style:'medium' as const,color:{argb:'FF8DA8BB'}}
  for(let n=first;n<=last;n++)for(let c=1;c<=width;c++){
   const cell=output.getCell(n,c)
   cell.style={...cell.style,border:{...cell.border,...(n===first?{top:edge}:{}),...(n===last?{bottom:edge}:{}),...(c===1?{left:edge}:{}),...(c===width?{right:edge}:{})}}
  }
  if(parent)coreMain.forEach((_,c)=>{const cell=output.getCell(first,c+1);cell.border={...cell.border,top:edge,bottom:edge,...(c===coreMain.length-1?{right:{style:'thin',color:{argb:palette.line}}}:{})}})
  if(parent){const currencyField=mainFields.find(f=>/^(结算币种|币种)$/.test(f.header));const currency=currencyField?parent.getCell(currencyField.index).text:'';if(/^[A-Z]{3}$/.test(currency))coreMain.forEach((f,c)=>{if(/金额/.test(f.header)&&typeof output.getCell(first,c+1).value==='number')output.getCell(first,c+1).numFmt=`"${currency}" #,##0.00`})}
  if(parent)pairs(entries(parent,(children.length?mainCandidates:mainFields).filter(f=>!coreMain.includes(f))),parent.getCell(1).text,true)
  for(const child of children){const fs=detailFields.get(child.sheet)!;pairs(entries(child.row,fs.filter((f,i)=>!coreDetail.includes(f.header)&&f.header!=='规格'&&!(i===0&&parent)&&!(parent&&coreMain.some(m=>m.header===f.header&&text(parent.getCell(m.index).value)===text(child.row.getCell(f.index).value))))),`${child.sheet.name} · ${text(value(child.row,fs,'SKU'))||child.row.getCell(1).text}`,true)}
  const supplementEnd=output.rowCount
  for(let n=last+1;n<=supplementEnd;n++){const left=output.getCell(n,1),right=output.getCell(n,width);left.style={...left.style,border:{...left.border,left:edge}};right.style={...right.style,border:{...right.border,right:edge}}}
  if(supplementEnd>last)for(let c=1;c<=width;c++){const cell=output.getCell(supplementEnd,c);cell.style={...cell.style,border:{...cell.border,bottom:edge}}}
  const spacer=output.addRow([]);spacer.height=9
 }
 for(const parent of mainRows){if(totalRow(parent)){pairs(entries(parent,mainFields).filter(e=>e.value!==null&&e.value!==undefined&&e.value!==''),'汇总');continue}const children=details.flatMap(sheet=>(groups.get(sheet)!.get(key(parent))??[]).filter(row=>!used.has(row)).map(row=>({sheet,row})));append(parent,children)}
 for(const sheet of details)sheet.eachRow((row,n)=>{if(n>1&&!used.has(row)){if(totalRow(row))pairs(entries(row,detailFields.get(sheet)!),'明细汇总');else append(undefined,[{sheet,row}],true)}})
 for(const sheet of book.worksheets.filter(s=>s!==output&&s!==main&&!details.includes(s))){const list:Entry[]=[];sheet.eachRow(r=>{if(r.getCell(1).text==='项目'&&r.getCell(2).text==='内容')return;list.push({header:r.getCell(1).text,value:r.getCell(2).value})});pairs(list,'导出说明')}
 for(const sheet of [...book.worksheets])if(sheet!==output)book.removeWorksheet(sheet.id)
 output.name=options.name??'待办清单';book.creator='HyperZone'
 await embedProductThumbnails(book,output,4)
 output.pageSetup={orientation:'landscape',paperSize:8 as PaperSize,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:4',printArea:`A1:${output.getColumn(width).letter}${output.rowCount}`,margins:{left:.25,right:.25,top:.3,bottom:.3,header:.1,footer:.15}}
 output.headerFooter.oddFooter='&LHyperZone&C第 &P 页 / 共 &N 页&R待办清单'
}
/** Preserve recipient fields when available; missing source fields remain blank. */
export function appendExportRecipients(sheet:Worksheet,orders:readonly any[]){
 const columns=[['收件人','name'],['联系电话','phone'],['电子邮箱','email'],['州／省','state'],['城市','city'],['邮编','postalCode'],['详细地址','address']] as const
 const start=sheet.columnCount
 columns.forEach(([header],i)=>{sheet.getColumn(start+i+1).width=header==='详细地址'?48:24;sheet.getRow(1).getCell(start+i+1).value=header})
 orders.forEach((order,index)=>{const r=order.shippingRecipient;columns.forEach(([,key],i)=>{sheet.getRow(index+2).getCell(start+i+1).value=key==='address'?[r?.addressLine1,r?.addressLine2].filter(Boolean).join(', '):r?.[key]??null})})
}
