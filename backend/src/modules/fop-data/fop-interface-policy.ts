/** Confirmed 2026-11-19 API consolidation. Applies to configured URLs as well as defaults. */
const retired = new Set(['queryOrderDetail','auditWorkbenchAllocation','queryOutbound','queryPurchaseMaterialReturn','queryReceiptAdjustment','queryWorkbenchInventoryBalance'])
export function assertActiveFopEndpoint(endpoint: URL): void {
 const path=endpoint.pathname.replace(/\/+$/,'')
 if(retired.has(path.split('/').pop()!) || ['/employee-stock/inventory','/employee-orders/allocation-inventory'].some(s=>path.endsWith(s))) throw new Error('fop_retired_endpoint: '+path)
}
