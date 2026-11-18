import type {FopOrder} from './fop-data.types'
import {hasDispatchSyncFailure,hasMissingObtainedTracking,hasMissingFulfilledTracking,dispatchSyncFailureReason,missingObtainedTrackingReason,missingFulfilledTrackingReason} from './order-dispatch-status'

/** Native queue classification can identify an exception before a legacy summary exists. */
export function dashboardExceptionSummary(order:FopOrder){
 const identity={id:order.orderNumber,customer:order.customerName}
 if(order.exception)return {...identity,...order.exception}
 if(order.businessStatus?.order==='fulfillment_cancelled')return {...identity,type:'logistics_exception' as const,reason:'取消履约',hours:null}
 const reasons:string[]=[]
 if(hasDispatchSyncFailure(order))reasons.push(['fulfilled','partial_fulfilled'].includes(order.businessStatus?.order??'')?'发运审核同步状态与履约状态不一致':dispatchSyncFailureReason)
 if(hasMissingObtainedTracking(order))reasons.push(missingObtainedTrackingReason)
 if(hasMissingFulfilledTracking(order))reasons.push(order.logisticsInfo?.some(group=>Object.prototype.hasOwnProperty.call(group,'packageTrackingNumber'))?missingFulfilledTrackingReason:'履约订单物流信息待核验')
 return {...identity,type:reasons.length?'dispatch_exception' as const:null,reason:reasons.length?reasons.join('；'):null,hours:null}
}
