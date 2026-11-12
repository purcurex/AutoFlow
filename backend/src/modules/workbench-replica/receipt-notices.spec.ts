import { receiptNoticeProgress } from './receipt-notices'

describe('receipt notice pending inbound classification', () => {
  const lines = [{ quantity: 4, inboundQuantity: 0 }, { quantity: 2, inboundQuantity: 0 }]
  it('includes shipped notices and preserves remaining quantity after partial inbound', () => {
    expect(receiptNoticeProgress('shipped', '5', lines)).toEqual({ status: 'pending', quantity: 6, inboundQuantity: 0, pendingQuantity: 6 })
    expect(receiptNoticeProgress('shipped', '10', [{ quantity: 4, inboundQuantity: 1 }])).toEqual({ status: 'partial', quantity: 4, inboundQuantity: 1, pendingQuantity: 3 })
  })
  it.each(['15', '20', '25', '30'])('excludes terminal WMS status %s', status => {
    expect(receiptNoticeProgress('shipped', status, lines)).toBeNull()
  })
  it('excludes unshipped and fully inbound notices', () => {
    expect(receiptNoticeProgress('pending', '0', lines)).toBeNull()
    expect(receiptNoticeProgress('shipped', '10', [{ quantity: 4, inboundQuantity: 4 }])).toBeNull()
  })
  it('does not turn unknown state or quantities into a pending notice', () => {
    expect(() => receiptNoticeProgress('unknown', '5', lines)).toThrow()
    expect(() => receiptNoticeProgress('shipped', null, lines)).toThrow()
    expect(() => receiptNoticeProgress('shipped', '5', [{ quantity: 4, inboundQuantity: null }])).toThrow()
    expect(() => receiptNoticeProgress('shipped', '5', [])).toThrow()
    expect(() => receiptNoticeProgress('shipped', '5', [{ quantity: 1, inboundQuantity: 2 }])).toThrow()
  })
})
