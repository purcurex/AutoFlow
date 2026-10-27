import { PayloadTooLargeException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'
import type { FopOrder } from './fop-data.types'
import type { ExportFulfillmentOrdersDto } from '../users/dto/workbench.dto'
import { moneyToCents, summarizeFopOrders } from './fop-order-totals'

export const FULFILLMENT_EXPORT_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const exportQueueLabels = { unpaid: '待支付清单', review: '待审核清单', exceptions: '异常订单清单', procurement: '待采购清单', procurement_shipping: '已采购待发货清单', allocation: '未配货清单', allocation_review: '已齐套待审核清单', dispatch: '待履约清单', shipping: '待出库清单' }
type Column = { header: string; key: string; width: number; number?: boolean; money?: boolean }
const itemSummary = (items: readonly string[]) => items.slice(0, 5).join('\n') + (items.length > 5 ? `\n共 ${items.length} 行商品，完整内容见商品明细` : '')
const column = (header: string, key: string, width = 22): Column => ({ header, key, width })
const dateText = (value: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ') : '—'
}
function dispatchText(order: FopOrder) {
  if (!order.dispatchDocuments) return '待确认'
  if (!order.dispatchDocuments.length) return '暂无发运单'
  const labels = { draft: '暂存', submitted: '已提交', approved: '已审核', unknown: '待确认' }
  return order.dispatchDocuments.map(doc => `${doc.number}：${labels[doc.status]}`).join('\n')
}
function allocationText(order: FopOrder) {
  const p = order.fulfillmentProgress
  if (p.stockReadiness === 'incomplete') return '未齐套'
  if (p.stockReadiness === 'ready' && p.allocationReview === 'pending') return '已齐套未审核'
  if (p.stockReadiness === 'ready' && p.allocationReview === 'approved') return '已审核未出库'
  return '待确认'
}
function procurementText(order: FopOrder) {
  const p = order.procurementProgress
  const placement = { not_ordered: '未下单', partial: '部分下单', ordered: '已下单', cancelled: '已取消', not_required: '无需采购', unknown: '待确认' }
  const payment = { unpaid: '未支付', partial: '部分支付', paid: '已支付', refunded: '退款待跟进', not_required: '暂无应付', unknown: '待确认' }
  return `下单：${placement[p?.purchaseOrder ?? 'unknown']}\n采购款：${payment[p?.supplierPayment ?? 'unknown']}`
}
function queueColumns(queue: ExportFulfillmentOrdersDto['queue']) {
  if (queue === 'shipping') return [column('配货单状态', 'primaryStatus', 28)]
  const procurement = queue === 'procurement' || queue === 'procurement_shipping'
  const allocation = queue === 'allocation' || queue === 'allocation_review'
  const first = procurement ? '采购订单状态' : allocation || queue === 'dispatch' ? '发运单状态' : '支付状态'
  const second = procurement ? '供应商发货状态' : allocation ? '配货状态' : queue === 'dispatch' ? 'Shopify 履约状态' : queue === 'exceptions' ? '异常原因' : '审核状态'
  return [column(first, 'primaryStatus', 28), column(second, 'secondaryStatus', 28), ...(allocation ? [column('配货单状态', 'allocationReviewStatus', 22)] : [])]
}
function statuses(order: FopOrder, queue: ExportFulfillmentOrdersDto['queue']) {
  const p = order.fulfillmentProgress
  if (queue === 'procurement' || queue === 'procurement_shipping') return [procurementText(order), ({ pending: '供应商未发货', partial: '供应商部分发货', shipped: '供应商已发货', not_required: '无需供应商发货', unknown: '待确认' })[p.supplierShipment]]
  if (queue === 'allocation' || queue === 'allocation_review') return [dispatchText(order), ({ incomplete: '未齐套', ready: '已齐套', unknown: '待确认' })[p.stockReadiness]]
  if (queue === 'dispatch') return [dispatchText(order), p.shopifySync === 'partial' ? '部分同步 · 待完成' : '待同步 Shopify 发货']
  if (queue === 'shipping') return [allocationText(order), '']
  return [{ paid: '已支付', unpaid: '未支付', refunded: '已退款' }[order.paymentStatus], queue === 'exceptions' ? order.exception ? { stock: '库存不足', address: '地址待核验', tracking: '物流单号异常' }[order.exception.reason] : '—' : order.reviewStatus === 'approved' ? '已审核' : '待审核']
}
function sheet(workbook: ExcelJS.Workbook, name: string, columns: Column[]) {
  const ws = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }], properties: { defaultRowHeight: 26 } })
  ws.columns = columns.map(({ header, key, width }) => ({ header, key, width }))
  columns.forEach((col, index) => { ws.getColumn(index + 1).numFmt = col.money ? '#,##0.00;[Red]-#,##0.00' : col.number ? '#,##0.###' : '@' })
  ws.getRow(1).height = 30
  ws.getRow(1).eachCell(cell => {
    cell.font = { name: 'Microsoft YaHei', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF23435D' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  return ws
}
function addRow(ws: ExcelJS.Worksheet, values: Record<string, string | number>, total = false) {
  const row = ws.addRow(values)
  row.height = total ? 28 : 42
  row.eachCell(cell => {
    // External text is assigned as a string, never a formula or hyperlink object.
    cell.font = { name: 'Microsoft YaHei', size: 10, bold: total, color: { argb: 'FF243C50' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: total ? 'FFE3EDF3' : row.number % 2 ? 'FFF3F6F9' : 'FFFFFFFF' } }
    cell.border = { bottom: { style: 'hair', color: { argb: 'FFD8E1E9' } } }
  })
  return row
}

export async function buildFulfillmentWorkbook(orders: readonly FopOrder[], query: ExportFulfillmentOrdersDto, source: string): Promise<Buffer> {
  const itemCount = orders.reduce((sum, order) => sum + order.items.length, 0)
  if (orders.length > 10000 || itemCount > 50000) throw new PayloadTooLargeException({ code: 'export_limit_exceeded', message: '单次最多导出 10,000 笔订单、50,000 行商品，请缩小筛选范围。' })
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'HyperZone'
  workbook.created = new Date()
  const columns: Column[] = [column('订单编号', 'orderNumber', 30), column('商品信息', 'products', 44), column('Shopify 单号', 'shopifyOrderNumber'), column('客户名称', 'customerName', 28), column('收款日期（UTC+8）', 'paidAt', 24), ...queueColumns(query.queue), column('店铺', 'storeName'), column('本地 SKU / 规格', 'variants', 36), { ...column('数量', 'quantity', 12), number: true }, { ...column('订单金额', 'amount', 18), money: true }, column('币种', 'currency', 10)]
  if (query.queue === 'exceptions') columns.push({ ...column('异常时长（小时）', 'exceptionHours', 20), number: true })
  columns.push(column('发货仓库', 'warehouse'))
  if (query.queue === 'dispatch' || query.queue === 'shipping') columns.push(column('物流商', 'carrier'), column('物流单号', 'trackingNumber', 30))
  columns.push(column('业务员', 'salesperson', 26), column('所属部门', 'department'), column('创建日期（UTC+8）', 'createdAt', 24))
  const list = sheet(workbook, '订单清单', columns)
  const items = sheet(workbook, '商品明细', [column('订单编号', 'orderNumber', 30), column('商品信息', 'name', 40), column('SKU', 'sku', 26), column('规格', 'variant', 26), { ...column('数量', 'quantity', 12), number: true }, column('商品图片链接', 'imageUrl', 50)])
  for (const order of orders) {
    const [primaryStatus, secondaryStatus] = statuses(order, query.queue)
    addRow(list, {
      orderNumber: order.orderNumber, products: itemSummary(order.items.map(item => `${item.name} × ${item.quantity}`)), shopifyOrderNumber: order.shopifyOrderNumber,
      customerName: order.customerName, paidAt: dateText(order.paidAt), primaryStatus, secondaryStatus, allocationReviewStatus: ({ pending: '未审核', approved: '已审核', unknown: '待确认' })[order.fulfillmentProgress.allocationReview], storeName: order.storeName,
      variants: itemSummary(order.items.map(item => `${item.sku}${item.variant ? ` / ${item.variant}` : ''}`)), quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
      amount: moneyToCents(order.amount) / 100, currency: order.currency?.trim().toUpperCase() || 'USD', exceptionHours: order.exception?.hours ?? '', warehouse: order.warehouse,
      carrier: order.carrier ?? '—', trackingNumber: order.trackingNumber ?? '—', salesperson: order.owner?.name || order.salesperson, department: order.department?.name || '—', createdAt: dateText(order.createdAt),
    })
    for (const item of order.items) addRow(items, { orderNumber: order.orderNumber, name: item.name, sku: item.sku, variant: item.variant, quantity: item.quantity, imageUrl: item.imageUrl ?? '' })
  }
  list.autoFilter = { from: { row: 1, column: 1 }, to: { row: orders.length + 1, column: columns.length } }
  items.autoFilter = { from: { row: 1, column: 1 }, to: { row: itemCount + 1, column: 6 } }
  const totals = summarizeFopOrders(orders)
  addRow(list, { orderNumber: `合计 · ${totals.orderCount} 笔订单`, quantity: totals.itemQuantity }, true)
  for (const money of totals.amountsByCurrency) addRow(list, { orderNumber: `金额合计 · ${money.currency}`, amount: money.amount, currency: money.currency }, true)
  addRow(items, { orderNumber: '合计', quantity: totals.itemQuantity }, true)
  const info = sheet(workbook, '导出说明', [column('项目', 'label', 26), column('内容', 'value', 90)])
  const entries = [
    ['清单', exportQueueLabels[query.queue]], ['导出方式', query.mode === 'selected' ? '导出所选订单' : '当前筛选全部订单（跨分页）'], ['生成时间（UTC+8）', dateText(workbook.created.toISOString())],
    ['数据来源', source === 'mock' ? '演示数据' : 'FOP'], ['搜索条件', query.search?.trim() || '无'], ['指定订单', query.orderNumber || '无'],
    ['所属部门', query.departmentId ? [...new Set(orders.map(o => o.department?.name).filter(Boolean))].join('、') : '全部可见部门'],
    ['业务员', query.ownerId ? [...new Set(orders.map(o => o.owner?.name || o.salesperson))].join('、') : '全部业务员'],
    ['配货单状态', query.queue === 'shipping' ? ({ all: '全部待出库', pending_review: '已齐套未审核', pending_outbound: '已审核未出库' })[query.warehouseStage ?? 'all'] : '不适用'],
    ['排序', `${({ paidAt: '收款日期', dispatchDocumentStatus: '发运单状态', allocationDocumentStatus: '配货单状态', stockReadiness: '配货状态', allocationReviewStatus: '配货单状态', outboundStatus: '出库状态' })[query.sortBy ?? 'paidAt']} · ${(query.sortOrder ?? (query.sortBy && query.sortBy !== 'paidAt' ? 'asc' : query.paidAtOrder) ?? 'asc') === 'asc' ? '升序' : '降序'}`],
    ['金额口径', '订单金额按币种分别合计，未换汇；一单多品的订单金额仅计算一次。此表为待办订单金额，不等同于回款业绩。'],
    ['商品信息', '商品明细表每个 SKU 独立一行。图片为原始链接文本，不嵌入外部图片；长商品内容可在编辑栏查看。'],
    ['数据时效', '导出重新查询当前数据，与页面上次刷新后的状态可能不同。'],
  ]
  for (const [label, value] of entries) addRow(info, { label, value })
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
