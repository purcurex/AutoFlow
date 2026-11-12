import { expect, it } from 'vitest'
import { mockFopOrders } from '@/api/fop-order-fixtures'
it('paid and Shopify-synced fulfillment fixtures have a selected carrier and channel', () => {
  for (const order of mockFopOrders.filter(o => o.paymentStatus === 'paid' || o.fulfillmentProgress.shopifySync === 'synced')) {
    expect(order.carrier, order.orderNumber).toBeTruthy()
    expect(order.logisticsChannels?.length, order.orderNumber).toBeGreaterThan(0)
    expect(order.logisticsChannels?.every(c => c.name && c.code)).toBe(true)
    if (order.fulfillmentProgress.shopifySync === 'synced') expect(order.paymentStatus).toBe('paid')
  }
})

it('dispatch approval requires tracking before Shopify sync, and sync requires approved dispatches', () => {
  for (const order of mockFopOrders) {
    const docs = order.dispatchDocuments ?? []
    if (order.fulfillmentProgress.shopifySync === 'synced') {
      expect(docs.length, order.orderNumber).toBeGreaterThan(0)
      expect(docs.every(d => d.status === 'approved'), order.orderNumber).toBe(true)
    }
    docs.forEach((doc, index) => {
      if (doc.status === 'approved') expect(order.logisticsInfo?.[index]?.shopifyTracking?.number, doc.number).toBeTruthy()
    })
  }
})

it('pending review fixtures have channel choices without tracking numbers', () => {
  const pending = mockFopOrders.filter(order => order.paymentStatus === 'paid' && order.reviewStatus === 'pending')
  expect(pending.length).toBeGreaterThan(0)
  for (const order of pending) {
    expect(order.customLogisticsChannelName).toBeTruthy()
    expect(order.logisticsChannels?.length).toBeGreaterThan(0)
    expect(order.trackingNumber).toBeFalsy()
    expect(order.logisticsInfo?.some(group => group.shopifyTracking?.number || group.trackingNumbers?.length)).toBeFalsy()
  }
})
