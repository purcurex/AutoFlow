import type { CellValue } from 'exceljs'
import { STOCK_TYPE_LABELS, STOCK_ORDER_LABELS, STOCK_PURCHASE_LABELS } from '../fop-data/fop-stock.types'
const review = { approved:'已审核', pending:'未审核', A:'暂存', B:'已提交', C:'已审核' }
const payment = { paid:'已支付', unpaid:'待支付', partial:'部分支付', refunded:'已退款待处理' }
const rma = { refund:'仅退款', return_refund:'退货退款', reshipment:'补发货', cancellation:'订单取消', interception:'拦截发货', interception_cancelled:'取消拦截' }
const dictionaries:Record<string,Record<string,string>> = {
 '付款状态':payment,'支付状态':payment,'采购付款状态':payment,
 '审核状态':review,'单据状态':review,'配货原生审核状态':review,
 '备货类型':STOCK_TYPE_LABELS,'备货订单状态':STOCK_ORDER_LABELS,'采购状态':STOCK_PURCHASE_LABELS,
 '采购渠道':{online:'线上',offline:'线下'},
 '下单状态':{placed:'已下单',pending:'待下单'},
 '供应商发货状态':{pending:'供应商待发货',partial:'供应商部分发货',shipped:'供应商已发货'},
 '配货原生齐套状态':{pending:'未齐套',completed:'已齐套',voided:'已作废'},
 '售后类型':rma,'原生售后类型':{A:'退货退款',B:'仅退款',C:'补发货'},
 '原生流程状态':{'0':'取消','1':'待处理','2':'处理中','3':'处理完成','4':'已补发','5':'取消发货','6':'已关闭'},
 '关联核查':{verified:'已核验',ambiguous:'关联不唯一',unmatched:'未匹配',payer_mismatch:'付款客户不一致',owner_unverified:'业务员待核验'},
}
/** Translate only typed status columns; IDs, currency and free text remain untouched. */
export function exportStatusName(header:string,value:CellValue):CellValue {
 if(value===null||value===undefined||value==='')return value
 if(header==='已取消'&&typeof value==='boolean')return value?'是':'否'
 const labels=dictionaries[header]
 if(!labels)return value
 return String(value).split(' / ').map(code=>labels[code]??(/[\u4e00-\u9fff]/.test(code)||code==='—'?code:'待核查')).join(' / ')
}
