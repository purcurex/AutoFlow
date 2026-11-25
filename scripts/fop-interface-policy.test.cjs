const {test}=require('node:test'),assert=require('node:assert/strict'),{assertActiveFopEndpoint}=require('./fop-interface-policy.cjs')
test('retired FOP endpoints cannot be called or used as fallback',()=>{
 for(const name of ['queryOrderDetail','auditWorkbenchAllocation','queryOutbound','queryPurchaseMaterialReturn','queryReceiptAdjustment','queryWorkbenchInventoryBalance','employee-stock/inventory','employee-orders/allocation-inventory']) assert.throws(()=>assertActiveFopEndpoint('https://fop.test/kapi/v2/'+name),/fop_retired_endpoint/)
})
test('canonical APIs and the local allocation inventory route remain available',()=>{
 for(const name of ['queryOrderList','queryOutboundList','queryInbound','queryReceipt','queryWorkbenchReservedStock','customer-stock/query','employee-orders/allocation-approve','allocation-inventory/query','openapi/bill-relations/query'])assert.equal(assertActiveFopEndpoint('/'+name),'/'+name)
})
