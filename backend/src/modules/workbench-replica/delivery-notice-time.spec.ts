import { deliveryNoticeWmsTime } from './delivery-notice-time'
it('uses the latest approved delivery notice and ignores unapproved notices',()=>{
 expect(deliveryNoticeWmsTime([{billstatus:'C',auditdate:'2026-11-17T08:00:00+08:00'},{billstatus:'C',auditdate:'2026-11-18T08:00:00+08:00'},{billstatus:'A',auditdate:'2026-11-19T08:00:00+08:00'}])).toBe('2026-11-18T00:00:00.000Z')
})
it('does not invent missing approval times',()=>expect(deliveryNoticeWmsTime([{billstatus:'C',auditdate:null}])).toBeNull())
