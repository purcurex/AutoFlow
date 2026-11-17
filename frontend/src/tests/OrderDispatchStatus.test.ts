import { describe, expect, it } from 'vitest'
import { orderDispatchTaskStatus, hasDispatchSyncFailure } from '@/utils/order-dispatch-status'
import { matchesFopQueue, type FopOrder } from '@/api/fop-orders'
describe('native fulfillment stage filters',()=>{
 it.each([['paid',false,'dispatch_pending'],['processing',false,'dispatch_pending'],['processing',true,'dispatch_tracking'],['fulfillment_cancelled',true,'dispatch_cancelled'],['partial_fulfilled',true,'dispatch_synced'],['fulfilled',true,'dispatch_synced']] as const)('classifies %s by active tracking', (state,tracked,expected)=>{
  const row={reviewStatus:'approved',businessStatus:{order:state},dispatchDocuments:[{trackingNumbers:tracked?[{type:'full',number:'TRACK'}]:[]}]} as unknown as FopOrder
  expect(orderDispatchTaskStatus(row)).toBe(expected)
  expect(matchesFopQueue(row,'dispatch')).toBe(['paid','processing','fulfillment_cancelled'].includes(state))
  expect(matchesFopQueue(row,'dispatch',undefined,true)).toBe(['partial_fulfilled','fulfilled'].includes(state))
 })
})

it('shows sync failure only in dispatch exceptions, then removes it after a successful native update',()=>{
 const row={reviewStatus:'approved',businessStatus:{order:'processing'},exception:null,dispatchDocuments:[{deliveryStatus:'SYNC_FAILED',trackingNumbers:[{type:'full',number:'TRACK'}]}]} as unknown as FopOrder
 expect(hasDispatchSyncFailure(row)).toBe(true)
 expect(matchesFopQueue(row,'exceptions')).toBe(true)
 expect(matchesFopQueue(row,'dispatch')).toBe(false)
 row.businessStatus!.order='fulfilled'
 expect(matchesFopQueue(row,'dispatch',undefined,true)).toBe(false)
 row.dispatchDocuments![0].deliveryStatus='FULFILLED'
 expect(hasDispatchSyncFailure(row)).toBe(false)
 expect(matchesFopQueue(row,'exceptions')).toBe(false)
 expect(matchesFopQueue(row,'dispatch',undefined,true)).toBe(true)
})
