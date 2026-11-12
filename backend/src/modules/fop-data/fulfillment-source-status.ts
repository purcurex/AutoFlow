/** Native fulfillment header enums; never infer supplier payment or platform placement. */
export const sourcePurchaseLabels: Record<string, readonly [string,string]> = {
 '0':['未采购','Not purchased'], '1':['部分采购','Partly purchased'], '2':['已采购','Purchased'], '3':['已入库','Received'], '4':['已发货','Supplier shipped'],
}
export const sourceOutboundLabels: Record<string, readonly [string,string]> = {
 '0':['未出库','Not outbound'], '1':['部分出库','Partly outbound'], '2':['已出库','Outbound completed'],
}
export const sourceStatusLabel = (value: string | null | undefined, kind: 'purchase' | 'outbound', english = false): string =>
 (value != null ? (kind === 'purchase' ? sourcePurchaseLabels : sourceOutboundLabels)[value]?.[english ? 1 : 0] : null) ?? (english ? 'Unconfirmed' : '待确认')
