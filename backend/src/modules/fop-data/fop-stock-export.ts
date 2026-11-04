import * as ExcelJS from 'exceljs'
import { PayloadTooLargeException } from '@nestjs/common'
import { FopStockOrder, STOCK_TYPE_LABELS, STOCK_PURCHASE_LABELS, STOCK_ORDER_LABELS, STOCK_LIFECYCLE_LABELS, StockFilters } from './fop-stock.types'
import { stockTotals } from './fop-stock'

export async function buildStockWorkbook(rows: readonly FopStockOrder[], source: string, showOrderStatus = true, filters: StockFilters = {}) {
  if (rows.length > 10000 || rows.reduce((n, row) => n + row.items.length, 0) > 50000) throw new PayloadTooLargeException({ code: 'export_limit_exceeded', message: '请缩小导出范围。' })
  const book = new ExcelJS.Workbook()
  book.creator = 'HyperZone'
  const sheet = book.addWorksheet('备货清单', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = [
    ['备货单号', 'stockNumber', 26], ['商品信息', 'products', 48], ['备货类型', 'type', 18], ['订单金额', 'amount', 18], ['币种', 'currency', 10], ...(showOrderStatus ? [['创建时间（UTC+8）', 'createdAt', 25]] : []), ['收款时间（UTC+8）', 'paidAt', 25],
    ...(showOrderStatus ? [['备货订单状态', 'orderStatus', 18]] : []),
    ['客户名称', 'customerName', 26], ['店铺', 'storeName', 24], ['采购状态', 'status', 18], ['收货仓库', 'warehouse', 18], ['业务员', 'salesperson', 26],
  ].map(([header, key, width]) => ({ header: String(header), key: String(key), width: Number(width) }))
  sheet.columns.forEach(column => { column.numFmt = column.key === 'amount' ? '#,##0.00' : '@' })
  const details = book.addWorksheet('商品明细', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] })
  details.columns = [
    { header: '备货单号', key: 'stockNumber', width: 26 }, { header: '商品', key: 'name', width: 40 },
    { header: 'SKU', key: 'sku', width: 26 }, { header: '规格', key: 'variant', width: 26 },
    { header: '数量', key: 'quantity', width: 16 }, { header: '商品图片链接', key: 'imageUrl', width: 50 },
  ]
  details.columns.forEach(column => { column.numFmt = column.key === 'quantity' ? '0.########' : '@' })
  for (const row of rows) {
    sheet.addRow({ stockNumber: row.stockNumber, products: row.items.length ? row.items.slice(0, 5).map(item => `${item.name}\n${item.sku} · ${item.variant} × ${item.quantity}`).join('\n') + (row.items.length > 5 ? `\n共 ${row.items.length} 行商品，完整内容见商品明细` : '') : '暂无商品明细',
    type: STOCK_TYPE_LABELS[row.stockType], amount: row.amount, currency: row.currency, orderStatus: row.orderStatus ? STOCK_ORDER_LABELS[row.orderStatus] : '—', createdAt: row.createdAt ? new Date(Date.parse(row.createdAt) + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ') : '—', paidAt: row.paidAt ? new Date(Date.parse(row.paidAt) + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ') : '—',
    customerName: row.customerName, storeName: row.storeName ?? '—', status: STOCK_PURCHASE_LABELS[row.purchaseStatus], warehouse: row.warehouse, salesperson: `${row.owner.name}\n${row.department.name}` })
    for (const item of row.items) details.addRow({ stockNumber: row.stockNumber, name: item.name, sku: item.sku, variant: item.variant, quantity: item.quantity, imageUrl: item.imageUrl ?? '' })
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: sheet.columnCount } }
  details.autoFilter = { from: { row: 1, column: 1 }, to: { row: details.rowCount, column: details.columnCount } }
  for (const total of stockTotals([...rows]).amounts) sheet.addRow({ stockNumber: '合计', amount: total.amount, currency: total.currency })
  for (const worksheet of [sheet, details]) worksheet.eachRow((row, index) => {
    row.height = index === 1 ? 30 : Math.min(180, Math.max(45, ...Array.from({ length: row.cellCount }, (_, i) => row.getCell(i + 1).text.split('\n').length * 15)))
    row.eachCell(cell => {
      cell.font = { name: 'Microsoft YaHei', size: 10, bold: index === 1, color: { argb: index === 1 ? 'FFFFFFFF' : 'FF243C50' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index === 1 ? 'FF23435D' : index % 2 ? 'FFF3F6F9' : 'FFFFFFFF' } }
      cell.alignment = { vertical: 'middle', wrapText: true }
    })
  })
  book.addWorksheet('说明').addRows([['数据来源', source === 'mock' ? '演示数据' : 'FOP'], ['口径', `${showOrderStatus ? '全部有效备货单' : '备货待采购清单：客户已支付且已审核，未采购、部分采购或已采购待发货'}；全款与押金分列类型；订单金额按币种合计，不代表已收金额或回款业绩。`], ['时间', 'UTC+8'],
    ...(showOrderStatus ? [['备货阶段', filters.lifecycle ? STOCK_LIFECYCLE_LABELS[filters.lifecycle] : '全部'], ['创建时间范围', ({ all: '全部', '1w': '近一周', '1m': '近一月', '3m': '近三月' } as const)[filters.timeRange ?? 'all']]] : []),
  ])
  return Buffer.from(await book.xlsx.writeBuffer())
}
