import { purchasePayment } from './purchase-payment'
import { physicalPurchaseGroups } from './physical-business-lines'
type Row=Record<string,any>
/** Explicit stock usage only. A selection label or stock SKU alone is not usage evidence. */
export function usesReservedStock(line:Row):boolean {
 return line.hzkj_use_stock==='1'||['hzkj_consume_stock','hzkj_deposit_use_qty','hzkj_full_pay_used_qty'].some(k=>line[k]!=null&&line[k]!==''&&Number.isFinite(Number(line[k]))&&Number(line[k])>0)
}
export function pendingPurchaseStage(parent:Row, demand:Row[], purchases:{raw:Row;display:Row}[], dispatches:Row[]|null|undefined):string|null {
 if(parent.billstatus!=='C'||parent.hzkj_orderstatus==='0'||!demand.some(l=>['unpurchased','purchasing'].includes(l.purchase)))return null
 const active=physicalPurchaseGroups(parent,purchases).filter(p=>p.raw.hzkj_cancelstatus!=='B'&&purchasePayment(p.raw)!=='cancelled')
 if(!active.length)return 'purchase_order_pending'
 const verified=active.filter(p=>p.raw.hzkj_cancelstatus==='A'&&p.display.association?.state!=='conflict'&&(p.display.rows??[]).some((r:Row)=>r.orderId===parent.id&&r.associationState==='verified'))
 if(verified.some(p=>p.raw.hzkj_purchase_channel==='1'&&typeof p.raw.hzkj_1688_order_n==='string'&&p.raw.hzkj_1688_order_n.trim()&&p.raw.hzkj_pay_status==='0'))return 'payment_pending'
 if(verified.length!==active.length||!verified.some(p=>p.raw.hzkj_pay_status==='0'))return null
 if(!Array.isArray(dispatches))return null // Not captured is not proof of absence.
 if(!dispatches.some(d=>d.association?.state==='verified'&&d.rawInterceptStatus!=='CANCELLED'&&typeof d.number==='string'&&d.number.trim()))return 'dispatch_preparation'
 return null
}
