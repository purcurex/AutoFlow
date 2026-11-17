import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePurchaseRefundCandidate, normalizePurchaseRefundApplication } from './fop-purchase-refund-facts.mjs'

test('keeps refunded purchase money and dates separate from physical-return facts', () => {
  const result = normalizePurchaseRefundCandidate({ id: '2610989829399294976', billno: 'P1', hzkj_pay_status: '4', hzkj_refund_amount: '12345678901234567890.01', hzkj_biztime: '2026-11-16' })
  assert.equal(result.refundAmount, '12345678901234567890.01')
  assert.equal(result.currency, null)
  assert.equal(result.rawPurchaseDate, '2026-11-16')
  assert.equal(result.physicalReturnIntegration, false)
  assert.equal(result.semanticType, 'purchase_refund_candidate')
  assert.equal(normalizePurchaseRefundCandidate({ id: '1', hzkj_pay_status: '3', hzkj_refund_amount: 12.34 }).refundAmount, '12.34')
  assert.throws(() => normalizePurchaseRefundCandidate({ id: '1', hzkj_pay_status: '1' }), /unexpected_refund_status/)
  assert.throws(() => normalizePurchaseRefundCandidate({ id: 2610989829399294976, hzkj_pay_status: '3' }), /invalid_refund_candidate_id/)
})

test('an approved application and generic quantity never prove a physical return or ownership', () => {
  const result = normalizePurchaseRefundApplication({ id: '9', billno: 'R1', billstatus: 'C', hzkj_cancelstatus: 'A', entryentity: [{ id: '10', hzkj_qty: '5.5', hzkj_srcbillentity: 'hzkj_purorderbill', hzkj_srcbillid: '2', hzkj_srcbillentryid: '3', hzkj_salbillnumber: 'SO1' }] })
  assert.equal(result.rawBillStatus, 'C')
  assert.equal(result.lines[0].rawQuantity, '5.5')
  assert.equal(result.lines[0].returnQuantity, null)
  assert.equal(result.lines[0].returnedQuantity, null)
  assert.equal(result.lines[0].associationState, 'unverified')
  assert.equal(result.ownerEmployeeId, null)
  assert.equal(result.returnKind, null)
  assert.equal(result.physicalStatus, 'unknown')
  assert.equal(result.physicalReturnIntegration, false)
})

test('missing and duplicate application entry identities fail without fabricated links', () => {
  assert.throws(() => normalizePurchaseRefundApplication({ id: '9', entryentity: [{ id: '10' }, { id: '10' }] }), /invalid_refund_application_line_id/)
  assert.throws(() => normalizePurchaseRefundApplication({ id: '9', entryentity: [{}] }), /invalid_refund_application_line_id/)
  const result = normalizePurchaseRefundApplication({ id: '9', entryentity: [{ id: '10', hzkj_qty: null }] })
  assert.equal(result.lines[0].rawQuantity, null)
  assert.equal(result.lines[0].sourceDocumentId, null)
})
