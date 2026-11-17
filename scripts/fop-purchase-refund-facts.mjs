// Offline read models for the supplied purchase APIs. Neither model is a physical return.
const text = value => typeof value === 'string' && value.trim() ? value : null
const id = value => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : null
const decimal = value => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? value : typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER && /^\d+(?:\.\d+)?$/.test(String(value)) ? String(value) : null

export const physicalPurchaseReturnGap = Object.freeze({
  physicalReturnIntegration: false,
  sourceApis: ['queryPurchaseReturn', 'queryPurchaseRefundApplication'],
  missingFields: ['physical_return_document', 'return_kind', 'physical_return_status', 'return_quantity', 'returned_quantity', 'return_logistics', 'verified_fulfillment_line_relation'],
  message: '已提供采购订单退款候选和采购退款申请查询；实物退货类型、进度、退货数量、物流及履约明细关联仍待提供。',
})

export function normalizePurchaseRefundCandidate(raw) {
  if (!id(raw?.id)) throw Error('invalid_refund_candidate_id')
  if (!['3', '4'].includes(raw.hzkj_pay_status)) throw Error('unexpected_refund_status')
  return {
    sourceEntity: 'hzkj_purorderbill', semanticType: 'purchase_refund_candidate',
    sourceId: raw.id, purchaseNumber: text(raw.billno), platformOrderNumber: text(raw.hzkj_1688_order_n),
    rawPaymentStatus: raw.hzkj_pay_status, rawPaymentStatusTitle: text(raw.hzkj_pay_status_title),
    refundAmount: decimal(raw.hzkj_refund_amount), currency: null,
    // hzkj_biztime is the purchase date, never a refund or return date.
    rawPurchaseDate: text(raw.hzkj_biztime), physicalReturnIntegration: false,
  }
}

export function normalizePurchaseRefundApplication(raw) {
  if (!id(raw?.id)) throw Error('invalid_refund_application_id')
  const seen = new Set()
  const lines = (Array.isArray(raw.entryentity) ? raw.entryentity : []).map(line => {
    if (!id(line?.id) || seen.has(line.id)) throw Error('invalid_refund_application_line_id')
    seen.add(line.id)
    return {
      sourceLineId: line.id, sourceEntity: text(line.hzkj_srcbillentity),
      sourceDocumentId: id(line.hzkj_srcbillid), sourceDocumentNumber: text(line.hzkj_srcbillnumber),
      sourceDocumentLineId: id(line.hzkj_srcbillentryid), salesOrderNumber: text(line.hzkj_salbillnumber),
      // FOP uses hzkj_rf_applyqty for requested physical quantity; generic hzkj_qty cannot substitute.
      rawQuantity: decimal(line.hzkj_qty), returnQuantity: null, returnedQuantity: null,
      associationState: 'unverified',
    }
  })
  return {
    sourceEntity: 'hzkj_purrefundapplybill', semanticType: 'purchase_refund_application',
    sourceId: raw.id, number: text(raw.billno), rawBillStatus: text(raw.billstatus),
    rawBillStatusTitle: text(raw.billstatus_title), rawCancelStatus: text(raw.hzkj_cancelstatus),
    lines, physicalReturnIntegration: false, returnKind: null, physicalStatus: 'unknown',
    refundAmount: null, currency: null, ownerEmployeeId: null,
    missingFields: [...physicalPurchaseReturnGap.missingFields],
  }
}
