import { Workbook, Worksheet } from 'exceljs'
import { SourcingImageResolverService } from '../sourcing/sourcing-image-resolver.service'
/** Bounded, de-duplicated image downloads. Original URLs survive every failure. */
export async function embedProductThumbnails(book:Workbook,sheet:Worksheet){
 const columns:number[]=[]
 sheet.getRow(1).eachCell((c,n)=>{if(c.text==='商品图片')columns.push(n)})
 if(!columns.length)return
 const cells=new Map<string,Array<{row:number;col:number}>>()
 sheet.eachRow((row,n)=>{if(n===1||['说明','汇总'].includes(row.getCell(1).text))return;for(const col of columns){const url=row.getCell(col).text.trim();if(!/^https?:\/\//i.test(url))continue;const list=cells.get(url)??[];list.push({row:n,col});cells.set(url,list);row.getCell(col).value={text:'查看原图',hyperlink:url};row.getCell(col).alignment={vertical:'bottom',horizontal:'center'};}})
 if(!cells.size)return
 columns.forEach(col=>sheet.getColumn(col).width=16)
 const resolver=new SourcingImageResolverService(),deadline=Date.now()+20000,entries=[...cells],images=new Map<string,number>();let next=0
 await Promise.all(Array.from({length:4},async()=>{while(next<Math.min(entries.length,500)&&Date.now()<deadline){const [url]=entries[next++];try{const bytes=await resolver.resolveExportThumbnail(url);images.set(url,book.addImage({buffer:bytes as any,extension:'png'}))}catch{/* Keep original hyperlink when unavailable or unsupported. */}}}))
 let embedded=0,total=0
 for(const [url,positions]of cells){const id=images.get(url);for(const {row,col}of positions){total++;if(id===undefined)continue;sheet.getRow(row).height=Math.max(sheet.getRow(row).height??0,78);sheet.addImage(id,{tl:{col:col-1+0.1,row:row-1+0.03},ext:{width:80,height:80},editAs:'oneCell'});embedded++}}
 const note=sheet.addRow(['说明','商品图片',`已嵌入 ${embedded} 张缩略图；${total-embedded} 张保留原图链接。`]);note.height=32
}
