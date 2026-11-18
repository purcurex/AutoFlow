import { withVirtualProductFacts } from './physical-business-lines'
import { withOrderBusinessStatus } from './order-business-status'
import { timestampProcurementProjection } from '../workbench-replica/timestamp-procurement-projection'
type Row=Record<string,any>
/** Shared by incremental publication and explicit offline repair; no source writes or remote lookups. */
export function physicalBusinessProjection(raw:Row,display:Row,products:Map<string,Row>,purchases:{raw:Row;display:Row}[],applications:Row[]=[]):Row {
 const facts=withVirtualProductFacts(raw,id=>products.get(id))
 const identities=new Map<string,boolean>(facts.hzkj_orders_billentry.map((l:Row)=>[String(l.id),l.isVirtual]))
 const next={...display,...timestampProcurementProjection(facts,purchases,applications,display.dispatchDocuments),
  // Persist positive identity evidence, or clear a previous positive mark. Do not
  // rewrite every unchanged physical item just to add an optional false value.
  items:(display.items??[]).map((item:Row)=>identities.get(String(item.id))
   ? {...item,isVirtual:true} : item.isVirtual===true ? {...item,isVirtual:false} : item)}
 return withOrderBusinessStatus(next,facts)
}
