import { describe, expect, it } from 'vitest'
import { orderDispatchTaskStatus, hasDispatchSyncFailure } from '@/utils/order-dispatch-status'
import { matchesFopQueue, type FopOrder } from '@/api/fop-orders'
describe('native source shipment stage filters',()=>{
 it.each([
  ['paid','unfulfilled',false,'dispatch_pending',true,false],
  ['processing','unfulfilled',false,'dispatch_pending',true,false],
  ['processing','partial',true,'dispatch_tracking',true,false],
  ['fulfillment_cancelled','unfulfilled',true,'dispatch_cancelled',false,false],
  ['partial_fulfilled','fulfilled',true,'dispatch_synced',false,true],
  ['fulfilled','fulfilled',true,'dispatch_synced',false,true],
  ['fulfilled','unfulfilled',false,'dispatch_pending',true,false],
  ['processing','fulfilled',true,'dispatch_synced',false,true],
  ['fulfilled',undefined,true,'unknown',false,false],
 ] as const)('classifies %s with independent source shipment %s', (state,sourceShipment,tracked,expected,pending,completed)=>{
  const row={reviewStatus:'approved',businessStatus:{order:state,sourceShipment},logisticsInfo:[{packageTrackingNumber:tracked?'TRACK':null}],dispatchDocuments:[{number:"FY1",association:{state:'verified'},trackingNumbers:tracked?[{type:'full',number:'TRACK'}]:[]}]} as unknown as FopOrder
  expect(orderDispatchTaskStatus(row)).toBe(expected)
  expect(matchesFopQueue(row,'dispatch')).toBe(pending)
  expect(matchesFopQueue(row,'dispatch',undefined,true)).toBe(completed)
 })
})

it('shows sync failure alongside its normal dispatch phase, then removes it after a successful native update',()=>{
 const row={reviewStatus:'approved',businessStatus:{order:'processing',sourceShipment:'unfulfilled'},exception:null,logisticsInfo:[{packageTrackingNumber:'TRACK'}],dispatchDocuments:[{number:"FY1",deliveryStatus:'SYNC_FAILED',trackingNumbers:[{type:'full',number:'TRACK'}]}]} as unknown as FopOrder
 expect(hasDispatchSyncFailure(row)).toBe(true)
 expect(matchesFopQueue(row,'exceptions')).toBe(true)
 expect(matchesFopQueue(row,'dispatch')).toBe(true)
 row.businessStatus!.order='fulfilled'
 expect(matchesFopQueue(row,'dispatch')).toBe(true)
 expect(matchesFopQueue(row,'dispatch',undefined,true)).toBe(false)
 row.businessStatus!.sourceShipment='fulfilled'
 expect(matchesFopQueue(row,'dispatch',undefined,true)).toBe(true)
 row.dispatchDocuments![0].deliveryStatus='FULFILLED'
 expect(hasDispatchSyncFailure(row)).toBe(false)
 expect(matchesFopQueue(row,'exceptions')).toBe(false)
 expect(matchesFopQueue(row,'dispatch',undefined,true)).toBe(true)
})

it.each(['fulfilled','partial_fulfilled'])('keeps native %s visible with a missing-tracking exception and recovers on writeback', state=>{
 const row={reviewStatus:'approved',businessStatus:{order:state,sourceShipment:'fulfilled'},exception:null,logisticsInfo:[{packageTrackingNumber:'  ',shopifyTracking:{type:'full',number:'STALE'}}],dispatchDocuments:[{number:"FY1",deliveryStatus:'FULFILLED',trackingNumbers:[{type:'full',number:'OLD'}]}]} as unknown as FopOrder
 expect(matchesFopQueue(row,'dispatch',undefined,true)).toBe(true)
 expect(matchesFopQueue(row,'exceptions')).toBe(true)
 expect(matchesFopQueue(row,'dispatch')).toBe(false)
 row.logisticsInfo![0].packageTrackingNumber='CURRENT'
 expect(matchesFopQueue(row,'dispatch',undefined,true)).toBe(true)
 expect(matchesFopQueue(row,'exceptions')).toBe(false)
})

it.each([undefined,null,[],[{type:'full',number:' \t\n'}],[{type:'last_mile',number:'TAIL'}]].map(trackingNumbers=>({trackingNumbers})))('routes obtained tracking with missing current full number to dispatch exceptions: %j',({trackingNumbers})=>{
 const row={reviewStatus:'approved',businessStatus:{order:'processing',sourceShipment:'unfulfilled'},exception:null,dispatchDocuments:[{number:"FY1",deliveryStatus:'TRACKING_OBTAINED',trackingNumbers}]} as unknown as FopOrder
 expect(matchesFopQueue(row,'dispatch')).toBe(true)
 expect(matchesFopQueue(row,'exceptions')).toBe(true)
 row.dispatchDocuments![0].trackingNumbers=[{type:'full',number:'CURRENT'}]
 expect(matchesFopQueue(row,'exceptions')).toBe(false)
 expect(matchesFopQueue(row,'dispatch')).toBe(true)
 expect(orderDispatchTaskStatus(row)).toBe('dispatch_tracking')
})
it('does not borrow another dispatch number and ignores cancelled or unverified claims',()=>{
 const broken={deliveryStatus:'TRACKING_OBTAINED',trackingNumbers:[]}
 const good={deliveryStatus:'TRACKING_OBTAINED',trackingNumbers:[{type:'full',number:'OTHER'}]}
 const row={reviewStatus:'approved',businessStatus:{order:'processing',sourceShipment:'unfulfilled'},exception:null,dispatchDocuments:[broken,good]} as unknown as FopOrder
 expect(matchesFopQueue(row,'exceptions')).toBe(true)
 row.dispatchDocuments![0]={...broken,rawInterceptStatus:'CANCELLED'} as any
 expect(matchesFopQueue(row,'exceptions')).toBe(false)
 row.dispatchDocuments![0]={...broken,association:{state:'unresolved'}} as any
 expect(matchesFopQueue(row,'exceptions')).toBe(false)
})
it('keeps genuinely pending unnumbered dispatches in normal work, but rejects tail-only obtained display',()=>{
 const row={reviewStatus:'approved',businessStatus:{order:'processing',sourceShipment:'unfulfilled'},exception:null,dispatchDocuments:[{number:"FY1",deliveryStatus:'PENDING',trackingNumbers:[]}]} as unknown as FopOrder
 expect(matchesFopQueue(row,'dispatch')).toBe(true)
 expect(matchesFopQueue(row,'exceptions')).toBe(false)
 row.dispatchDocuments![0].trackingNumbers=[{type:'last_mile',number:'TAIL'}]
 expect(matchesFopQueue(row,'dispatch')).toBe(true)
 expect(matchesFopQueue(row,'exceptions')).toBe(true)
})

it('distinguishes confirmed absence from created dispatch without tracking',()=>{
 expect(orderDispatchTaskStatus({businessStatus:{order:'paid',sourceShipment:'unfulfilled'},dispatchDocuments:[]})).toBe('dispatch_missing')
 expect(orderDispatchTaskStatus({businessStatus:{order:'paid',sourceShipment:'unfulfilled'},dispatchDocuments:[{number:'FY1',trackingNumbers:[]}]})).toBe('dispatch_pending')
 expect(orderDispatchTaskStatus({businessStatus:{order:'paid',sourceShipment:'unfulfilled'}})).toBe('unknown')
})

it('routes cancelled fulfillment to order exceptions',()=>{
 const row={businessStatus:{order:'fulfillment_cancelled'},reviewStatus:'approved'} as unknown as FopOrder
 expect(matchesFopQueue(row,'dispatch')).toBe(false)
 expect(matchesFopQueue(row,'exceptions')).toBe(true)
})
