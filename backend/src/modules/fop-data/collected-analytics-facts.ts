import Decimal from 'decimal.js'

type Row = Record<string, any>
type FieldMap = Record<string, string>
export type CollectedAnalyticsEntityType = 'fulfillment' | 'stock' | 'purchase' | 'dispatch' | 'receipt'
export interface CollectedAnalyticsContext {
  companyId: string
  capturedAt: string
  /** Verified capture request and, where the API omits organization, verified local parent/company evidence. */
  scopeVerified: true
}
export interface CollectedAnalyticsFact {
  entity_type: CollectedAnalyticsEntityType
  source_id: string
  company_id: string
  document_number: string
  owner_employee_id: string | null
  customer_id: string | null
  department_id: string | null
  created_at: string | null
  paid_at: string | null
  source_paid_at: string | null
  occurred_at: string | null
  amount: string | null
  currency_code: string | null
  quantity: string | null
  raw_status: string | null
  facts: Row
  raw: Row
  captured_at: string
}
export interface CollectedAnalyticsDate {
  value: string
  precision: 'day' | 'second' | 'millisecond'
  timezone: string
  timezoneBasis: 'explicit_offset' | 'source_business_timezone'
  startInclusive: string
  endExclusive: string
  sourcePath: string
}

const ExactDecimal = Decimal.clone({ precision: 100 })
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
function id(value: unknown): string | null {
  if (typeof value === 'number') value = Number.isSafeInteger(value) && value > 0 ? String(value) : null
  return typeof value === 'string' && /^[1-9]\d{0,30}$/.test(value) ? value : null
}
function decimal(value: unknown): string | null {
  // JSON numeric fractions may already have lost precision before reaching the projection.
  if (typeof value === 'number') value = Number.isSafeInteger(value) ? String(value) : null
  const raw = text(value)
  return raw && /^-?\d{1,40}(?:\.\d{1,20})?$/.test(raw) ? new ExactDecimal(raw).toFixed() : null
}
function date(value: unknown, sourcePath: string): CollectedAnalyticsDate | null {
  const raw = text(value)
  if (!raw) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/.exec(raw)
  if (!match) return null
  const [, year, month, day, hour, minute, second, fraction, offset] = match
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`)
  if (!Number.isFinite(calendar.valueOf()) || calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}` || (hour && (+hour > 23 || +minute > 59 || +second > 59))) return null
  if (offset && offset !== 'Z' && (+offset.slice(1, 3) > 14 || +offset.slice(4) > 59 || (+offset.slice(1, 3) === 14 && +offset.slice(4) !== 0))) return null
  const normalized = hour ? `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction || ''}${offset || '+08:00'}` : `${raw}T00:00:00+08:00`
  const time = Date.parse(normalized)
  if (!Number.isFinite(time)) return null
  const precision = !hour ? 'day' : fraction ? 'millisecond' : 'second'
  const duration = precision === 'day' ? 86400000 : fraction ? 10 ** (3 - fraction.slice(1).length) : 1000
  return { value: new Date(time).toISOString(), precision, timezone: offset || 'Asia/Shanghai', timezoneBasis: offset ? 'explicit_offset' : 'source_business_timezone', startInclusive: new Date(time).toISOString(), endExclusive: new Date(time + duration).toISOString(), sourcePath }
}
function reference(raw: Row, key: string): Row | null {
  const nested = object(raw[key]), sourceId = id(raw[`${key}_id`] ?? nested.id)
  const name = text(raw[`${key}_name`] ?? nested.name), number = text(raw[`${key}_number`] ?? nested.number)
  return sourceId || name || number ? { id: sourceId, name, number, sourcePath: key } : null
}

const AMOUNTS: Record<CollectedAnalyticsEntityType, FieldMap> = {
  fulfillment: { orderAmount: 'hzkj_order_amount', collectedAmount: 'hzkj_curtotalamount', settlementTotal: 'hzkj_totalallamount', taxAmount: 'hzkj_totaltaxamount', orderCost: 'hzkj_order_cost', commissionAmount: 'hzkj_cmsamount', discountAmount: 'hzkj_wholediscountamount' },
  stock: { orderAmount: 'hzkj_order_amount', settlementAmount: 'hzkj_curtotalamount', settlementTotal: 'hzkj_totalallamount', taxAmount: 'hzkj_totaltaxamount', depositAmount: 'hzkj_margin_amount', receivedAmount: 'hzkj_receive_amount', receivableAmount: 'hzkj_vable_amount', refundAmount: 'hzkj_refund_amount', surchargeAmount: 'hzkj_surcharge_amount' },
  purchase: { settlementAmount: 'hzkj_totalamount', settlementTotal: 'hzkj_totalallamount', taxAmount: 'hzkj_totaltaxamount', paidAmount: 'hzkj_paidallamount', prepaidAmount: 'hzkj_paidpreallamount', unpaidAmount: 'hzkj_unpaidallamount', orderAmount: 'hzkj_order_amount', orderFreight: 'hzkj_order_postfee', actualPayment: 'hzkj_actual_amount', actualPaidFreight: 'hzkj_actual_free', refundAmount: 'hzkj_refund_amount' },
  dispatch: { actualFreight: 'hzkj_actual_freight', estimatedFreight: 'hzkj_estimate_freight', freightAmount: 'hzkj_freight_amount', freightDifference: 'hzkj_differe_freight' },
  receipt: { receiptAmount: 'hzkj_rec_amount', receiptOrderAmount: 'hzkj_receive_amount', customerPayable: 'hzkj_total_payable', originalCurrencyAmount: 'hzkj_ori_cur_amount', handlingFee: 'hzkj_handling_fee' },
}
const DATES: Record<CollectedAnalyticsEntityType, FieldMap> = {
  fulfillment: { businessAt: 'hzkj_bizdate', paidAt: 'hzkj_receipt_date', sourcePaidAt: 'hzkj_datetimefield', syncedAt: 'hzkj_syncdate' },
  stock: { businessAt: 'hzkj_bizdate', paidAt: 'hzkj_receipt_date' },
  purchase: { businessAt: 'hzkj_biztime', paidAt: 'hzkj_pay_time', closedAt: 'hzkj_closedate', cancelledAt: 'hzkj_canceldate', changedAt: 'hzkj_changedate' },
  dispatch: { freightConfirmedAt: 'hzkj_actual_freight_time', pushedAt: 'hzkj_push_time', trackingLatestAt: 'hzkj_track_latest_time', trackingSyncedAt: 'hzkj_track_sync_time' },
  receipt: { businessAt: 'hzkj_bizdate', paidAt: 'hzkj_receive_time', availableAt: 'hzkj_availableon' },
}
const STATUSES: Record<CollectedAnalyticsEntityType, FieldMap> = {
  fulfillment: { order: 'hzkj_orderstatus', receipt: 'hzkj_receipt_status', purchase: 'hzkj_purchase_status', sourcePayment: 'hzkj_sourcepayststus', sourceFulfillment: 'hzkj_fulfillment_status', delivery: 'hzkj_delivery_status' },
  stock: { order: 'hzkj_orderstatus', receipt: 'hzkj_receipt_status', purchase: 'hzkj_purchase_status', stockType: 'hzkj_stock_type', refund: 'hzkj_refund_status', purchaseChannel: 'hzkj_purchase_channel', purchaseOwner: 'hzkj_purchase_owner' },
  purchase: { payment: 'hzkj_pay_status', standardPayment: 'hzkj_paystatus', shipment: 'hzkj_ship_status', logistics: 'hzkj_logisticsstatus', cancelled: 'hzkj_cancelstatus', closed: 'hzkj_closestatus', changed: 'hzkj_changestatus' },
  dispatch: { delivery: 'hzkj_delivery_status', sourceFulfillment: 'hzkj_fulfillment_status', intercept: 'hzkj_ship_block_state', settlement: 'hzkj_settle_status', handover: 'hzkj_confirmation' },
  receipt: { received: 'hzkj_receive_status', receiveType: 'hzkj_receive_type', sourceType: 'hzkj_src_type', arrived: 'hzkj_receipt_status', voided: 'hzkj_void_status', authorized: 'hzkj_authorized_status' },
}
const receiptSource = (value: unknown): string | null => ({ A: 'fulfillment', B: 'sample', C: 'stock', D: 'wallet_recharge', E: 'receipt_adjustment', F: 'rma' } as FieldMap)[String(value)] ?? null
const pickDecimals = (row: Row, mapping: FieldMap): Record<string, string | null> => Object.fromEntries(Object.entries(mapping).map(([key, source]) => [key, decimal(row[source])]))
const pickDates = (row: Row, mapping: FieldMap, prefix = ''): Record<string, CollectedAnalyticsDate | null> => Object.fromEntries(Object.entries(mapping).map(([key, source]) => [key, date(row[source], prefix + source)]))

/** Rebuildable analysis projection of an existing source document; no execution or default financial facts. */
export function normalizeCollectedAnalyticsFact(entityType: CollectedAnalyticsEntityType, input: unknown, context: CollectedAnalyticsContext): CollectedAnalyticsFact {
  const raw = object(input), sourceId = id(raw.id), documentNumber = text(raw.billno)
  const captured = date(context?.capturedAt, 'capture.capturedAt')
  if (!Object.prototype.hasOwnProperty.call(AMOUNTS, entityType) || !sourceId || !documentNumber) throw Error('analytics_invalid_source_identity')
  if (context?.scopeVerified !== true || !id(context.companyId) || !captured || captured.timezoneBasis !== 'explicit_offset') throw Error('analytics_verified_capture_scope_required')
  const sourceCompanies = [raw.org_id, raw.hzkj_org_id, raw.organizationId, object(raw.org).id, object(raw.hzkj_org).id].filter(value => value !== null && value !== undefined)
  if (sourceCompanies.some(value => id(value) !== context.companyId)) throw Error('analytics_company_mismatch')

  // Dispatch APIs return JSON decimal numbers. Convert once to decimal text, never sum floats.
  // Offline imports supply SQL-extracted decimal strings to preserve the full source precision.
  const amountInput = entityType === 'dispatch' ? Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<Number.MAX_SAFE_INTEGER?String(v):v])) : raw
  const amounts = pickDecimals(amountInput, AMOUNTS[entityType])
  const dates = pickDates(raw, { createdAt: 'createtime', updatedAt: 'modifytime', approvedAt: 'auditdate', ...DATES[entityType] })
  const statuses = Object.fromEntries(Object.entries({ bill: 'billstatus', ...STATUSES[entityType] }).map(([key, source]) => [key, text(raw[source])]))
  const missing = new Set<string>()
  const nativeCurrency = text(raw.hzkj_textfield1)?.toUpperCase()
  const actualCurrency = entityType === 'dispatch' && /^[A-Z]{3}$/.test(nativeCurrency || '') ? nativeCurrency==='RMB'?'CNY':nativeCurrency! : null
  const amount = actualCurrency ? amounts.actualFreight : null
  if (!actualCurrency) missing.add('currency')
  if (entityType === 'dispatch' && amounts.actualFreight === null) missing.add('actualFreight')
  if (entityType === 'dispatch' && !['NORMAL', 'CANCELLED'].includes(statuses.intercept || '')) missing.add('dispatchInterceptStatus')
  const sourceOwner = reference(raw, entityType === 'dispatch' ? 'hzkj_bizoperator' : entityType === 'receipt' ? 'hzkj_bizperson' : 'hzkj_operator')
  const customer = reference(raw, entityType === 'receipt' ? 'hzkj_pay_customer' : 'hzkj_customer')
  const warehouseKey = entityType === 'dispatch' ? 'hzkj_basedatafield' : entityType === 'stock' ? 'hzkj_warehouse' : entityType === 'purchase' ? 'hzkj_warehouse_all' : 'hzkj_dst_warehouse'
  const sourceLinks: Row[] = []
  const link = (data: Row) => { if (data.sourceId || data.documentNumber) sourceLinks.push({ ...data, verified: false }) }
  if (entityType === 'dispatch') link({ entityType: 'fulfillment', sourceId: null, documentNumber: text(raw.hzkj_order_no), sourcePath: 'hzkj_order_no' })
  if (entityType === 'receipt') link({ entityType: receiptSource(raw.hzkj_src_type), sourceId: null, documentNumber: text(raw.hzkj_src_bill), sourcePath: 'hzkj_src_bill' })
  const entryKey = entityType === 'purchase' ? 'hzkj_billentry' : ['receipt','dispatch'].includes(entityType) ? 'entryentity' : 'hzkj_orders_billentry'
  const lines: Row[] = (Array.isArray(raw[entryKey]) ? raw[entryKey] : []).map((value: unknown, index: number) => {
    const entry = object(value), lineId = id(entry.id), prefix = `${entryKey}[${index}].`
    const line: Row = { id: lineId, sequence: Number.isSafeInteger(entry.seq) ? entry.seq : null, quantities: pickDecimals(entry, { quantity: 'hzkj_qty' }), amounts: {}, dates: {}, sku: reference(entry, entityType === 'purchase' ? 'hzkj_material' : 'hzkj_local_sku') }
    if (entityType === 'receipt') {
      line.amounts = pickDecimals(entry, { receivedAmount: 'hzkj_real_receive_amt', orderAmount: 'hzkj_samount', refundAmount: 'hzkj_ramount', handlingFee: 'hzkj_handle_fee', freightAmount: 'hzkj_freight', productAmount: 'hzkj_amountfield', fixedTaxFee: 'hzkj_fixed_tax_fee' })
      line.sourceType = text(entry.hzkj_entry_src_type)
      link({ entityType: receiptSource(entry.hzkj_entry_src_type), sourceId: null, documentNumber: text(entry.hzkj_src_order), lineId, sourcePath: prefix + 'hzkj_src_order' })
    } else if (entityType === 'purchase') {
      line.quantities = pickDecimals(entry, { quantity: 'hzkj_qty', transportedQuantity: 'hzkj_transportqty', receivedQuantity: 'hzkj_receiveqty', inboundQuantity: 'hzkj_invqty', actualQuantity: 'hzkj_actual_quantity' })
      line.amounts = pickDecimals(entry, { amount: 'hzkj_amount', settlementAmount: 'hzkj_settlement_amount', settlementFreight: 'hzkj_settle_shipping', payableAmount: 'hzkj_payableamount' })
      line.dates = pickDates(entry, { promisedAt: 'hzkj_promisedate', deliveryAt: 'hzkj_deliverdate' }, prefix)
      line.warehouse = reference(entry, 'hzkj_warehouse')
      link({ entityType: 'fulfillment', sourceId: id(entry.hzkj_salbillid), documentNumber: text(entry.hzkj_salbillnumber), sourceLineId: id(entry.hzkj_salbillentryid), lineId, sourcePath: prefix + 'hzkj_salbillnumber' })
      link({ entityType: text(entry.hzkj_srcbillentity), sourceId: id(entry.hzkj_srcbillid), documentNumber: text(entry.hzkj_srcbillnumber), sourceLineId: id(entry.hzkj_srcbillentryid), lineId, sourcePath: prefix + 'hzkj_srcbillnumber' })
    } else {
      line.amounts = pickDecimals(entry, { amount: 'hzkj_amount', taxAmount: 'hzkj_taxamount', amountWithTax: 'hzkj_amountandtax' })
      line.warehouse = reference(entry, 'hzkj_warehourse')
      if (entityType === 'stock') line.quantities = pickDecimals(entry, { quantity: 'hzkj_qty', purchasedQuantity: 'hzkj_purcqty', inboundQuantity: 'hzkj_instock_qty' })
    }
    return line
  })
  const quantities = lines.map(line => line.quantities.quantity as string | null)
  const quantity = ['fulfillment', 'stock', 'purchase'].includes(entityType) && quantities.length && quantities.every(value => value !== null) ? quantities.reduce((sum, value) => sum.plus(value!), new ExactDecimal(0)).toFixed() : null
  if (['fulfillment', 'stock', 'purchase'].includes(entityType) && quantity === null) missing.add('quantity')
  if (!customer?.id) missing.add('customer')
  missing.add('verifiedOwnerEmployeeId')
  const warehouse = reference(raw, warehouseKey)
  const facts: Row = {
    schemaVersion: 1, projectionOfSourceDocument: true, consistentSnapshot: false,
    sourceOwnershipVerified: false, effective: false,
    // Incurred confirmed cost is independent of shipment cancellation/interception.
    businessEligible: entityType === 'dispatch' && statuses.bill === 'C' && !!dates.freightConfirmedAt && amount!==null && new ExactDecimal(amount).gt(0),
    scope: { companyId: context.companyId, verified: true, basis: sourceCompanies.length ? 'source_company_and_verified_capture' : 'verified_capture_request' },
    amounts, amountSources: AMOUNTS[entityType], amountCurrencies: Object.fromEntries(Object.keys(amounts).map(key => [key, key === 'actualFreight' ? actualCurrency : null])),
    currencyAggregationAllowed: amount !== null && actualCurrency !== null,
    dates, statuses, lines, sourceLinks,
    sourceOwner: sourceOwner ? { ...sourceOwner, identityVerified: false } : null,
    sourceDepartment: reference(raw, entityType === 'dispatch' ? 'hzkj_sale_org' : entityType === 'receipt' ? 'hzkj_dpartment' : 'hzkj_dept'),
    customer, payerCustomer: reference(raw, 'hzkj_payingcustomer'), supplier: reference(raw, 'hzkj_supplier'),
    warehouse, warehouseCode: warehouse?.number ?? null, carrier: reference(raw, 'hzkj_logistics_providers'),
    channel: reference(raw, entityType==='dispatch'?'hzkj_logistics_channel1':'hzkj_channel'), customerChannel: reference(raw, 'hzkj_customer_channel'), shop: reference(raw, 'hzkj_shop'),
    countryCode: text(entityType === 'dispatch' ? raw.hzkj_country : raw.hzkj_country_twocountrycode),
    missingFields: [...missing],
  }
  return {
    entity_type: entityType, source_id: sourceId, company_id: context.companyId, document_number: documentNumber,
    owner_employee_id: null, customer_id: customer?.id ?? null, department_id: null,
    created_at: dates.createdAt?.value ?? null, paid_at: dates.paidAt?.value ?? null, source_paid_at: dates.sourcePaidAt?.value ?? null,
    occurred_at: entityType === 'dispatch' ? dates.freightConfirmedAt?.value ?? null : dates.paidAt?.value ?? null,
    amount, currency_code: actualCurrency, quantity, raw_status: text(raw.billstatus), facts, raw, captured_at: captured.value,
  }
}
