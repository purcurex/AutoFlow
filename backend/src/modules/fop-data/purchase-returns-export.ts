import * as ExcelJS from 'exceljs'
import { PayloadTooLargeException } from '@nestjs/common'
import { purchaseReturnLabels, summarizePurchaseReturnOrders, type PurchaseReturnOrder } from './purchase-returns'
import type { PurchaseReturnExportDto } from './purchase-returns.dto'
export async function buildPurchaseReturnWorkbook(rows: PurchaseReturnOrder[], query: PurchaseReturnExportDto, source: string) {
  const detailCount = rows.reduce((sum, row) => sum + row.purchaseReturns.reduce((n, doc) => n + doc.lines.length, 0) + row.items.length, 0)
  if (rows.length > 10000 || detailCount > 50000) throw new PayloadTooLargeException({ code: 'export_limit_exceeded' })
  const book = new ExcelJS.Workbook(); book.creator = 'HyperZone'; book.created = new Date()
  const date = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') : '—'
  const sheet = (name: string, headers: string[], keys: string[]) => { const ws = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] }); ws.columns = keys.map((key, index) => ({ key, header: headers[index], width: ['products', 'returns', 'name'].includes(key) ? 45 : 24 })); keys.forEach((key, i) => { ws.getColumn(i + 1).numFmt = key === 'amount' ? '#,##0.00' : ['quantity', 'returned'].includes(key) ? '#,##0.###' : '@' }); return ws }
  const list = sheet('采购退货清单', ['订单编号', '商品信息', 'Shopify 单号', '订单金额', '币种', '收款日期（UTC+8）', '关联退货单', '退货数量', '已退数量', '客户名称', '店铺', '发货仓库', '业务员', '订单审核时间（UTC+8）'], ['order', 'products', 'shopify', 'amount', 'currency', 'paid', 'returns', 'quantity', 'returned', 'customer', 'store', 'warehouse', 'owner', 'reviewed'])
  const detail = sheet('退货明细', ['订单编号', '退货单号', '退货进度', '采购单号', '供应商', 'SKU', '商品信息', '规格', '退货数量', '已退数量', '退货出库仓库', '退货物流商', '退货物流单号', '退货创建时间（UTC+8）'], ['order', 'number', 'status', 'purchase', 'supplier', 'sku', 'name', 'variant', 'quantity', 'returned', 'warehouse', 'carrier', 'tracking', 'created'])
  const products = sheet('商品明细', ['订单编号', 'SKU', '商品信息', '规格', '订单商品数量'], ['order', 'sku', 'name', 'variant', 'quantity'])
  for (const row of rows) {
    list.addRow({ order: row.orderNumber, products: row.items.slice(0, 5).map(item => `${item.name}\n${item.sku} × ${item.quantity}`).join('\n') + (row.items.length > 5 ? `\n共${row.items.length}行，见商品明细` : ''), shopify: row.shopifyOrderNumber, amount: row.amount, currency: row.currency || 'USD', paid: date(row.paidAt), returns: [...new Set(row.purchaseReturns.flatMap(doc => doc.number ? [doc.number] : []))].join('\n') || '—', quantity: row.returnQuantity, returned: row.returnedQuantity, customer: row.customerName, store: row.storeName, warehouse: row.warehouse, owner: `${row.owner?.name || row.salesperson}\n${row.department?.name || '—'}`, reviewed: date(row.reviewedAt) })
    for (const doc of row.purchaseReturns) for (const line of doc.lines) detail.addRow({ order: row.orderNumber, number: doc.number || '—', status: purchaseReturnLabels[doc.status][0], purchase: doc.purchaseOrder.number, supplier: doc.supplier.name, sku: line.sku, name: line.name, variant: line.variant, quantity: line.quantity, returned: line.returnedQuantity, warehouse: doc.warehouse, carrier: doc.logistics.carrier || '—', tracking: doc.logistics.trackingNumber || '—', created: date(doc.createdAt) })
    for (const item of row.items) products.addRow({ order: row.orderNumber, sku: item.sku, name: item.name, variant: item.variant, quantity: item.quantity })
  }
  for (const ws of [list, detail, products]) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: ws.columnCount } }
  const totals = summarizePurchaseReturnOrders(rows)
  list.addRow({ order: `合计 · ${totals.orderCount} 笔履约订单`, returns: `${totals.returnCount} 张退货单`, quantity: totals.quantity, returned: totals.returnedQuantity })
  for (const money of totals.amountsByCurrency) list.addRow({ order: '订单金额合计', currency: money.currency, amount: money.amount })
  const info = sheet('导出说明', ['项目', '内容'], ['key', 'value'])
  for (const [key, value] of [['清单', '采购退货清单（履约订单视角）'], ['导出方式', query.mode === 'selected' ? '所选履约订单' : '当前筛选全部履约订单（跨分页）'], ['数据来源', source === 'mock' ? '演示数据' : 'FOP'], ['搜索', query.search || '无'], ['退货进度', query.status ? purchaseReturnLabels[query.status][0] : '全部'], ['业务部门', query.departmentId || '全部授权部门'], ['业务员', query.ownerId || '全部授权业务员'], ['退货出库仓库', query.warehouseCode || '全部'], ['排序', `收款日期 · ${query.paidAtOrder === 'desc' ? '降序' : '升序'}`], ['金额口径', '订单金额按履约单去重、按币种合计，不是退货金额。商品明细为原履约订单商品；退货明细仅包含当前履约来源分摊。'], ['关联口径', '仅实物退货的履约订单来源；一单多退货合并，一退货多履约逐来源分摊。未提供退货单号显示—，不拼造单号。'], ['生成时间（UTC+8）', date(book.created.toISOString())]]) info.addRow({ key, value })
  for (const ws of book.worksheets) ws.eachRow((row, index) => { row.height = index === 1 ? 30 : 48; row.eachCell(cell => { cell.font = { name: 'Microsoft YaHei', size: 10, bold: index === 1, color: { argb: index === 1 ? 'FFFFFFFF' : 'FF243C50' } }; cell.alignment = { vertical: 'middle', wrapText: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index === 1 ? 'FF23435D' : index % 2 ? 'FFF3F6F9' : 'FFFFFFFF' } } }) })
  return Buffer.from(await book.xlsx.writeBuffer())
}
