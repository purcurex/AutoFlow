import { normalizeBusinessTimestamp } from './fop-business-time'

/** A trusted gateway supplies the first completed consumer payment event.
 * Never substitute FOP creation/receipt time or Shopify order.processed_at. */
export function normalizeConsumerPaidAt(value: unknown): string | null {
  return normalizeBusinessTimestamp(value)
}
