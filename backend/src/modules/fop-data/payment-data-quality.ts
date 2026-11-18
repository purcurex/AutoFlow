type Row = Record<string, any>
export function withPaymentDataQuality(display: Row, raw: Row | undefined): Row {
  const check = display.paymentDataCheck
  const projection = raw?.timestampProjection
  const timestampVerified = projection?.entityCode === 'hzkj_orders' && !!projection.companyId
    && ['verified_timestamp_scope', 'source_org_id_checked_against_timestamp_scope'].includes(projection.companyBasis)
    && [raw?.org_id, raw?.org?.id, raw?.organizationId, raw?.hzkj_org?.id].every(id => id == null || id === projection.companyId)
  const confirmed = (timestampVerified || check?.source === 'fop_targeted_query' && check.state === 'confirmed_empty'
    && check.sourceId === display.id) && raw?.id === display.id
    && raw?.hzkj_receipt_status === '1' && Object.prototype.hasOwnProperty.call(raw, 'hzkj_receipt_date')
    && (raw.hzkj_receipt_date == null || typeof raw.hzkj_receipt_date === 'string' && !raw.hzkj_receipt_date.trim())
  if (confirmed) {
    // The timestamp normalizer preserves malformed values as an unknown-time marker.
    // A normalized null is not proof that the source date was genuinely empty.
    const invalid = timestampVerified && Array.isArray(projection.unknownTimes)
      && projection.unknownTimes.includes('hzkj_receipt_date')
    return { ...display, exception: { type: 'logistics_exception', reason: invalid ? '收款日期格式待核验' : '收款日期为空', code: invalid ? 'paid_date_invalid' : 'paid_date_missing', hours: null } }
  }
  return ['paid_date_missing', 'paid_date_invalid'].includes(display.exception?.code) ? { ...display, exception: null } : display
}
