import type { BusinessScope } from '../users/business-scope'
import type { FopOrder, FopOrderPageQuery } from './fop-data.types'
import type { PurchaseLinkSnapshot } from './procurement-groups.types'
import { allocationFacts } from './workbench-allocation-facts'
import { appendExceptionFacts } from './workbench-exception-facts'
import { procurementFacts } from './workbench-procurement-facts'
import { appendDispatchFacts, decodeWorkbenchOrders, fact, rows, validateResources } from './workbench-facts'

/** 同一原始契约覆盖11个清单；返回完整授权候选，最终业务筛选、分页和汇总由服务层统一执行。 */
export function projectWorkbenchFacts(values: unknown[], source: unknown, organizations: readonly string[], scope: Readonly<BusinessScope>, query: FopOrderPageQuery, warehouseMap: Record<string, string>): {
  orders: FopOrder[]; links: PurchaseLinkSnapshot['orders']; purchaseIds: string[]
} {
  const data = fact(source), candidates = decodeWorkbenchOrders(values, organizations, scope, query.queue, warehouseMap)
  if (!values.length) return { orders: [], links: [], purchaseIds: [] }
  const procurement = ['procurement', 'procurement_shipping'].includes(query.queue), allocation = ['allocation', 'allocation_review', 'shipping'].includes(query.queue)
  const resources: string[] = []
  if (!['unpaid', 'review'].includes(query.queue)) resources.push('dispatches')
  if (allocation || query.queue === 'exceptions') resources.push('allocations', 'deliveryNotices', 'outbounds')
  if (procurement) resources.push('applications', 'purchases', 'receiptNotices', 'products')
  if (query.queue === 'exceptions') resources.push('freightIssues', 'products')
  validateResources(data, organizations, resources)
  for (const candidate of candidates) {
    if (!['unpaid', 'review'].includes(query.queue)) appendDispatchFacts(candidate, data)
    if (query.queue === 'exceptions') appendExceptionFacts(candidate, data)
  }
  const links = procurement ? procurementFacts(candidates, data, query.queue === 'procurement_shipping') : []
  const orders = allocation ? candidates.map(candidate => allocationFacts(candidate, data, query.queue, query.completed === true,
    query.timeRange as '1w' | '1m' | '3m' | undefined)).filter((value): value is FopOrder => value !== null) : candidates.map(candidate => candidate.order)
  return { orders, links, purchaseIds: procurement ? rows(data, 'purchases', true).map(row => String(row.id)) : [] }
}
