import type { StockOrderStatus, StockPurchaseStatus } from './fop-stock.types'

const text=(value:unknown):string|null=>typeof value==='string'&&value.trim()?value.trim():typeof value==='number'&&Number.isFinite(value)?String(value):null
// Verified queryStockOrder payloads, 2026-11-17. FOP source titles override code dictionaries.
const orderNames:Record<string,string>={'0':'已取消','1':'待支付','2':'已支付'}
const purchaseNames:Record<string,string>={'0':'未采购','1':'采购中','2':'已采购','3':'已入库','4':'已发货'}
const orderStates:Record<string,StockOrderStatus>={'已取消':'cancelled','待支付':'unpaid','已支付':'paid'}
const purchaseStates:Record<string,StockPurchaseStatus>={'未采购':'unpurchased','部分采购':'partial','采购中':'in_progress','已采购':'purchased','已入库':'received','已发货':'shipped'}
export function stockOrderState(value:unknown,title?:unknown){
 const rawOrderStatus=text(value),orderStatusName=text(title)??(rawOrderStatus?orderNames[rawOrderStatus]??null:null)
 return {rawOrderStatus,orderStatusName,orderStatus:orderStatusName?orderStates[orderStatusName]??null:null}
}
export function stockPurchaseState(value:unknown,title?:unknown){
 const rawPurchaseStatus=text(value)
 // User-confirmed exception: an absent/blank purchase value means 未采购, not unknown.
 const empty=value===null||value===undefined||typeof value==='string'&&!value.trim()
 const purchaseStatusName=empty?'未采购':text(title)??(rawPurchaseStatus?purchaseNames[rawPurchaseStatus]??null:null)
 return {rawPurchaseStatus,purchaseStatusName,purchaseStatus:purchaseStatusName?purchaseStates[purchaseStatusName]??'unknown' as StockPurchaseStatus:'unknown' as StockPurchaseStatus}
}
