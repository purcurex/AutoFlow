import { matchesFopQueue, type FopOrder, type FopOrderQueue } from './fop-orders'

// Synthetic product illustrations; no real customer/product data is copied from the reference screenshot.
const products = [
  { name: '便携蓝牙音箱 / Portable speaker', variant: 'Q12 · 蓝色 / Blue', image: 'speaker', color: '#8bb6db' },
  { name: '保温随行杯 / Travel tumbler', variant: '500ml · 奶油白 / Cream', image: 'cup', color: '#d5c4aa' },
  { name: '无线耳机 / Wireless earbuds', variant: 'USB-C · 白色 / White', image: 'earbuds', color: '#b5b9c7' },
]
function productImage(kind: string, color: string) {
  const shape = kind === 'speaker'
    ? `<rect x="22" y="16" width="36" height="48" rx="10" fill="${color}"/><circle cx="40" cy="40" r="12" fill="#fff" opacity=".6"/><circle cx="40" cy="40" r="7" fill="#39465c"/>`
    : kind === 'cup'
      ? `<path d="M25 22h30l-4 43H29z" fill="${color}"/><rect x="23" y="17" width="34" height="8" rx="3" fill="#455369"/><path d="M39 18V9" stroke="#455369" stroke-width="4"/>`
      : `<rect x="17" y="35" width="46" height="30" rx="12" fill="${color}"/><path d="M18 45h44" stroke="#fff"/><rect x="25" y="14" width="10" height="26" rx="5" fill="#fff" stroke="${color}"/><rect x="45" y="14" width="10" height="26" rx="5" fill="#fff" stroke="${color}"/>`
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" rx="12" fill="#f0f3f7"/>${shape}</svg>`)}`
}

const stages = ['review', 'allocation', 'dispatch', 'shipping'] as const
const counts = [6, 12, 19, 28]
export const mockFopOrders: FopOrder[] = stages.flatMap((stage, stageIndex) => Array.from({ length: counts[stageIndex]! }, (_, index) => {
  const product = products[index % products.length]!
  const orderNumber = index === 0 && stage !== 'shipping'
    ? ({ review: 'DEMO-SO-10256', allocation: 'DEMO-SO-10241', dispatch: 'DEMO-SO-10283' } as const)[stage]
    : `DEMO-SO-${20000 + stageIndex * 100 + index}`
  const exception: FopOrder['exception'] = index === 0 && stage !== 'shipping'
    ? { reason: stage === 'review' ? 'address' : stage === 'allocation' ? 'stock' : 'tracking', hours: stage === 'review' ? 26 : stage === 'allocation' ? 38 : 18 }
    : null
  const paid = stage !== 'review' || index % 3 !== 2
  return {
    id: orderNumber, orderNumber, shopifyOrderNumber: `#${1001 + stageIndex * 100 + index}`,
    customerName: ['Everyday Goods', 'Northstar Store', 'Studio Market', 'Harbor Goods'][stageIndex]! + (index ? ` ${index + 1}` : ''),
    storeName: ['Everyday', 'Northstar', 'Studio', 'Harbor'][stageIndex]!,
    items: [{ sku: `DEMO-SKU-${String(index % 3 + 1).padStart(3, '0')}`, name: product.name, imageUrl: productImage(product.image, product.color), variant: product.variant, quantity: index % 3 + 1 }],
    amount: Math.round((11.88 + index * 2.5) * 100) / 100, currency: 'USD', paymentStatus: paid ? 'paid' : 'unpaid',
    dispatchDocuments: stage === 'dispatch'
      ? [{ id: `${orderNumber}:dispatch:1`, number: `FY-${stageIndex}-${index}-1`, status: (['draft', 'submitted', 'approved'] as const)[index % 3]! },
        ...(index % 4 === 0 ? [{ id: `${orderNumber}:dispatch:2`, number: `FY-${stageIndex}-${index}-2`, status: 'approved' as const }] : [])]
      : stage === 'shipping' ? [{ id: `${orderNumber}:dispatch:1`, number: `FY-${stageIndex}-${index}-1`, status: 'approved' }] : [],
    procurementProgress: { purchaseOrder: stage === 'review' ? 'unknown' : 'ordered', supplierPayment: stage === 'review' ? 'unknown' : 'paid' },
    fulfillmentProgress: {
      shopifySync: stage === 'dispatch' ? 'pending' : 'synced',
      supplierShipment: 'shipped',
      stockReadiness: stage === 'review' ? 'unknown' : stage === 'allocation' && index % 2 === 0 ? 'incomplete' : 'ready',
      allocationReview: stage === 'allocation' || stage === 'review' ? 'pending' : 'approved',
      outbound: stage === 'shipping' ? 'pending' : 'unknown',
    },
    reviewStatus: stage === 'review' ? 'pending' : 'approved',
    procurementStatus: stage === 'review' ? 'not_required' : 'purchased',
    allocationStatus: stage === 'review' ? 'not_ready' : stage === 'allocation' ? 'pending' : 'allocated',
    dispatchStatus: stageIndex < 2 ? 'not_ready' : stage === 'dispatch' ? 'pending' : 'dispatched',
    shippingStatus: stage === 'shipping' ? 'pending' : 'not_ready',
    warehouse: index % 2 ? 'Sha Tin' : 'Hangzhou', carrier: stage === 'shipping' ? 'Demo Express' : null,
    trackingNumber: stage === 'shipping' ? `DEMO-TRK-${30000 + index}` : null,
    salesperson: ['业务员 A', '业务员 B', '业务员 C'][index % 3]!,
    createdAt: `2026-10-${String(15 + index % 7).padStart(2, '0')}T08:30:00Z`,
    paidAt: paid ? `2026-10-${String(15 + index % 7).padStart(2, '0')}T09:00:00Z` : null,
    cancelled: false, exception,
  }
}))

mockFopOrders.push(...Array.from({ length: 8 }, (_, index): FopOrder => ({
  ...mockFopOrders[6 + index]!, id: `DEMO-PO-${40001 + index}`, orderNumber: `DEMO-PO-${40001 + index}`,
  procurementProgress: ([
    { purchaseOrder: 'not_ordered', supplierPayment: 'not_required' },
    { purchaseOrder: 'partial', supplierPayment: 'paid' },
    { purchaseOrder: 'ordered', supplierPayment: 'unpaid' },
    { purchaseOrder: 'ordered', supplierPayment: 'partial' },
    { purchaseOrder: 'ordered', supplierPayment: 'paid' },
    { purchaseOrder: 'ordered', supplierPayment: 'paid' },
    { purchaseOrder: 'ordered', supplierPayment: 'refunded' },
    { purchaseOrder: 'unknown', supplierPayment: 'unknown' },
  ] as const)[index]!,
  fulfillmentProgress: { shopifySync: 'synced', supplierShipment: index === 5 ? 'partial' : 'pending', stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'pending' },
  shopifyOrderNumber: `#${1401 + index}`, procurementStatus: 'pending', allocationStatus: 'not_ready', exception: null,
})))

// These records deliberately never enter a pending queue.
mockFopOrders.push(
  { ...mockFopOrders[6]!, id: 'DEMO-CANCELLED', orderNumber: 'DEMO-CANCELLED', cancelled: true, exception: null },
  { ...mockFopOrders[40]!, id: 'DEMO-SHIPPED', orderNumber: 'DEMO-SHIPPED', fulfillmentProgress: { shopifySync: 'synced', supplierShipment: 'shipped', stockReadiness: 'ready', allocationReview: 'approved', outbound: 'completed' }, shippingStatus: 'shipped', exception: null },
)

export function mockFopQueueCount(queue: FopOrderQueue): number {
  return mockFopOrders.filter(order => matchesFopQueue(order, queue)).length
}
