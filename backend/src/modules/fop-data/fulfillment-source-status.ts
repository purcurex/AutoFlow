/** Native fulfillment header enums; never infer supplier payment or platform placement. */
export const sourcePurchaseLabels: Record<string, readonly [string,string]> = {
 '0':['未采购','Not purchased'], '1':['部分采购','Partly purchased'], '2':['已采购','Purchased'], '3':['已入库','Received'], '4':['已发货','Supplier shipped'],
}
export const sourceOutboundLabels: Record<string, readonly [string,string]> = {
 '0':['未出库','Not outbound'], '1':['部分出库','Partly outbound'], '2':['已出库','Outbound completed'],
}
export const sourceStatusLabel = (value: string | null | undefined, kind: 'purchase' | 'outbound', english = false): string =>
 (value != null ? (kind === 'purchase' ? sourcePurchaseLabels : sourceOutboundLabels)[value]?.[english ? 1 : 0] : null) ?? (english ? 'Unconfirmed' : '待确认')

export const businessStatusLabels:Record<string,readonly [string,string]>={
 unpurchased:['未采购','Not purchased'],purchasing:['采购中','Purchasing'],partial_purchased:['部分采购','Partly purchased'],purchased:['已采购','Purchased'],
 partial_shipped:['部分发货','Partly shipped'],shipped:['已发货','Shipped'],partial_received:['部分入库','Partly received'],received:['已入库','Received'],
 cancelled:['订单取消','Order cancelled'],sku_unlinked:['未关联SKU','SKU not linked'],unpaid:['待支付','Awaiting payment'],paid:['已支付','Paid'],processing:['处理中','Processing'],
 fulfilled:['已履约','Fulfilled'],partial_fulfilled:['部分履约','Partly fulfilled'],fulfillment_cancelled:['取消履约','Fulfillment cancelled'],
 manual:['手工订单','Manual order'],unfulfilled:['未发货','Not shipped'],partial:['部分出库','Partly outbound'],completed:['已出库','Outbound completed'],pending:['未出库','Not outbound'],
 not_required:['无需处理','Not required'],unknown:['待确认','Unconfirmed'],
}
export function businessStatusLabel(value:string|undefined,kind:'purchase'|'outbound'|'order'|'source'='order',english=false):string{
 const source:Record<string,readonly[string,string]>={manual:['手工订单','Manual order'],fulfilled:['已发货','Shipped'],partial:['部分发货','Partly shipped'],unfulfilled:['未发货','Not shipped'],restocked:['已退货','Returned'],pending:['待处理','Pending'],open:['已打开','Open'],cancelled:['已取消','Cancelled'],scheduled:['已计划','Scheduled'],'on demand':['按需发货','On demand']}
 if(kind==='source'){const native=value?.trim();return !native||native==='unknown'?(english?'Unconfirmed':'待确认'):source[native]?.[english?1:0]??native}
 if(value==='not_required')return kind==='outbound'?(english?'No outbound required':'无需出库'):(english?'No purchase required':'无需采购')
 return (businessStatusLabels[value??'unknown']??businessStatusLabels.unknown)[english?1:0]
}
