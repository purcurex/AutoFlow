import { receiptLogistics } from './receipt-logistics'
describe('receipt notice logistics', () => {
 it('keeps separate parcels paired and interprets FOP time as Beijing time', () => {
  const result=receiptLogistics([{id:'1',number:'SH1',shippedAt:'2026-11-17 15:45:18',carrier:'申通快递',trackingNumber:'YT1'},{id:'2',number:'SH2',shippedAt:null,carrier:'顺丰',trackingNumber:'SF2'}])
  expect(result[0]).toEqual({noticeId:'1',noticeNumber:'SH1',shippedAt:'2026-11-17T07:45:18.000Z',carrier:'申通快递',trackingNumber:'YT1'})
  expect(result[1].trackingNumber).toBe('SF2');expect(result[1].shippedAt).toBeNull()
 })
 it('deduplicates notice links and leaves absent facts empty', () => {
  expect(receiptLogistics([{id:'1'},{id:'1'}])).toEqual([{noticeId:'1',noticeNumber:null,shippedAt:null,carrier:null,trackingNumber:null}])
 })
})
