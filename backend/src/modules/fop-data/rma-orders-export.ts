import * as ExcelJS from 'exceljs'
import { PayloadTooLargeException } from '@nestjs/common'
import { assertRmaTypeCompatibility, rmaTypeLabels, rmaCaseLabels, rmaOrderTagLabels, type RmaOrder } from './rma-orders'
import { summarizeFopOrders } from './fop-order-totals'
import type { RmaExportDto } from './rma-orders.dto'
export async function buildRmaWorkbook(rows: RmaOrder[], query: RmaExportDto, source: string) {
  if (rows.length > 10000 || rows.reduce((sum, row) => sum + row.items.length + row.rmaCases.length, 0) > 50000) throw new PayloadTooLargeException({ code: 'export_limit_exceeded' })
  const book = new ExcelJS.Workbook(); book.creator = 'HyperZone'; book.created = new Date()
  const date = (value: string | null) => value ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') : '—'
  const sheet = (name: string, headers: string[], keys: string[]) => { const ws = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] }); ws.columns = keys.map((key, index) => ({ key, header: headers[index], width: ['reason', 'products', 'flows', 'reason'].includes(key) ? 48 : 24 })); keys.forEach((key, i) => { ws.getColumn(i + 1).numFmt = ['amount', 'requestedAmount', 'refundAmount', 'quantity'].includes(key) ? '#,##0.00' : '@' }); return ws }
  const list = sheet('RMA售后清单', ['订单编号', '订单标签', '商品信息', 'Shopify 单号', '订单金额', '币种', '退款金额', 'RMA单', '售后原因', '客户名称', '店铺', '发货仓库', '业务员', '最近更新时间（UTC+8）'], ['order', 'tags', 'products', 'shopify', 'amount', 'currency', 'refunds', 'types', 'reason', 'customer', 'store', 'warehouse', 'owner', 'updated'])
  const cases = sheet('售后明细', ['订单编号', '售后单号', '售后类型或标签', '流程状态', '当前环节', '售后原因', '退款金额', '退款币种', '申请金额', '申请币种', '申请时间（UTC+8）', '更新时间（UTC+8）'], ['order', 'number', 'type', 'status', 'stage', 'reason', 'refundAmount', 'refundCurrency', 'requestedAmount', 'currency', 'created', 'updated'])
  const items = sheet('商品明细', ['订单编号', 'SKU', '商品名称', '规格', '数量'], ['order', 'sku', 'name', 'variant', 'quantity'])
  for (const row of rows) {
    assertRmaTypeCompatibility(row.rmaCases)
    list.addRow({ order: row.orderNumber, products: row.items.map(item => `${item.name}\n${item.sku} × ${item.quantity}`).join('\n'), shopify: row.shopifyOrderNumber || '—', tags: (row.orderTags ?? []).map(tag => tag === 'cancellation_requested' ? '订单取消（申请中）' : rmaOrderTagLabels[tag][0]).join('、') || '—', types: row.rmaCases.filter(item => Object.prototype.hasOwnProperty.call(rmaTypeLabels, item.type)).map(item => `${rmaTypeLabels[item.type as keyof typeof rmaTypeLabels][0]} · ${item.number || '—'}`).join('\n') || '—', reason: [...new Set(row.rmaCases.map(item => item.reason).filter(Boolean))].join('\n') || '—', refunds: (row.refundAmounts ?? []).map(item => item.amount != null && item.currency ? `${item.currency} ${item.amount.toFixed(2)}` : '—').join('\n') || '—', amount: row.amount, currency: row.currency, customer: row.customerName, store: row.storeName, warehouse: row.warehouse, owner: `${row.owner?.name || row.salesperson}\n${row.department?.name || '—'}`, updated: date(row.rmaUpdatedAt) })
    for (const item of row.rmaCases) cases.addRow({ order: row.orderNumber, number: item.number || '—', type: rmaCaseLabels[item.type][0], status: item.isOpen ? '进行中' : '已结束', stage: item.stage || '—', reason: item.reason || '—', refundAmount: item.refundAmount ?? '—', refundCurrency: item.refundCurrency || '—', requestedAmount: item.requestedAmount ?? '—', currency: item.currency || '—', created: date(item.createdAt), updated: date(item.updatedAt) })
    for (const item of row.items) items.addRow({ order: row.orderNumber, sku: item.sku, name: item.name, variant: item.variant, quantity: item.quantity })
  }
  for (const ws of [list, cases, items]) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: ws.columnCount } }
  const totals = summarizeFopOrders(rows)
  list.addRow({ order: `合计 · ${totals.orderCount} 笔订单`, reason: `${rows.reduce((sum, row) => sum + row.rmaCases.length, 0)} 项售后` })
  for (const money of totals.amountsByCurrency) list.addRow({ order: '订单金额合计', currency: money.currency, amount: money.amount })
  const info = sheet('导出说明', ['项目', '内容'], ['key', 'value'])
  for (const [key, value] of [['清单', 'RMA售后清单'], ['类型', query.type ? rmaTypeLabels[query.type][0] : '全部'], ['流程状态', query.flowStatus === 'all' ? '全部' : query.flowStatus === 'closed' ? '已结束' : '进行中'], ['搜索', query.search || '无'], ['业务部门', query.departmentId || '全部授权部门'], ['业务员', query.ownerId || '全部授权业务员'], ['仓库', query.warehouseCode || '全部'], ['导出方式', query.mode === 'selected' ? '所选订单' : '当前筛选全部订单（跨分页）'], ['数据来源', source === 'mock' ? '演示数据' : 'FOP'], ['金额口径', '订单金额按履约单去重、按币种汇总；退款金额取独立FOP售后退款字段，不以申请金额或订单金额补造，缺失显示—，不代表退款已到账；同币种匹配售后记录合计，任一金额不全不显示不完整合计，订单金额与退款金额不相互抵扣。'], ['统计范围', '只展示当前筛选匹配的授权售后事项，售后状态独立于订单履约进度。']]) info.addRow({ key, value })
  for (const ws of book.worksheets) ws.eachRow((row, index) => { row.height = index === 1 ? 30 : 48; row.eachCell(cell => { cell.font = { name: 'Microsoft YaHei', size: 10, bold: index === 1, color: { argb: index === 1 ? 'FFFFFFFF' : 'FF243C50' } }; cell.alignment = { wrapText: true, vertical: 'middle' }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index === 1 ? 'FF23435D' : index % 2 ? 'FFF3F6F9' : 'FFFFFFFF' } } }) })
  return Buffer.from(await book.xlsx.writeBuffer())
}
