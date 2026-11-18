import { Workbook, Worksheet } from 'exceljs'
import { SourcingImageResolverService } from '../sourcing/sourcing-image-resolver.service'
/** Bounded, de-duplicated image downloads. Original URLs survive every failure. */
export async function embedProductThumbnails(book:Workbook,sheet:Worksheet,headerRow=1){
 const columns:number[]=[]
 sheet.getRow(headerRow).eachCell((c,n)=>{if(c.text==='商品图片')columns.push(n)})
 if(!columns.length)return
 const cells=new Map<string,Array<{row:number;col:number}>>()
 sheet.eachRow((row,n)=>{if(n<=headerRow||['说明','汇总'].includes(String(row.getCell(1).value??'')))return;for(const col of columns){const cell=row.getCell(col);if(cell.isMerged)continue;const url=typeof cell.value==='string'?cell.value.trim():'';if(!/^https?:\/\//i.test(url))continue;const list=cells.get(url)??[];list.push({row:n,col});cells.set(url,list);row.getCell(col).value={text:'查看原图',hyperlink:url};row.getCell(col).alignment={vertical:'bottom',horizontal:'center'};}})
 if(!cells.size)return
 columns.forEach(col=>sheet.getColumn(col).width=10)
 const resolver=new SourcingImageResolverService(),deadline=Date.now()+20000,entries=[...cells],images=new Map<string,number>();let next=0
 await Promise.all(Array.from({length:4},async()=>{while(next<Math.min(entries.length,500)&&Date.now()<deadline){const [url]=entries[next++];try{const bytes=await resolver.resolveExportThumbnail(url);images.set(url,book.addImage({buffer:bytes as any,extension:'png'}))}catch{/* Keep original hyperlink when unavailable or unsupported. */}}}))
 let embedded=0,total=0
 for(const [url,positions]of cells){const id=images.get(url);for(const {row,col}of positions){total++;if(id===undefined)continue;sheet.getRow(row).height=Math.max(sheet.getRow(row).height??0,62);sheet.addImage(id,{tl:{col:col-1+0.1,row:row-1+0.03},ext:{width:52,height:52},editAs:'oneCell'});embedded++}}
 const note=sheet.addRow([`商品图片：已嵌入 ${embedded} 张；${total-embedded} 张保留原图链接。`]);sheet.mergeCells(note.number,1,note.number,sheet.columnCount);note.height=24;note.getCell(1).font={name:'Microsoft YaHei',size:9,color:{argb:'FF657889'}}
}
