import type { OrderProgress } from '@/api/order-progress'
export const documentNames:Record<string,string>={hzkj_orders:'履约订单',hzkj_stock_order_new:'备货订单',hzkj_purapplybill:'采购申请单',hzkj_purorderbill:'采购订单',hzkj_alloc_bill:'配货单',hzkj_deliver_bill:'发运单',hzkj_deliver_order:'发货通知单',im_saloutbill:'出库单',hzkj_receiptnotice:'收货通知单',hzkj_receive_bill:'收款单',hzkj_after_sale_orders:'RMA售后单',purchase_material_return:'采购退料单'}
export const progressStatus=(status:string|null)=>status?({A:'暂存',B:'已提交',C:'已审核'}[status]??status):''
/** Longest-path layers for a DAG; cycles are bounded and unknown endpoints are omitted. */
export function progressLayout(graph:NonNullable<OrderProgress['graph']>){
 const ids=new Set(graph.documents.map(d=>d.id)),depth=new Map(graph.documents.map(d=>[d.id,0]))
 const edges=[...new Map(graph.relations.filter(e=>ids.has(e.fromDocumentId)&&ids.has(e.toDocumentId)&&e.fromDocumentId!==e.toDocumentId).map(e=>[e.fromDocumentId+'>'+e.toDocumentId,e])).values()]
 const pending=new Map(graph.documents.map(d=>[d.id,edges.filter(e=>e.toDocumentId===d.id).length]));const ready=graph.documents.filter(d=>!pending.get(d.id)).map(d=>d.id)
 while(ready.length){const id=ready.shift()!;for(const e of edges.filter(e=>e.fromDocumentId===id)){depth.set(e.toDocumentId,Math.max(depth.get(e.toDocumentId)!,depth.get(id)!+1));pending.set(e.toDocumentId,pending.get(e.toDocumentId)!-1);if(!pending.get(e.toDocumentId))ready.push(e.toDocumentId)}}
 const used=new Map<number,number>();const nodes=graph.documents.map(d=>{const level=depth.get(d.id)!;const row=used.get(level)??0;used.set(level,row+1);return {...d,x:24+level*270,y:24+row*140}})
 const byId=new Map(nodes.map(n=>[n.id,n]));return {nodes,width:Math.max(720,...nodes.map(n=>n.x+250)),height:Math.max(310,...nodes.map(n=>n.y+132)),edges:edges.map(e=>{const a=byId.get(e.fromDocumentId)!,b=byId.get(e.toDocumentId)!;return {...e,path:`M ${a.x+220} ${a.y+52} C ${a.x+245} ${a.y+52}, ${b.x-25} ${b.y+52}, ${b.x} ${b.y+52}`}})}
}
