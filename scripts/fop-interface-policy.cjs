/** Confirmed FOP interface policy, 2026-11-19. Never retry a retired endpoint. */
const retired = new Set(['queryOrderDetail','auditWorkbenchAllocation','queryOutbound','queryPurchaseMaterialReturn','queryReceiptAdjustment','queryWorkbenchInventoryBalance'])
function assertActiveFopEndpoint(endpoint) {
 const path=new URL(endpoint,'https://fop.invalid').pathname.replace(/\/+$/,'')
 if(retired.has(path.split('/').pop()) || ['/employee-stock/inventory','/employee-orders/allocation-inventory'].some(s=>path.endsWith(s))) throw new Error('fop_retired_endpoint: '+path)
 return endpoint
}
module.exports={assertActiveFopEndpoint}
