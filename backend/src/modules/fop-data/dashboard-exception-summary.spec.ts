import {dashboardExceptionSummary} from './dashboard-exception-summary'
const base:any={orderNumber:'TO1',customerName:'Customer',reviewStatus:'approved',exception:null,businessStatus:{order:'fulfilled'},logisticsInfo:[]}
it('derives a native dispatch exception without dereferencing a missing persisted summary',()=>{
 expect(dashboardExceptionSummary(base)).toMatchObject({id:'TO1',type:'dispatch_exception',reason:'履约订单物流信息待核验',hours:null})
})
it('distinguishes an explicitly empty package number from an uncollected package field',()=>{
 expect(dashboardExceptionSummary({...base,logisticsInfo:[{packageTrackingNumber:null}]}).reason).toBe('履约订单物流跟踪号为空')
})
it('preserves source exception facts and does not change the normal lifecycle',()=>{
 const row={...base,exception:{type:'purchase_exception',reason:'采购付款状态为空',hours:2}}
 expect(dashboardExceptionSummary(row)).toMatchObject({type:'purchase_exception',reason:'采购付款状态为空',hours:2})
 expect(row.businessStatus.order).toBe('fulfilled')
})
it('uses the established cancellation reason without inventing a sync failure',()=>{
 expect(dashboardExceptionSummary({...base,businessStatus:{order:'fulfillment_cancelled'}})).toMatchObject({type:'logistics_exception',reason:'取消履约'})
})
it('describes a fulfilled/native sync failure as a state conflict',()=>{
 expect(dashboardExceptionSummary({...base,dispatchDocuments:[{deliveryStatus:'SYNC_FAILED',association:{state:'verified'}}]}).reason).toContain('发运审核同步状态与履约状态不一致')
})
