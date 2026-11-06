import type { FopIdentity, FopOrderCandidate } from './fop-data.types'
import { rmaCaseTypes, type RmaCaseCandidate, type RmaCaseType } from './rma-orders'
export function demoRmaCases(identity: FopIdentity, orders: FopOrderCandidate[], anchor: number): RmaCaseCandidate[] {
  const rows: RmaCaseCandidate[] = []
  const stages: Record<RmaCaseType, string[]> = { refund: ['退款待审核', '退款处理中'], return_refund: ['等待客户退货', '退货待入库'], interception: ['拦截申请处理中', '等待仓库确认'], cancellation: ['取消申请待审核', '取消处理中'], reshipment: ['补发待审核', '补发待发货'], interception_release: ['拦截取消处理中', '拦截已取消'] }
  for (const [index, order] of orders.filter(row => row.owner && row.department).slice(0, 32).entries()) {
    const primary = rmaCaseTypes[index % rmaCaseTypes.length]
    const tags = (['interception', 'cancellation', 'interception_release'] as const).filter(type => type !== primary)
    const kinds: RmaCaseType[] = index % 7 === 0 ? [primary, tags[index % tags.length]] : [primary]
    for (const [n, type] of kinds.entries()) {
      const isOpen = index % 5 !== 4
      rows.push({ id: `${order.id}:rma:${n}`, tenantId: identity.tenantId, orderId: order.id, number: `RMA20261105${String(index * 2 + n + 1).padStart(6, '0')}`, type, isOpen, stage: isOpen ? stages[type][index % 2] : type === 'cancellation' ? '取消申请已撤回' : type === 'interception' ? '拦截已解除' : '售后已结束',
        reason: ({ refund: index % 2 ? '客户申请部分退款' : '客户申请整单退款', return_refund: '商品规格不符，申请退货退款', interception: '客户申请修改收货信息', cancellation: '客户申请取消订单', reshipment: '运输破损，安排整单补发', interception_release: '客户确认继续发货，取消拦截' })[type],
        createdAt: new Date(anchor - (index + 2) * 3600000).toISOString(), updatedAt: new Date(anchor - index * 1800000).toISOString(), refundAmount: ['refund', 'return_refund'].includes(type) ? index % 4 === 0 ? null : Math.round(order.amount * (index % 2 ? .3 : 1) * 100) / 100 : null, refundCurrency: ['refund', 'return_refund'].includes(type) ? order.currency || 'USD' : null, requestedAmount: ['refund', 'return_refund'].includes(type) ? Math.round(order.amount * (type === 'refund' && index % 2 ? .3 : 1) * 100) / 100 : null, currency: ['refund', 'return_refund'].includes(type) ? order.currency || 'USD' : null })
    }
  }
  return rows
}
