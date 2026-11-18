import { Cell, Row } from 'exceljs'
export type ProductPresentation={sku?:string;isVirtual?:boolean|null;isGift?:boolean|null}
const products=new WeakMap<Row,ProductPresentation>()
export function exportProductRow(row:Row,product:ProductPresentation){products.set(row,product);return row}
export function productKind(row:Row,sku:string){
 const p=products.get(row)
 return p?.isVirtual===true||sku.trim()==='HZ000020-001'?'虚拟品':p?.isGift===true?'赠品':'商品'
}
export const productRank=(kind:string)=>kind==='虚拟品'?2:kind==='赠品'?1:0
export const palette={ink:'FF243C50',navy:'FF173B55',teal:'FF187E84',line:'FFDCE5ED',muted:'FF657889',tint:'FFF1F6FA',white:'FFFFFFFF'}
export function styleCell(cell:Cell,header=false){
 cell.font={name:'Microsoft YaHei',size:10,bold:header,color:{argb:header?palette.white:palette.ink}}
 cell.alignment={vertical:'middle',horizontal:header?'center':typeof cell.value==='number'?'right':'left',wrapText:false}
 cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:header?palette.navy:palette.white}}
 cell.border={bottom:{style:'hair',color:{argb:palette.line}}}
 cell.numFmt=typeof cell.value==='number'?(Number.isInteger(cell.value)?'#,##0':'#,##0.########'):'@'
}
export function columnWidth(header:string,values:string[]){
 const measure=(s:string)=>Math.max(...s.split('\n').map(line=>[...line].reduce((n,c)=>n+(/[\u2e80-\uffff]/.test(c)?2:1),0)),0)
 const bound=/商品信息|规格/.test(header)?[22,36]:/图片/.test(header)?[10,10]:/数量|件数|种数/.test(header)?[10,14]:/金额|运费|税费/.test(header)?[14,18]:/状态|分类/.test(header)?[12,16]:/仓库/.test(header)?[12,14]:/渠道|跟踪|物流/.test(header)?[22,28]:/编号|单号|SKU/.test(header)?[22,28]:[16,24]
 return Math.min(bound[1],Math.max(bound[0],measure(header)+2,...values.slice(0,200).map(v=>measure(v)+2)))
}
