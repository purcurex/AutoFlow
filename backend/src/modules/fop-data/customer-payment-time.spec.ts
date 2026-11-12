import { buildCustomerPaymentIndex, customerPaymentKey } from './customer-payment-time'

type Row = Record<string, unknown>
const line = (overrides: Row = {}): Row => ({ id: 'line-1', hzkj_src_order: 'TO00001', hzkj_entry_src_type: 'A', hzkj_real_receive_amt: '10.25', ...overrides })
const receipt = (overrides: Row = {}): Row => ({
  org_id: '100000', id: 'receipt-1', billstatus: 'C', hzkj_void_status: '0', hzkj_receive_status: 'B',
  hzkj_receive_time: '2026-11-01T09:30:00+08:00', hzkj_receive_type: 'A', hzkj_src_type: 'A', entryentity: [line()], ...overrides,
})
const key = '["100000","A","TO00001"]'

describe('customer last payment completion from actual FOP receipt entries', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-10T12:00:00Z')) })
  afterEach(() => jest.useRealTimers())

  it('normalizes a completed positive actual receipt to a canonical instant', () => {
    expect([...buildCustomerPaymentIndex([receipt()], ['100000'])]).toEqual([[key, '2026-11-01T01:30:00.000Z']])
  })

  it('keeps exact bill numbers and separates source types and organizations', () => {
    const index = buildCustomerPaymentIndex([
      receipt(),
      receipt({ id: 'receipt-2', entryentity: [line({ hzkj_entry_src_type: 'B' })], hzkj_receive_time: '2026-11-02T00:00:00Z' }),
      receipt({ id: 'receipt-3', org_id: '100001', entryentity: [line({ hzkj_src_order: '00001' })] }),
      receipt({ id: 'receipt-4', entryentity: [line({ hzkj_src_order: 'TO00001-extra' })] }),
    ], ['100000', '100001'])
    expect([...index]).toEqual([
      [key, '2026-11-01T01:30:00.000Z'],
      ['["100000","B","TO00001"]', '2026-11-02T00:00:00.000Z'],
      ['["100001","A","00001"]', '2026-11-01T01:30:00.000Z'],
      ['["100000","A","TO00001-extra"]', '2026-11-01T01:30:00.000Z'],
    ])
    expect(customerPaymentKey('org|A', 'B', '0001')).toBe('["org|A","B","0001"]')
    expect(customerPaymentKey('org', 'A', 'B|0001')).not.toBe(customerPaymentKey('org|A', 'B', '0001'))
  })

  it('uses the latest successful linked payment across time zones regardless of input order', () => {
    const later = receipt({ id: 'receipt-2', hzkj_receive_time: '2026-11-02T00:00:00Z' })
    for (const rows of [[receipt(), later], [later, receipt()]]) {
      expect(buildCustomerPaymentIndex(rows, ['100000']).get(key)).toBe('2026-11-02T00:00:00.000Z')
    }
  })

  it.each([
    { hzkj_receive_status: 'A' }, { hzkj_receive_status: 'C' }, { hzkj_receive_status: undefined },
    { hzkj_void_status: '1' }, { hzkj_receive_type: 'D' }, { hzkj_receive_type: 'F' }, { hzkj_receive_type: 'unknown' },
    { entryentity: [line({ hzkj_real_receive_amt: '0' })] }, { entryentity: [line({ hzkj_real_receive_amt: '-10' })] },
    { entryentity: [line({ hzkj_entry_src_type: 'D' })] }, { entryentity: [line({ hzkj_entry_src_type: 'E' })] },
    { entryentity: [line({ hzkj_entry_src_type: 'F' })] },
  ])('does not let unsuccessful, void, refund, recharge or non-payment facts replace completion: %j', overrides => {
    const ignored = receipt({ id: 'receipt-2', hzkj_receive_time: '2026-11-09T00:00:00Z', ...overrides })
    expect([...buildCustomerPaymentIndex([receipt(), ignored], ['100000'])]).toEqual([[key, '2026-11-01T01:30:00.000Z']])
  })

  it('uses explicit entry source types and only falls back to header type when entry type is blank', () => {
    const index = buildCustomerPaymentIndex([receipt({ hzkj_src_type: 'B', entryentity: [
      line({ id: '1', hzkj_src_order: 'ST001', hzkj_entry_src_type: '' }),
      line({ id: '2', hzkj_src_order: 'ST002', hzkj_entry_src_type: null }),
      line({ id: '3', hzkj_src_order: 'TO001', hzkj_entry_src_type: 'A' }),
      line({ id: '4', hzkj_src_order: 'NOT-AN-ORDER', hzkj_entry_src_type: 'unknown' }),
    ] })], ['100000'])
    expect([...index.keys()]).toEqual(['["100000","B","ST001"]', '["100000","B","ST002"]', '["100000","A","TO001"]'])
  })

  it('does not infer an entry order number from the free-text header', () => {
    expect(buildCustomerPaymentIndex([receipt({ hzkj_src_bill: 'TO00001', entryentity: [line({ hzkj_src_order: '' })] })], ['100000']).size).toBe(0)
  })

  it.each([undefined, null, '', '2026-11-01', '2026-11-01T00:00:00', '2026-02-30T00:00:00Z', '2026-11-11T00:00:00Z'])('leaves missing, invalid or future completion unknown instead of substituting other source dates: %s', hzkj_receive_time => {
    const unknown = receipt({ hzkj_receive_time, auditdate: '2026-11-02T00:00:00Z', createtime: '2026-11-03T00:00:00Z', hzkj_availableon: '2026-11-04T00:00:00Z' })
    expect(buildCustomerPaymentIndex([unknown], ['100000']).size).toBe(0)
  })

  it('does not present an earlier valid payment as the last payment when another successful payment time is unknown', () => {
    const unknown = receipt({ id: 'receipt-2', hzkj_receive_time: undefined })
    expect(buildCustomerPaymentIndex([receipt(), unknown], ['100000']).size).toBe(0)
    expect(buildCustomerPaymentIndex([unknown, receipt()], ['100000']).size).toBe(0)
  })

  it.each([{ org_id: 'other' }, { org_id: '' }, { org_id: undefined }])('rejects receipts without an authorized explicit organization: %j', overrides => {
    expect(() => buildCustomerPaymentIndex([receipt(overrides)], ['100000'])).toThrow(/organization/i)
  })

  it('rejects duplicate receipt IDs instead of choosing arbitrary completion facts', () => {
    expect(() => buildCustomerPaymentIndex([receipt(), receipt({ hzkj_receive_time: '2026-11-02T00:00:00Z' })], ['100000'])).toThrow(/duplicate/i)
  })

  it('requires a receipt identity before indexing facts', () => {
    expect(() => buildCustomerPaymentIndex([receipt({ id: '' })], ['100000'])).toThrow(/receipt/i)
  })

  it.each(['not-a-number', 'NaN', 'Infinity', '1e3', {}])('rejects malformed successful entry decimals: %s', amount => {
    expect(() => buildCustomerPaymentIndex([receipt({ entryentity: [line({ hzkj_real_receive_amt: amount })] })], ['100000'])).toThrow(/decimal/i)
  })

  it.each([50, 29.995, 26.44, 0.00001, Number.MAX_SAFE_INTEGER])('accepts native JSON number actual amounts for positivity without returning money: %s', hzkj_real_receive_amt => {
    expect([...buildCustomerPaymentIndex([receipt({ entryentity: [line({ hzkj_real_receive_amt })] })], ['100000'])]).toEqual([[key, '2026-11-01T01:30:00.000Z']])
  })

  it.each([0, -0, -50, -29.995, -Number.MAX_SAFE_INTEGER])('does not count zero or negative native JSON number amounts: %s', hzkj_real_receive_amt => {
    const ignored = receipt({ id: 'receipt-2', hzkj_receive_time: '2026-11-09T00:00:00Z', entryentity: [line({ hzkj_real_receive_amt })] })
    expect([...buildCustomerPaymentIndex([receipt(), ignored], ['100000'])]).toEqual([[key, '2026-11-01T01:30:00.000Z']])
  })

  it.each([Number.MAX_SAFE_INTEGER + 1, -Number.MAX_SAFE_INTEGER - 1, Infinity, -Infinity, NaN])('rejects unsafe or nonfinite native number actual amounts: %s', hzkj_real_receive_amt => {
    expect(() => buildCustomerPaymentIndex([receipt({ entryentity: [line({ hzkj_real_receive_amt })] })], ['100000'])).toThrow(/decimal/i)
  })

  it.each([{ id: 123 }, { org_id: 100000 }])('keeps identifier types strict when supporting numeric amounts: %j', overrides => {
    expect(() => buildCustomerPaymentIndex([receipt(overrides)], ['100000'])).toThrow()
  })

  it('uses Decimal precision for positive sub-cent amounts without rounding to zero', () => {
    expect(buildCustomerPaymentIndex([receipt({ entryentity: [line({ hzkj_real_receive_amt: '0.00000000000000000000000000000001' })] })], ['100000']).get(key)).toBe('2026-11-01T01:30:00.000Z')
  })

  it.each(['D', 'E', 'F'])('ignores unrelated source %s entries with invalid or absent amounts', hzkj_entry_src_type => {
    const unrelated = receipt({ id: 'receipt-2', hzkj_receive_time: '2026-11-09T00:00:00Z', entryentity: [
      line({ id: '1', hzkj_entry_src_type, hzkj_real_receive_amt: null }),
      line({ id: '2', hzkj_entry_src_type, hzkj_real_receive_amt: 'broken' }),
    ] })
    expect([...buildCustomerPaymentIndex([receipt(), unrelated], ['100000'])]).toEqual([[key, '2026-11-01T01:30:00.000Z']])
  })

  it('ignores entries without an exact source bill number before validating amounts', () => {
    const unrelated = receipt({ id: 'receipt-2', entryentity: [line({ hzkj_src_order: '', hzkj_real_receive_amt: 'broken' })] })
    expect([...buildCustomerPaymentIndex([receipt(), unrelated], ['100000'])]).toEqual([[key, '2026-11-01T01:30:00.000Z']])
  })

  it.each([null, undefined, '', '   '])('keeps a linked payment with absent actual amount unknown without amount fallback: %s', hzkj_real_receive_amt => {
    const unknown = receipt({ id: 'receipt-2', hzkj_receive_time: '2026-11-09T00:00:00Z', hzkj_rec_amount: '100', hzkj_receive_amount: '100',
      entryentity: [line({ hzkj_real_receive_amt, hzkj_samount: '100' })] })
    for (const rows of [[receipt(), unknown], [unknown, receipt()]]) expect(buildCustomerPaymentIndex(rows, ['100000']).size).toBe(0)
  })

  it.each(['B', 'C', 'E'])('accepts positive completed non-refund receipt type %s with explicit C source links', hzkj_receive_type => {
    expect([...buildCustomerPaymentIndex([receipt({ hzkj_receive_type, entryentity: [line({ hzkj_entry_src_type: 'C' })] })], ['100000'])]).toEqual([
      ['["100000","C","TO00001"]', '2026-11-01T01:30:00.000Z'],
    ])
  })

  it('does not authorize any receipt when the organization scope is empty', () => {
    expect(() => buildCustomerPaymentIndex([receipt()], [])).toThrow(/organization/i)
  })

  it('does not require receipt approval after payment was completed', () => {
    expect(buildCustomerPaymentIndex([receipt({ billstatus: 'A' })], ['100000']).get(key)).toBe('2026-11-01T01:30:00.000Z')
  })
})
