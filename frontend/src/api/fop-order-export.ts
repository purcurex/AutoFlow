import api from './index'
import type { FopOrderQuery } from './fop-orders'
import { fopAccessError } from './fop-access'

export type FopOrderExportQuery = Omit<FopOrderQuery, 'page' | 'pageSize'> & (
  { mode: 'filtered'; orderIds?: never } | { mode: 'selected'; orderIds: string[] }
)

export async function exportFopOrders(query: FopOrderExportQuery, signal?: AbortSignal): Promise<Blob> {
  // Explicitly allow list filters only; identity and record scope come from the session.
  const { queue, search, orderNumber, departmentId, ownerId, warehouseCode, paidAtOrder, sortBy, sortOrder, warehouseStage, procurementStage, taskStatus, mode } = query
  try {
    return await api.post<Blob, Blob>('/autoflow/integrations/fop/fulfillment-orders/export', {
      queue, search, orderNumber, departmentId, ownerId, warehouseCode, paidAtOrder, sortBy, sortOrder, warehouseStage, procurementStage, taskStatus, mode,
      ...(mode === 'selected' ? { orderIds: query.orderIds } : {}),
    }, { responseType: 'blob', timeout: 120000, signal })
  } catch (error) {
    if (error instanceof Blob) {
      let parsed: unknown
      try { parsed = JSON.parse(await error.text()) } catch { throw new Error('Export failed') }
      throw parsed
    }
    throw error
  }
}

export function fopExportError(error: unknown, zh: boolean): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  const messages: Record<string, [string, string]> = {
    export_selection_changed: ['所选订单状态或查看范围已变化，请刷新后重新选择。', 'Selected orders have changed. Refresh and select again.'],
    export_access_changed: ['订单查看范围已变化，请刷新后重试。', 'Order access changed. Refresh and retry.'],
    export_empty: ['当前筛选下没有可导出的订单，请刷新或调整筛选。', 'No matching orders. Refresh or change the filters.'],
    export_limit_exceeded: ['单次最多导出 10,000 笔订单、50,000 行商品，请缩小筛选范围。', 'Limit: 10,000 orders and 50,000 product rows. Narrow your filters.'],
  }
  return messages[code]?.[zh ? 0 : 1] ?? (code ? fopAccessError(error, zh) : zh ? '导出未成功，请稍后重试。' : 'Export failed. Please retry.')
}
