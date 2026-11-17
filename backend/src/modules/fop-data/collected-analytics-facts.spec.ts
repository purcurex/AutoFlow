import { normalizeCollectedAnalyticsFact } from './collected-analytics-facts'

const context = { companyId: '100000', capturedAt: '2026-11-12T12:00:00+08:00', scopeVerified: true as const }
const identity = { id: '901', billno: 'ANALYTICS-901' }

describe('collected analytics projection', () => {
  it('rejects unverified capture scope, other companies and lossy source identifiers', () => {
    expect(() => normalizeCollectedAnalyticsFact('fulfillment', identity, { ...context, scopeVerified: false as any })).toThrow()
    expect(() => normalizeCollectedAnalyticsFact('receipt', { ...identity, org_id: '200000' }, context)).toThrow()
    expect(() => normalizeCollectedAnalyticsFact('stock', { ...identity, org_id: '100000', hzkj_org: { id: '200000' } }, context)).toThrow()
    expect(() => normalizeCollectedAnalyticsFact('dispatch', { ...identity, id: 9007199254740992 }, context)).toThrow()
  })

  it('preserves distinct fulfillment amounts without inventing a currency or employee binding', () => {
    const result = normalizeCollectedAnalyticsFact('fulfillment', {
      ...identity, hzkj_operator_id: '123', hzkj_operator_name: 'Source owner', hzkj_customer_id: '456',
      hzkj_order_amount: '9007199254740993.12', hzkj_totalallamount: '120.50', hzkj_order_cost: '90.10',
      hzkj_curtotalamount: '110.20', hzkj_receipt_status: '1', billstatus: 'C',
      hzkj_receipt_date: '2026-11-01 00:05:00', hzkj_datetimefield: '2026-10-30T23:00:00Z',
      hzkj_orders_billentry: [{ id: '11', hzkj_qty: '0.1' }, { id: '12', hzkj_qty: '0.2' }],
    }, context)
    expect(result.amount).toBeNull()
    expect(result.currency_code).toBeNull()
    expect(result.owner_employee_id).toBeNull()
    expect(result.customer_id).toBe('456')
    expect(result.quantity).toBe('0.3')
    expect(result.facts.sourceOwner).toMatchObject({ id: '123', identityVerified: false })
    expect(result.facts.amounts).toMatchObject({ orderAmount: '9007199254740993.12', settlementTotal: '120.5', orderCost: '90.1', collectedAmount: '110.2' })
    expect(result.facts.currencyAggregationAllowed).toBe(false)
    expect(result.paid_at).toBe('2026-10-31T16:05:00.000Z')
    expect(result.source_paid_at).toBe('2026-10-30T23:00:00.000Z')
    expect(result.facts.scope.basis).toBe('verified_capture_request')
  })

  it('preserves date-only precision as a UTC+8 interval and rejects invalid calendar dates', () => {
    const result = normalizeCollectedAnalyticsFact('stock', {
      ...identity, org_id: '100000', hzkj_bizdate: '2026-11-01', hzkj_receipt_date: '2026-02-30 10:00:00',
      hzkj_receive_amount: '5.25', hzkj_vable_amount: '6', hzkj_margin_amount: '2', hzkj_stock_type: '2',
      hzkj_orders_billentry: [{ hzkj_qty: '2' }, { hzkj_qty: null }],
      hzkj_warehouse_id: '99', hzkj_warehouse_number: 'WH',
    }, context)
    expect(result.facts.dates.businessAt).toMatchObject({ precision: 'day', startInclusive: '2026-10-31T16:00:00.000Z', endExclusive: '2026-11-01T16:00:00.000Z', timezone: 'Asia/Shanghai' })
    expect(result.paid_at).toBeNull()
    expect(result.quantity).toBeNull()
    expect(result.facts.amounts).toMatchObject({ receivedAmount: '5.25', receivableAmount: '6', depositAmount: '2' })
    expect(result.facts.warehouse).toMatchObject({ id: '99', number: 'WH' })
    expect(result.facts.statuses.stockType).toBe('2')
  })

  it('uses actual freight currency and confirmation time without confusing estimates or dispatch progress', () => {
    const result = normalizeCollectedAnalyticsFact('dispatch', {
      ...identity, org_id: '100000', hzkj_customer_id: '456', hzkj_order_no: 'ORDER-1',
      hzkj_actual_freight: '12.34567890123456789012', hzkj_textfield1: 'CNY',
      hzkj_estimate_freight: '10', hzkj_freight_amount: '15', hzkj_actual_freight_time: '2026-11-01T12:00:00+08:00',
      hzkj_delivery_status: 'FULFILLED', hzkj_ship_block_state: 'CANCELLED', hzkj_country: 'US',
      hzkj_logistics_providers_id: '77', hzkj_logistics_providers_name: 'Carrier',
    }, context)
    expect(result.amount).toBe('12.34567890123456789012')
    expect(result.currency_code).toBe('CNY')
    expect(result.occurred_at).toBe('2026-11-01T04:00:00.000Z')
    expect(result.facts.amountCurrencies.actualFreight).toBe('CNY')
    expect(result.facts.amountCurrencies.estimatedFreight).toBeNull()
    expect(result.facts.statuses).toMatchObject({ delivery: 'FULFILLED', intercept: 'CANCELLED' })
    expect(result.facts.sourceLinks).toContainEqual(expect.objectContaining({ entityType: 'fulfillment', documentNumber: 'ORDER-1', verified: false }))
    expect(result.owner_employee_id).toBeNull()
    expect(result.facts.carrier).toMatchObject({ id: '77' })
  })

  it('retains receipt header and line amounts separately and does not assume refund signs or source ownership', () => {
    const raw = { ...identity, org_id: '100000', hzkj_src_type: 'A', hzkj_src_bill: 'ORDER-1', hzkj_receive_type: 'D',
      hzkj_rec_amount: '97', hzkj_receive_amount: '100', hzkj_total_payable: '103', hzkj_receive_status: 'B',
      hzkj_receive_time: '2026-11-12 08:00:00', hzkj_availableon: '2026-11-13',
      entryentity: [{ id: '5', hzkj_src_order: 'ORDER-1', hzkj_entry_src_type: 'A', hzkj_real_receive_amt: '97', hzkj_samount: '100', hzkj_ramount: '3', hzkj_freight: '10', hzkj_amountfield: '85', hzkj_fixed_tax_fee: '5' }] }
    const result = normalizeCollectedAnalyticsFact('receipt', raw, context)
    expect(result.facts.amounts).toMatchObject({ receiptAmount: '97', receiptOrderAmount: '100', customerPayable: '103' })
    expect(result.facts.lines[0].amounts).toMatchObject({ receivedAmount: '97', orderAmount: '100', refundAmount: '3', freightAmount: '10', productAmount: '85', fixedTaxFee: '5' })
    expect(result.facts.statuses.receiveType).toBe('D')
    expect(result.amount).toBeNull()
    expect(result.customer_id).toBeNull()
    expect(result.owner_employee_id).toBeNull()
    expect(result.paid_at).toBe('2026-11-12T00:00:00.000Z')
    expect(result.raw).toEqual(raw)
    expect(result.facts.sourceLinks).toContainEqual(expect.objectContaining({ lineId: '5', entityType: 'fulfillment', documentNumber: 'ORDER-1' }))
  })

  it('keeps purchase payment and shipment states separate and preserves exact source-line links', () => {
    const result = normalizeCollectedAnalyticsFact('purchase', {
      ...identity, hzkj_actual_amount: '200.01', hzkj_pay_time: '2026-11-02T00:00:00Z',
      hzkj_pay_status: '1', hzkj_paystatus: 'B', hzkj_ship_status: '0', hzkj_logisticsstatus: 'B',
      hzkj_billentry: [{ id: '25', hzkj_qty: '3', hzkj_salbillid: '901', hzkj_salbillnumber: 'ORDER-1', hzkj_salbillentryid: '81', hzkj_deliverdate: '2026-11-10', hzkj_transportqty: '1', hzkj_invqty: '0' }],
    }, context)
    expect(result.facts.statuses).toMatchObject({ payment: '1', standardPayment: 'B', shipment: '0', logistics: 'B' })
    expect(result.facts.amounts.actualPayment).toBe('200.01')
    expect(result.paid_at).toBe('2026-11-02T00:00:00.000Z')
    expect(result.facts.sourceLinks).toContainEqual(expect.objectContaining({ sourceId: '901', documentNumber: 'ORDER-1', sourceLineId: '81', lineId: '25' }))
    expect(result.facts.lines[0].quantities).toMatchObject({ quantity: '3', transportedQuantity: '1', inboundQuantity: '0' })
    expect(result.facts.lines[0].dates.deliveryAt.precision).toBe('day')
  })

  it('preserves finite native dispatch decimal amounts without inventing missing values', () => {
    const result = normalizeCollectedAnalyticsFact('dispatch', { ...identity, org_id: '100000', hzkj_actual_freight: 0.1, hzkj_textfield1: 'USD', hzkj_estimate_freight: 'NaN' }, context)
    expect(result.amount).toBe('0.1')
    expect(result.facts.amounts.estimatedFreight).toBeNull()
    expect(result.quantity).toBeNull()
    expect(result.facts.currencyAggregationAllowed).toBe(true)
    expect(result.facts.missingFields).not.toContain('actualFreight')
  })

  it.each([
    ['C', 'NORMAL', true], ['C', 'CANCELLED', true], ['C', null, true], ['C', 'PENDING', true], ['A', 'NORMAL', false],
  ])('recognizes confirmed cost independently from interception (%s/%s)', (billstatus, intercept, eligible) => {
    const result = normalizeCollectedAnalyticsFact('dispatch', { ...identity, org_id: '100000', billstatus, hzkj_ship_block_state: intercept,hzkj_actual_freight:'3.25',hzkj_textfield1:'RMB',hzkj_actual_freight_time:'2026-11-01 12:00:00' }, context)
    expect(result.facts.businessEligible).toBe(eligible)
    expect(result.facts.sourceOwnershipVerified).toBe(false)
    expect(result.facts.effective).toBe(false)
  })
  it('maps dispatch native ownership and dimensions',()=>{
    const r=normalizeCollectedAnalyticsFact('dispatch',{...identity,hzkj_bizoperator_id:'123',hzkj_sale_org_id:'321',hzkj_basedatafield_number:'WH1',hzkj_logistics_channel1_name:'实际中文渠道',hzkj_logistics_orderno:'TRACK',hzkj_actual_freight:'2.5',hzkj_textfield1:'RMB',entryentity:[{id:'12',hzkj_qty:2,hzkj_local_sku_number:'SKU'}]},context)
    expect(r.currency_code).toBe('CNY')
    expect(r.facts.sourceOwner.id).toBe('123')
    expect(r.facts.sourceDepartment.id).toBe('321')
    expect(r.facts.warehouse.number).toBe('WH1')
    expect(r.facts.channel.name).toBe('实际中文渠道')
    expect(r.facts.lines[0].sku.number).toBe('SKU')
  })
})
