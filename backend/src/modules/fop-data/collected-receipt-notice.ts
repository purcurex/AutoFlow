import { projectPurchaseOrderRows } from './collected-purchase-association'
import { receiptLogistics } from '../workbench-replica/receipt-logistics'
type Row=Record<string,any>
/** Resolve exact source purchase entry IDs; SKU equality never establishes a link. */
export function projectReceiptNotice(raw:Row,purchases:Map<string,Row>,lookup:(number:string)=>Row|null|undefined,lookupOther:(number:string)=>Row|null|undefined=()=>null){
 const owners=new Set<string>(),orders=new Set<string>(),links:Record<string,string>={},issues:Row[]=[]
 const lines=(raw.entryentity??[]).map((line:Row)=>{
  const refs=[...new Map((line.entryentity_lk??[]).map((r:Row)=>[`${r.entryentity_lk_sbillid}:${r.entryentity_lk_sid}`,r])).values()] as Row[]
  const candidates=refs.flatMap(ref=>{const purchase=purchases.get(String(ref.entryentity_lk_sbillid));if(!purchase)return[];const found=(purchase.hzkj_billentry??[]).filter((l:Row)=>String(l.id)===String(ref.entryentity_lk_sid));return found.length===1?[{purchase,line:found[0]}]:[]})
  const source=candidates.length===1&&refs.length===1?candidates[0]:null
  const projected=source?projectPurchaseOrderRows({...source.purchase,hzkj_billentry:[source.line]},lookup).rows[0]:null
  const item=projected?.lines[0]
  const other=source?lookupOther(source.line.hzkj_salbillnumber):null
  if(source)links[String(line.id)]=String(source.line.id)
  if(projected?.orderId){orders.add(projected.orderId);if(projected.ownerEmployeeId)owners.add(projected.ownerEmployeeId)}
  if(!source||(!projected?.orderId&&!other))issues.push({entryId:line.id,reason:!source?'source_purchase_entry_unresolved':'source_fulfillment_unresolved',sourceNumber:source?.line.hzkj_salbillnumber??line.hzkj_salbillnumber??null})
  return {id:line.id,sourceDocumentKind:projected?.orderId?'fulfillment':other?.kind??null,sourceDocumentId:projected?.orderId??other?.id??null,sku:item?.sku??null,name:item?.name??line.hzkj_materialname??null,variant:item?.variant??null,imageUrl:item?.imageUrl??null,quantity:line.hzkj_qty??null,inboundQuantity:null,purchaseId:source?.purchase.id??null,purchaseLineId:source?.line.id??null,sourceOrderId:projected?.orderId??null,fulfillmentLineId:item?.fulfillmentLineId??null,lineAssociationState:item?.lineAssociationState??'unresolved'}
 })
 const logistics=receiptLogistics([{id:raw.id,number:raw.billno,shippedAt:raw.hzkj_shipping_time,carrier:raw.hzkj_logistics_company,trackingNumber:raw.hzkj_waybill_number}])[0]
 return {links,issues,display:{id:raw.id,number:raw.billno,rawBillStatus:raw.billstatus??null,rawCancelStatus:raw.hzkj_cancelstatus??null,rawWmsStatus:raw.hzkj_receiptnotice_status??null,shippedAt:logistics.shippedAt,carrier:logistics.carrier,trackingNumber:logistics.trackingNumber,lines,sourceOrderIds:[...orders],ownerEmployeeIds:[...owners],association:{state:issues.length||!lines.length?'unresolved':'verified',issues},missingFields:['inboundQuantity'],quantity:lines.reduce((n:number,l:Row)=>n+Number(l.quantity??0),0),inboundQuantity:null,pendingQuantity:null}}
}
