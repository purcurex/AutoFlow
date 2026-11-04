import { normalizeBusinessTimestamp } from './fop-business-time'

/** C端付款时间按履约订单的源单付款时间传入；不得回退到FOP创建时间或收款日期。 */
export function normalizeConsumerPaidAt(value: unknown): string | null {
  return normalizeBusinessTimestamp(value)
}
