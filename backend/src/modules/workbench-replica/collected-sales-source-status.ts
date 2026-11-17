export interface SalesSourceStatusInput {
 sourceId:string; orderNumber:string; orderStatus:string|null; hasOwnSourceStatus:boolean
 companyId:string; batchSourceAsOf:string
 capture:null|{sourceId:string; orderNumber:string; orderStatus:string|null; companyId:string; scopeVerified:boolean;
  hasSourceStatus:boolean; sourceStatus:string|null; capturedAt:string}
}
export interface SalesSourceStatus {
 source:'fulfillment_capture'; sourceId:string; orderStatus:string|null; fulfillmentStatus:string|null; capturedAt:string
}
/** Supplement only an absent field on the SAME source document. Never rewrite the original capture. */
export function salesSourceStatusFromCapture(input:SalesSourceStatusInput):SalesSourceStatus|null {
 const c=input.capture
 if(input.hasOwnSourceStatus||!c||c.scopeVerified!==true||c.hasSourceStatus!==true
  ||c.companyId!==input.companyId||c.sourceId!==input.sourceId||c.orderNumber!==input.orderNumber
  ||!input.orderStatus||c.orderStatus!==input.orderStatus)return null
 const captured=Date.parse(c.capturedAt),primary=Date.parse(input.batchSourceAsOf)
 if(!Number.isFinite(captured)||!Number.isFinite(primary)||captured<primary)return null
 return {source:'fulfillment_capture',sourceId:input.sourceId,orderStatus:input.orderStatus,
  fulfillmentStatus:c.sourceStatus,capturedAt:c.capturedAt}
}

/** Same provenance checks, independently applied to the source PAYMENT field. */
export function salesSourcePaymentStatusFromCapture(input:SalesSourceStatusInput){
 const status=salesSourceStatusFromCapture(input)
 if(!status)return null
 const {fulfillmentStatus,...provenance}=status
 return {...provenance,paymentStatus:fulfillmentStatus}
}
