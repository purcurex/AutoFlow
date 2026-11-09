import * as ExcelJS from 'exceljs'
import { PayloadTooLargeException } from '@nestjs/common'
import type { PurchaseGroup } from './procurement-groups.types'
import type { PurchaseGroupExportDto } from './procurement-groups.dto'
import { normalizeBusinessTimestamp } from './fop-business-time'

const dateText = (value: string | null) => {
  const normalized = normalizeBusinessTimestamp(value)
  return normalized ? new Date(Date.parse(normalized) + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') : ''
}
const payments = { paid: '已付款', unpaid: '待付款', partial: '部分付款', refunded: '已退款待处理', partially_refunded: '部分退款待处理', unknown: '付款待确认' }
const shipments = { pending: '供应商待发货', partial: '供应商部分发货', shipped: '供应商已发货', unknown: '发货待确认' }
const stages = { uncreated: '待创建采购单', placement_pending: '待下单 / 推单', payment_pending: '待支付采购款', refund_pending: '采购退款待跟进' }
function shipmentAging(group: PurchaseGroup, now: Date) {
  if (group.purchase?.payment !== 'paid' || !['pending', 'partial'].includes(group.shipment)) return ''
  const paidAt = normalizeBusinessTimestamp(group.purchase.paidAt)
  if (!paidAt) return '—'
  const elapsed = now.getTime() - Date.parse(paidAt)
  return elapsed < 0 ? '—' : elapsed > 48 * 3600000 ? '超过48小时' : elapsed > 24 * 3600000 ? '超过24小时' : '正常'
}
export async function buildPurchaseGroupWorkbook(groups: PurchaseGroup[], query?: PurchaseGroupExportDto, source = 'fop', now = new Date()): Promise<Buffer> {
  const lineCount = groups.reduce((n, g) => n + g.rows.reduce((m, r) => m + Math.max(1, r.lines.length), 0), 0)
  const orderCount = new Set(groups.flatMap(g => g.rows.map(r => r.orderId))).size
  if (groups.length > 10000 || orderCount > 10000 || lineCount > 50000) throw new PayloadTooLargeException({ code: 'export_limit_exceeded', message: '请缩小筛选范围后导出。' })
  const book = new ExcelJS.Workbook()
  book.creator = 'HyperZone'; book.created = now
  const sheet = book.addWorksheet('采购关联明细', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] })
  sheet.columns = ['采购订单号', '供应商', '平台订单号', '采购付款状态', '采购付款时间（UTC+8）', '履约订单号', 'Shopify单号', '客户', '业务员', '部门', '仓库', 'SKU', '商品', '采购数量', '供应商已发数量', '供应商待发数量', '采购单状态', '采购类型', '采购平台', '待采购数量', '采购下单状态', '供应商发货状态', '店铺', '规格', '收款时间（UTC+8）', '发货时效', ...(query?.completed ? ['采购完成时间（UTC+8）'] : [])].map((header, i) => ({ header, key: String(i), width: [3, 13, 14, 15, 19].includes(i) ? 18 : 26 }))
  for (const group of groups) for (const row of group.rows) for (const line of row.lines.length ? row.lines : [null]) {
    const purchase = group.purchase
    sheet.addRow([purchase?.number ?? '', purchase?.supplier.name ?? '', purchase?.platformOrderNumber ?? '', purchase ? payments[purchase.payment] : '', dateText(purchase?.paidAt ?? null),
      row.orderNumber, row.shopifyOrderNumber, row.customerName, row.ownerName, row.departmentName, row.warehouse, line?.sku ?? '', line?.name ?? '',
      purchase ? line?.quantity ?? '' : '', purchase ? line?.shippedQuantity ?? '—' : '', purchase && line ? line.shippedQuantity === null ? '—' : Number((line.quantity - line.shippedQuantity).toFixed(8)) : '',
      group.kind === 'uncreated' ? line?.demandStage === 'application_pending' ? '待建采购申请' : '待创建采购单' : '已创建', purchase ? purchase.purchaseType === 'offline' ? '线下' : purchase.purchaseType === 'online' ? '线上' : '—' : '', purchase?.platform === '1688' ? '1688' : purchase?.platform === 'other' ? '其他平台' : '',
      !purchase ? line?.quantity ?? '' : '', purchase ? purchase.placement === 'placed' ? '已下单' : purchase.placement === 'unknown' ? '下单待确认' : purchase.platform === '1688' ? '待推1688采购' : '待下单' : '',
      purchase ? shipments[group.shipment] : '', row.storeName, line?.variant ?? '', dateText(row.paidAt), shipmentAging(group, now), ...(query?.completed ? [dateText(row.completedAt ?? null)] : [])])
  }
  sheet.eachRow((row, i) => {
    row.height = i === 1 ? 32 : 44
    row.eachCell((cell, col) => {
      // Assign external identifiers as literal strings, never formulas or numbers.
      cell.numFmt = [14, 15, 16, 20].includes(col) ? '0.########' : '@'
      cell.alignment = { vertical: 'middle', wrapText: true }
      cell.font = { name: 'Microsoft YaHei', size: 10, bold: i === 1, color: { argb: i === 1 ? 'FFFFFFFF' : 'FF243C50' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i === 1 ? 'FF23435D' : i % 2 ? 'FFF3F6F9' : 'FFFFFFFF' } }
    })
  })
  sheet.autoFilter = { from: 'A1', to: `${query?.completed ? 'AA' : 'Z'}${sheet.rowCount}` }
  const notes = book.addWorksheet('说明')
  notes.columns = [{ header: '项目', key: 'label', width: 26 }, { header: '内容', key: 'value', width: 90 }]
  const rows = groups.flatMap(g => g.rows)
  notes.addRows([
    ['清单', query?.completed ? '采购完成清单' : query?.queue === 'procurement_shipping' ? '已采购待发货清单' : '待采购清单'],
    ['导出方式', query?.mode === 'selected' ? '导出所选采购组的全部关联明细' : '当前筛选全部采购组（跨分页）'],
    ['生成时间（UTC+8）', dateText(now.toISOString())], ...(query?.completed ? [['完成时间范围', query.timeRange === '1m' ? '近一月' : query.timeRange === '3m' ? '近三月' : '近一周']] : []),
    ['数据来源', source === 'mock' ? '演示数据' : 'FOP'],
    ['搜索条件', query?.search?.trim() || '无'], ['采购进度筛选', query?.purchaseStage ? stages[query.purchaseStage] : '全部状态'],
    ['业务部门', query?.departmentId ? [...new Set(rows.map(r => r.departmentName))].join('、') : '全部'],
    ['业务员', query?.ownerId ? [...new Set(rows.map(r => r.ownerName))].join('、') : '全部'],
    ['发货仓库', query?.warehouseCode === 'HZ' ? '杭州仓' : query?.warehouseCode === 'SZ' ? '深圳仓' : '全部'],
    ['排序', query?.completed ? `采购完成时间 · ${query.sortOrder === 'asc' ? '升序' : '降序'}` : `最早收款时间 · ${query?.sortOrder === 'desc' ? '降序' : '升序'}；待创建采购单置顶`],
    ['数量口径', '每行是履约订单关联商品数量；待创建采购单只列待采购数量，采购及供应商发货数量留空。'],
    ['去重', '同一履约订单可以在多张采购单下出现；本表不重复导出整笔履约金额。'],
    ['采购类型', '线下与线上独立分类；线上区分1688和其他平台。'],
    ['发货时效', '仅已付款且仍有待发商品时计算，超过24小时、超过48小时分档；缺失或未来付款时间显示—。'],
    ['数据时效', '按生成时刻计算发货时效，导出后不会自动更新。'],
  ])
  notes.eachRow(row => row.eachCell(cell => { cell.numFmt = '@'; cell.alignment = { vertical: 'middle', wrapText: true } }))
  return Buffer.from(await book.xlsx.writeBuffer())
}
