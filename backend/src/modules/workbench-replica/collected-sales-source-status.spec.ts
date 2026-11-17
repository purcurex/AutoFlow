import { salesSourceStatusFromCapture } from './collected-sales-source-status'

const row = () => ({
 sourceId:'11',orderNumber:'TO11',orderStatus:'no',hasOwnSourceStatus:false,
 companyId:'100000',batchSourceAsOf:'2026-11-11T00:00:00Z',
 capture:{sourceId:'11',orderNumber:'TO11',orderStatus:'no',companyId:'100000',scopeVerified:true,
  hasSourceStatus:true,sourceStatus:'fulfilled',capturedAt:'2026-11-12T00:00:00Z'},
})
it('projects only the same fulfillment document and retains its source timestamp without changing original facts',()=>{
 const input=row(),before=structuredClone(input)
 expect(salesSourceStatusFromCapture(input)).toEqual({source:'fulfillment_capture',sourceId:'11',orderStatus:'no',fulfillmentStatus:'fulfilled',capturedAt:'2026-11-12T00:00:00Z'})
 expect(input).toEqual(before)
})
it.each([
 {sourceId:'12'},{orderNumber:'TO12'},{orderStatus:'1'},{companyId:'other'},
 {scopeVerified:false},{hasSourceStatus:false},{capturedAt:'2026-11-10T00:00:00Z'},
 {capturedAt:'invalid'},
])('rejects mismatched, missing or older same-document capture: %j',change=>{
 const input=row();Object.assign(input.capture,change);expect(salesSourceStatusFromCapture(input)).toBeNull()
})
it('does not override source status already captured on the primary document, including explicit null',()=>{
 expect(salesSourceStatusFromCapture({...row(),hasOwnSourceStatus:true})).toBeNull()
})
it('preserves explicit source null rather than manufacturing unfulfilled',()=>{
 expect(salesSourceStatusFromCapture({...row(),capture:{...row().capture,sourceStatus:null}})?.fulfillmentStatus).toBeNull()
})

import { salesSourcePaymentStatusFromCapture } from './collected-sales-source-status'
it('projects source payment with the same identity, scope and freshness guards',()=>{
 const input=row();input.capture.sourceStatus='refunded'
 expect(salesSourcePaymentStatusFromCapture(input)).toMatchObject({sourceId:'11',paymentStatus:'refunded'})
 expect(salesSourcePaymentStatusFromCapture({...input,hasOwnSourceStatus:true})).toBeNull()
 expect(salesSourcePaymentStatusFromCapture({...input,capture:{...input.capture,sourceId:'other'}})).toBeNull()
 expect(salesSourcePaymentStatusFromCapture({...input,capture:{...input.capture,capturedAt:'2020-01-01T00:00:00Z'}})).toBeNull()
})
