import { orderTimestamp } from './order-timestamp'
export { orderTimestamp as procurementPaymentTime } from './order-timestamp'

export function supplierShipmentAging(value: unknown, now: number): 'normal' | 'warning' | 'danger' {
  const paid = orderTimestamp(value)
  if (paid === null || !Number.isFinite(now)) return 'normal'
  const elapsed = now - paid
  return elapsed > 48 * 3600000 ? 'danger' : elapsed > 24 * 3600000 ? 'warning' : 'normal'
}
