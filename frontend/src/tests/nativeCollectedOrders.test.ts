import { describe,it,expect } from 'vitest'
import { matchesFopQueue, type FopOrder } from '@/api/fop-orders'
import { matchesCompletedQueue } from '@/utils/completed-orders'
import { getDispatchCompletionStatus, getTaskStatus } from '@/utils/workbench-status'
const row=(patch:Partial<FopOrder>={})=>({paymentStatus:'paid',reviewStatus:'approved',cancelled:false,dataQuality:{mode:'collected',readOnly:true,missingFields:[],reasons:['native_parent_capture']},nativeFactsCaptured:true,nativeProcurementCaptured:true,fulfillmentProgress:{supplierShipment:'unknown',shopifySync:'unknown'},...patch} as FopOrder)
describe('native collected memberships',()=>{
 it('keeps blank/new dispatch state out of completion, accepting explicit native fulfillment',()=>{expect(matchesCompletedQueue(row({dispatchTaskStatus:'unknown'}),'dispatch')).toBe(false);expect(matchesFopQueue(row({dispatchTaskStatus:'unknown'}),'dispatch')).toBe(false);expect(matchesCompletedQueue(row({dispatchTaskStatus:'dispatch_synced'}),'dispatch')).toBe(true);expect(matchesFopQueue(row({dispatchTaskStatus:'dispatch_pending'}),'dispatch')).toBe(true)})
 it('accepts parent-derived procurement stages without inventing optional header status',()=>{const p=row({sourcePurchaseStatus:null,procurementStage:'supplier_pending'});expect(matchesFopQueue(p,'procurement_shipping')).toBe(true);expect(getTaskStatus(p,'procurement_shipping')).toBe('supplier_pending');expect(matchesCompletedQueue(row({procurementStage:'shipped'}),'procurement')).toBe(true)})
 it('requires allocated ready native evidence for pending outbound',()=>{expect(matchesFopQueue(row({nativeShippingReady:true,sourceOutboundStatus:'0'}),'shipping')).toBe(true);expect(matchesFopQueue(row({nativeShippingReady:false,sourceOutboundStatus:'0'}),'shipping')).toBe(false);expect(matchesFopQueue(row({nativeShippingReady:true,sourceOutboundStatus:'0'}),'shipping','pending_review')).toBe(false)})
})

it('allocation completion excludes confirmed cancellations and invalid links',()=>{
 const approved={id:'1',number:'D1',status:'approved'} as const
 expect(getDispatchCompletionStatus([approved])).toBe('dispatch_complete')
 expect(getDispatchCompletionStatus([{...approved,rawInterceptStatus:'CANCELLED'}] as any)).toBe('dispatch_incomplete')
 expect(getDispatchCompletionStatus([{...approved,association:{state:'conflict'}}] as any)).toBe('dispatch_incomplete')
 expect(getDispatchCompletionStatus([approved,{...approved,id:'2',status:'draft',rawInterceptStatus:'CANCELLED'}] as any)).toBe('dispatch_complete')
 expect(getDispatchCompletionStatus([approved,{...approved,id:'2',status:'draft'}])).toBe('dispatch_incomplete')
 expect(getDispatchCompletionStatus([])).toBe('dispatch_incomplete')
})
