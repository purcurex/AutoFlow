import { readApiRelations } from './collected-api-relations'
import { readConsumedStockChains } from './order-progress-stock'
import { NotFoundException, ConflictException } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { collectedDispatchTaskSql } from './collected-dispatch-status'
import { collectedWhere } from './collected-workbench-query'
import { collectedStockWhere } from './collected-stock-query'
import { readCollectedChain } from './collected-chain-query'
import { collectedInboundQuery } from './collected-inbound-query'
import { collectedRmaWhere } from './collected-rma-query'
import { collectedMaterialReturnsQuery } from './collected-material-returns'
type Row=Record<string,any>
const queues=[['sales','unpaid','待支付清单'],['sales','review','待审核清单'],['sales','review','已审核清单',true],['sales','exceptions','异常订单清单'],['dispatch','dispatch','待履约清单'],['dispatch','dispatch','已履约清单',true],['procurement','procurement','待采购清单'],['procurement','procurement_shipping','已采购待发货'],['procurement','procurement','采购完成清单',true],['allocation','allocation','未齐套清单'],['allocation','allocation_review','已齐套未审核'],['warehouse','shipping','待出库清单'],['warehouse','shipping','已出库清单',true]] as const
/** Exact number lookup, current local ownership, no upstream calls or sibling orders. */
export async function readOrderProgress(db:Pick<DataSource,'query'>,batch:Row,employees:readonly string[]|null,number:string,roles:readonly string[]){
 const roots=await db.query(`SELECT 'fulfillment' kind,source_id,order_number number,display,raw_bill_status status,raw_order_status order_status FROM hz_fop_collected_orders WHERE batch_id=$1 AND order_number=$2 AND ($3::text[] IS NULL OR owner_employee_id=ANY($3))
 UNION ALL SELECT 'stock',source_id,display->>'stockNumber',display,raw->>'billstatus',raw->>'hzkj_orderstatus' FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='stock_orders' AND display->>'stockNumber'=$2 AND ($3::text[] IS NULL OR owner_employee_id=ANY($3))`,[batch.id,number,employees])
 if(!roots.length)throw new NotFoundException('未找到该订单，请检查单号及数据权限')
 if(roots.length!==1)throw new ConflictException('订单编号存在重复，请核查来源数据')
 const root=roots[0],memberships:Row[]=[],supplement:Row[]=[]
 let conclusions={fulfillment:'不适用',allocation:'不适用'}
 // One small exact-root statement per predicate: list filters remain the sole business definition.
 const add=(role:string,queue:string,name:string,completed=false)=>memberships.push({role,queue:completed?'completed':queue,name,accessible:roles.includes(role),...(queue==='unpaid'?{skuAssociation:root.order_status==='no'?'unlinked':'linked'}:{})})
 if(root.kind==='fulfillment'){
  const facts=await db.query(`SELECT ${collectedDispatchTaskSql} task FROM hz_fop_collected_orders WHERE batch_id=$1 AND source_id=$2`,[batch.id,root.source_id])
  const allocations=await db.query(`SELECT display FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='allocation' AND display->>'sourceOrderId'=$2 AND display->>'rawAllocationStatus' IS DISTINCT FROM 'voided'`,[batch.id,root.source_id])
  conclusions=progressConclusions(root,facts[0]?.task,allocations.map((r:Row)=>r.display))
  const checks=await Promise.all(queues.map(async ([role,queue,name,...rest])=>{
   const q=collectedWhere(batch.id,employees,{queue,skuAssociation:root.order_status==='no'?'unlinked':'linked',completed:rest[0]??false,timeRange:'all',mode:'selected',orderIds:[root.source_id]})
   const rows=await db.query(`SELECT 1 FROM hz_fop_collected_orders WHERE ${q.where} LIMIT 1`,q.params)
   return rows.length?{role,queue,name,completed:rest[0]??false}:null
  }))
  for(const match of checks)if(match)add(match.role,match.queue,match.name,match.completed)
  const rma=collectedRmaWhere(batch.id,employees,{rmaFlowStatus:'all'})
  const cases=await db.query(`SELECT source_id,display FROM hz_fop_collected_entities WHERE ${rma.where} AND display->>'sourceOrderId'=$${rma.params.length+1}`,[...rma.params,root.source_id])
  if(cases.some((r:Row)=>r.display.rmaCases?.some((c:Row)=>c.isOpen===true)))add('sales','rma','RMA售后清单')
  for(const r of cases)for(const c of r.display.rmaCases??[])supplement.push({id:'rma:'+r.source_id,entity:'hzkj_after_sale_orders',sourceId:r.source_id,number:c.number,billStatus:null,businessStatus:c.stage,capturedAt:null})
  const inbound=collectedInboundQuery(batch.id,employees,{mode:'selected',orderIds:[root.source_id]})
  if((await db.query(`${inbound.cte} SELECT 1 ${inbound.from} LIMIT 1`,inbound.params)).length)add('warehouse','receipt_notices','待入库清单')
  const returns=collectedMaterialReturnsQuery(batch.id,employees,{mode:'selected',orderIds:[root.source_id]})
  const returned=await db.query(`${returns.cte} SELECT documents FROM matched`,returns.params)
  if(returned.length){add('procurement','purchase_returns','采购退货清单');add('warehouse','purchase_returns','采购退货清单')}
  for(const row of returned)for(const d of row.documents)supplement.push({id:'return:'+d.id,entity:'purchase_material_return',sourceId:d.id,number:d.number,billStatus:d.rawBillStatus??null,businessStatus:({pending:'待退货',processing:'退货中',completed:'已完成',cancelled:'已取消'} as Row)[d.status]??null,capturedAt:null})
 }else{
  add('sales','stock','备货清单')
  const q=collectedStockWhere(batch.id,employees,{queue:'procurement',timeRange:'all',mode:'selected',orderIds:[root.source_id]})
  if((await db.query(`SELECT 1 FROM hz_fop_collected_entities WHERE ${q.where} LIMIT 1`,q.params)).length)add('procurement','stock_procurement','备货待采购清单')
 }
 let graph:Row|null=null
 try{graph=await readCollectedChain(db,batch,employees,root.source_id,root.kind)}catch(e){
  // Unbuilt/stale graph is independent of the exact-root list lookup. Never serve stale edges.
  if(![404,409,503].includes((e as any)?.getStatus?.()))throw e
 }
 const apiGraph=await readApiRelations(db,batch.id,root)
 if(apiGraph&&(apiGraph.complete||!graph))graph=apiGraph
 if(graph&&!apiGraph?.complete){
  const purchases=graph.documents.filter((d:Row)=>d.entity==='hzkj_purorderbill')
  if(purchases.length){
   const rows=await db.query(`SELECT source_id,raw FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='purchase' AND source_id=ANY($2::text[])`,[batch.id,purchases.map((d:Row)=>d.sourceId)])
   graph.relations.push(...purchaseApplicationEdges(graph,rows,root.number))
  }
 }
 if(graph&&!apiGraph?.complete)for(const node of supplement){
  if(!graph.documents.some((d:Row)=>d.id===node.id||(d.sourceId===node.sourceId&&(d.entity===node.entity||node.entity==='purchase_material_return'&&d.entity==='im_purinbill')))){graph.documents.push(node);graph.relations.push({id:'root:'+node.id,fromDocumentId:graph.rootDocumentId,toDocumentId:node.id,type:'source_order'})}
 }
 const stockChains=root.kind==='fulfillment'?await readConsumedStockChains(db,batch,employees,root.number):[]
 for(const chain of stockChains){
  const apiStock=await readApiRelations(db,batch.id,{source_id:chain.id,number:chain.number,kind:'stock'})
  if(apiStock&&(apiStock.complete||!chain.graph))chain.graph=apiStock
  if(!chain.graph||apiStock?.complete)continue
  const purchases=chain.graph.documents.filter((d:Row)=>d.entity==='hzkj_purorderbill')
  if(purchases.length){
   const rows=await db.query(`SELECT source_id,raw FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='purchase' AND source_id=ANY($2::text[])`,[batch.id,purchases.map((d:Row)=>d.sourceId)])
   chain.graph.relations.push(...purchaseApplicationEdges(chain.graph,rows,chain.number))
  }
 }
 return {stockChains,number:root.number,id:root.source_id,kind:root.kind,billStatus:root.status??graph?.documents.find((d:Row)=>d.id===graph.rootDocumentId)?.billStatus??null,customerName:root.display.customerName??null,
  details:progressHeader(root.display),businessStatus:root.display.businessStatus??null,conclusions,memberships,graph:graph?{rootDocumentId:graph.rootDocumentId,documents:graph.documents,relations:graph.relations,builtAt:graph.builtAt}:null,
  source:'local',asOf:batch.updated_at??batch.captured_at??null}
}

/** Conclusions use current source facts, never the presence of a graph node alone. */
export function progressConclusions(root:Row,task:string|undefined,allocations:Row[]){
 const fulfillment=root.order_status==='5'?'部分履约':root.order_status==='4'?'已履约':root.order_status==='6'?'取消履约':({dispatch_missing:'待建发运单',dispatch_pending:'已建单未取号',dispatch_tracking:'已取号待履约'} as Row)[task??'']??(['A','B'].includes(root.status)?'待审核':'待确认')
 let allocation='待确认'
 if(allocations.length && allocations.every(d=>(d.association?.state??'verified')==='verified' && ['A','B','C'].includes(d.rawBillStatus) && ['pending','available','completed'].includes(d.rawAllocationStatus))){
  if(allocations.every(d=>d.rawAllocationStatus==='completed' && d.rawBillStatus==='C'))allocation='已齐套已审核'
  else if(allocations.some(d=>d.rawAllocationStatus!=='completed'))allocation='未齐套'
  else allocation='已齐套未审核'
 }
 return {fulfillment,allocation}
}

export function progressHeader(display:Row){
 const tracking:Record<string,string[]>={full:[],last_mile:[]}
 for(const d of display.dispatchDocuments??[]){
  if((d.association?.state??'verified')!=='verified'||d.rawInterceptStatus==='CANCELLED'||d.deliveryStatus==='CANCELLED')continue
  for(const t of d.trackingNumbers??[])if(tracking[t.type]&&typeof t.number==='string'&&t.number.trim())tracking[t.type].push(t.number.trim())
 }
 return {shopifyOrderNumber:display.sourceOrderNumberIsManual?null:display.shopifyOrderNumber??null,paidAt:display.paidAt??null,fullTrackingNumbers:[...new Set(tracking.full)],lastMileTrackingNumbers:[...new Set(tracking.last_mile)]}
}
/** Only explicit requisition references between already-authorized graph nodes. */
export function purchaseApplicationEdges(graph:Row,rows:Row[],orderNumber:string){
 const edges:Row[]=[]
 for(const row of rows){const target=graph.documents.find((d:Row)=>d.entity==='hzkj_purorderbill'&&d.sourceId===row.source_id);if(!target)continue
  for(const l of row.raw.hzkj_billentry??[]){
   if(l.hzkj_srcbillentity!=='hzkj_purapplybill'||l.hzkj_salbillnumber&&l.hzkj_salbillnumber!==orderNumber)continue
   const id=String(l.hzkj_srcbillid??'').trim(),number=String(l.hzkj_srcbillnumber??'').trim()
   if((!id||id==='0')&&!number)continue
   const found=graph.documents.filter((d:Row)=>d.entity==='hzkj_purapplybill'&&(!id||id==='0'||d.sourceId===id)&&(!number||d.number===number))
   if(found.length!==1)continue
   const from=found[0].id,to=target.id
   if([...graph.relations,...edges].some((e:Row)=>e.fromDocumentId===from&&e.toDocumentId===to))continue
   edges.push({id:'application:'+from+':'+to,fromDocumentId:from,toDocumentId:to,type:'purchase_application',basis:'explicit_application_reference'})
  }
 }
 return edges
}
