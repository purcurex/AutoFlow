import { normalizeBusinessTimestamp } from './fop-business-time'

/** 客户付款时间取履约订单自身的收款日期；不得回退源单、审核、创建或采购付款时间。 */
export function normalizeConsumerPaidAt(value: unknown): string | null {
  return normalizeBusinessTimestamp(value)
}
