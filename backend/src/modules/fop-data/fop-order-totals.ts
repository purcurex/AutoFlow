import type { FopOrder } from './fop-data.types'

export function moneyToCents(value: number): number {
  const [digits, exponent = '0'] = Math.abs(value).toString().split('e')
  return Math.round(Number(`${digits}e${Number(exponent) + 2}`)) * Math.sign(value)
}

/** Call only after authorization and all list filters, before pagination. */
export function summarizeFopOrders(orders: readonly FopOrder[]) {
  const cents = new Map<string, number>()
  let itemQuantity = 0
  for (const order of orders) {
    const currency = order.currency?.trim().toUpperCase() || 'USD'
    // Match the two-decimal amounts displayed in the order list.
    const amount = moneyToCents(order.amount)
    cents.set(currency, (cents.get(currency) ?? 0) + amount)
    itemQuantity += order.items.reduce((sum, item) => sum + item.quantity, 0)
  }
  return {
    orderCount: orders.length,
    itemQuantity,
    amountsByCurrency: [...cents.entries()]
      .sort(([a], [b]) => a === b ? 0 : a === 'USD' ? -1 : b === 'USD' ? 1 : a.localeCompare(b))
      .map(([currency, amount]) => ({ currency, amount: amount / 100 })),
  }
}
