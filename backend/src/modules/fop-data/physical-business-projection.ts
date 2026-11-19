import { withVirtualProductFacts } from './physical-business-lines'
import { withOrderBusinessStatus } from './order-business-status'
import { timestampProcurementProjection } from '../workbench-replica/timestamp-procurement-projection'
import { sourceTime } from '../workbench-replica/timestamp-sync'
import { procurementSources, withProcurementSources, type StockConsumptionSnapshot, type ProcurementSources } from './stock-consumption-source'
type Row=Record<string,any>
/** Keep the ledger's original value; publish FOP wall-clock timestamps explicitly as UTC+8. */
function consumptionTime(value:unknown):string|null {
 if(typeof value!=='string'||!value.trim())return null
 let normalized=value.trim().replace(' ','T')
 if(!/(?:Z|[+-]\d{2}:\d{2})$/.test(normalized))normalized+='+08:00'
 try{sourceTime(normalized);return normalized}catch{return null}
}
/** Shared by incremental publication and explicit offline repair; no source writes or remote lookups. */
export function physicalBusinessProjection(raw:Row,display:Row,products:Map<string,Row>,purchases:{raw:Row;display:Row}[],applications:Row[]=[],consumptions?:StockConsumptionSnapshot):Row {
 const physical=withVirtualProductFacts(raw,id=>products.get(id))
 let sources:ProcurementSources|undefined=consumptions?procurementSources(physical,consumptions):display.procurementSources
 const facts=withProcurementSources(physical,sources)
 if(sources&&sources.status!=='not_applicable'&&facts===physical)sources=undefined
 const procurement=timestampProcurementProjection(facts,purchases,applications,display.dispatchDocuments)
 if(sources?.status==='incomplete'){
  // Missing consumption identity cannot prove any direct-purchase demand. Keep
  // actual paid/shipped milestones, but never manufacture an uncreated purchase.
  if(procurement.procurementStage==='purchase_order_pending'){
   procurement.procurementStage='unknown';procurement.procurementQueueFlags.pending=false
  }
  procurement.procurementProgress.purchaseOrder='unknown'
  procurement.timestampProcurementBasis.lineCoverageVerified=false
  procurement.timestampProcurementBasis.missingFields.push('verified_stock_consumption_by_order_sku')
 }
 // A reserved SKU has no new direct demand, but its stock supplier may still
 // owe shipment. Use that stock document's own state, never the selection flag.
 const stockShippingPending=sources?.status==='complete'&&sources.items.some(source=>source.records.some(record=>record.stockPurchaseStatus==='2'&&Number(record.quantity)>0))
 if(stockShippingPending&&procurement.businessStatus.order!=='cancelled'){
  procurement.procurementQueueFlags.shipping=true
  procurement.procurementQueueFlags.completed=false
  procurement.nativeSupplierShipment=['shipped','partial'].includes(procurement.nativeSupplierShipment)?'partial':'pending'
  if(['not_required','unknown','shipped','supplier_pending','supplier_partial'].includes(procurement.procurementStage))procurement.procurementStage=procurement.nativeSupplierShipment==='partial'?'supplier_partial':'supplier_pending'
 }
 const identities=new Map<string,boolean>(facts.hzkj_orders_billentry.map((l:Row)=>[String(l.id),l.isVirtual]))
 const sourceByLine=new Map<string,Row>()
 for(const source of sources?.items??[])if(source.lineIds[0])sourceByLine.set(source.lineIds[0],{...source,records:source.records.map(({raw,issues,customerId,warehouseId,...record}:Row)=>({...record,usedAt:consumptionTime(record.usedAt)}))})
 const {procurementSources:previousSources,...currentDisplay}=display
 const next={...currentDisplay,...procurement,
  stockSupplierShipmentPending:!!stockShippingPending,
  fulfillmentProgress:{...display.fulfillmentProgress,supplierShipment:procurement.nativeSupplierShipment},
  ...(sources?{procurementSources:{...sources,items:[...sourceByLine.values()]}}:{}),
  // Persist positive identity evidence, or clear a previous positive mark. Do not
  // rewrite every unchanged physical item just to add an optional false value.
  items:(display.items??[]).map((item:Row)=>{
   const {procurementSource:previous,...rest}=item,source=sourceByLine.get(String(item.id))
   const next={...rest,...(source?{procurementSource:source}:{})}
   return identities.get(String(item.id))?{...next,isVirtual:true}:item.isVirtual===true?{...next,isVirtual:false}:next
  })}
 return withOrderBusinessStatus(next,facts)
}
