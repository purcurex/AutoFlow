import type { FopSupplierContext } from '../fop-data/fop-realtime.types'
import { RmaQueryDto, RmaExportDto } from '../fop-data/rma-orders.dto'
import { PurchaseReturnContactQueryDto, PurchaseReturnChatQueryDto, PurchaseReturnQueryDto, PurchaseReturnExportDto } from '../fop-data/purchase-returns.dto'
import { PurchaseGroupQueryDto, PurchaseGroupExportDto, PurchaseGroupFiltersDto, PurchaseGroupChatQueryDto } from '../fop-data/procurement-groups.dto'
import { AllocationInventoryQueryDto } from '../fop-data/allocation-inventory.dto'
import { FopApprovalService } from '../fop-data/fop-approval.service'
import { ApprovalPreviewDto, ApprovalSubmitDto } from '../fop-data/fop-approval.dto'
import { SalesPerformanceQueryDto, SalesPerformanceDetailsDto } from '../fop-data/sales-performance.dto'
import { FreightQueryDto, FreightDetailsDto } from '../fop-data/fop-freight.dto'
import { AllowWithoutBusinessData } from '../auth/management-access.decorator'
import { Body, Post, Controller, Get, Header, HttpCode, Param, Query, Request, StreamableFile, UseGuards } from '@nestjs/common'
import { Request as ExpressRequest } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { WorkbenchAccessService } from './workbench-access.service'
import { ExportFulfillmentOrdersDto, ListFulfillmentOrdersDto } from './dto/workbench.dto'
import { completionLabels } from '../fop-data/completed-orders'
import { exportQueueLabels, FULFILLMENT_EXPORT_MIME } from '../fop-data/fop-order-export'
import { FopDataService } from '../fop-data/fop-data.service'
import { StockOrdersQueryDto, StockInventoryQueryDto, StockScopeDto, ExportStockOrdersDto } from '../fop-data/fop-stock.dto'
import { OrderVolumeQueryDto, OrderVolumeDetailsDto, OrderCustomerSearchDto } from '../fop-data/order-volume.dto'
import { ReceiptQueryDto } from '../fop-data/fop-receipts.dto'
import { FopDashboardQueryDto, FopDataAccessQueryDto, SupplierChatQueryDto } from '../fop-data/fop-data.dto'
import { ConfirmFopConnectionDto } from '../fop-data/fop-connection.dto'
import { ServiceUnavailableException } from '@nestjs/common'
import { ReceiptNoticesQueryDto } from '../workbench-replica/receipt-notices.dto'
import { LocalWorkbenchService } from '../workbench-replica/local-workbench.service'

@AllowWithoutBusinessData()
@Controller('workbench')
@UseGuards(JwtAuthGuard)
export class WorkbenchController {
  constructor(private readonly access: WorkbenchAccessService) {}

  @Get('access')
  @Header('Cache-Control', 'private, no-store')
  getAccess(@Request() req: ExpressRequest) {
    return this.access.getAccess(req.user!.userId)
  }

  @Get(':role/access')
  @Header('Cache-Control', 'private, no-store')
  getRoleAccess(@Request() req: ExpressRequest, @Param('role') role: string) {
    return this.access.requireRole(req.user!.userId, role)
  }
}

// No fixture fallback: the default provider remains explicitly unconfigured.
@Controller('autoflow/integrations/fop')
@UseGuards(JwtAuthGuard)
export class FulfillmentOrdersController {
  constructor(private readonly data: FopDataService, private readonly approvals: FopApprovalService, private readonly local?: LocalWorkbenchService) {}

  private get reads(): LocalWorkbenchService {
    if (!this.local?.enabled) throw new ServiceUnavailableException({ code: 'fop_feature_not_configured', message: 'Workbench queries require a configured local replica' })
    return this.local
  }

  private get realtime(): FopDataService | LocalWorkbenchService { return this.local?.enabled && this.local.mock ? this.local : this.data }

  private supplierContacts(userId: string, context: FopSupplierContext) {
    if (this.local?.enabled && this.local.mock) return this.local.unavailableSupplier(userId)
    return this.data.getRealtimeSupplierContacts(userId, context)
  }

  private supplierChat(userId: string, context: FopSupplierContext, contactVersion: string, purchaseOrderId?: string) {
    if (this.local?.enabled && this.local.mock) return this.local.unavailableSupplier(userId)
    return this.data.getRealtimeSupplierChat(userId, context, contactVersion, purchaseOrderId)
  }

  @Get('receipt-notices')
  @Header('Cache-Control', 'private, no-store')
  getReceiptNotices(@Request() req: ExpressRequest, @Query() query: ReceiptNoticesQueryDto) {
    if (!this.local?.enabled) throw new ServiceUnavailableException({ code: 'fop_feature_not_configured', message: 'Receipt notices require a configured local replica' })
    return this.local.getReceiptNotices(req.user!.userId, query)
  }

  @Get('rma-orders')
  @Header('Cache-Control', 'private, no-store')
  getRmaOrders(@Request() req: ExpressRequest, @Query() query: RmaQueryDto) { return this.reads.getRmaOrders(req.user!.userId, query) }

  @Post('rma-orders/export')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async exportRmaOrders(@Request() req: ExpressRequest, @Body() query: RmaExportDto) {
    return new StreamableFile(await this.reads.exportRmaOrders(req.user!.userId, query, req.user!.sessionVersion ?? 0), { type: FULFILLMENT_EXPORT_MIME, disposition: 'attachment; filename="rma-orders.xlsx"' })
  }

  @Get('purchase-returns')
  @Header('Cache-Control', 'private, no-store')
  getPurchaseReturns(@Request() req: ExpressRequest, @Query() query: PurchaseReturnQueryDto) { return this.reads.getPurchaseReturns(req.user!.userId, query) }

  @Get('purchase-returns/:returnId/supplier-follow-up')
  @Header('Cache-Control', 'private, no-store')
  getReturnSupplier(@Request() req: ExpressRequest, @Param('returnId') id: string, @Query() query: PurchaseReturnContactQueryDto) {
    return this.supplierContacts(req.user!.userId, { context: 'purchase_return', returnId: id, orderId: query.orderId, workbenchRole: query.workbenchRole })
  }

  @Get('purchase-returns/:returnId/supplier-follow-up/launch')
  @Header('Cache-Control', 'private, no-store')
  getReturnSupplierChat(@Request() req: ExpressRequest, @Param('returnId') id: string, @Query() query: PurchaseReturnChatQueryDto) {
    return this.supplierChat(req.user!.userId, { context: 'purchase_return', returnId: id, orderId: query.orderId, workbenchRole: query.workbenchRole }, query.contactVersion)
  }

  @Post('purchase-returns/export')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async exportPurchaseReturns(@Request() req: ExpressRequest, @Body() body: PurchaseReturnExportDto) {
    const buffer = await this.reads.exportPurchaseReturns(req.user!.userId, body, req.user!.sessionVersion ?? 0)
    return new StreamableFile(buffer, { type: FULFILLMENT_EXPORT_MIME, disposition: 'attachment; filename="purchase-returns.xlsx"' })
  }

  @Get('purchase-groups')
  @Header('Cache-Control', 'private, no-store')
  getPurchaseGroups(@Request() req: ExpressRequest, @Query() query: PurchaseGroupQueryDto) { return this.reads.getPurchaseGroups(req.user!.userId, query) }

  @Get('purchase-groups/:groupId')
  @Header('Cache-Control', 'private, no-store')
  getPurchaseGroupDetails(@Request() req: ExpressRequest, @Param('groupId') id: string, @Query() query: PurchaseGroupQueryDto) { return this.reads.getPurchaseGroupDetails(req.user!.userId, id, query) }

  @Get('purchase-groups/:groupId/supplier-follow-up')
  @Header('Cache-Control', 'private, no-store')
  getPurchaseGroupSupplier(@Request() req: ExpressRequest, @Param('groupId') id: string, @Query() query: PurchaseGroupFiltersDto) { return this.supplierContacts(req.user!.userId, { context: 'purchase_group', groupId: id, filters: query }) }

  @Get('purchase-groups/:groupId/supplier-follow-up/launch')
  @Header('Cache-Control', 'private, no-store')
  getPurchaseGroupSupplierChat(@Request() req: ExpressRequest, @Param('groupId') id: string, @Query() query: PurchaseGroupChatQueryDto) {
    const { contactVersion, ...filters } = query
    return this.supplierChat(req.user!.userId, { context: 'purchase_group', groupId: id, filters }, contactVersion)
  }

  @Post('purchase-groups/export')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async exportPurchaseGroups(@Request() req: ExpressRequest, @Body() body: PurchaseGroupExportDto) {
    const buffer = await this.reads.exportPurchaseGroups(req.user!.userId, body, req.user!.sessionVersion ?? 0)
    return new StreamableFile(buffer, { type: FULFILLMENT_EXPORT_MIME, disposition: 'attachment; filename="purchase-groups.xlsx"' })
  }

  @Post('allocation-inventory/query')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  getAllocationInventory(@Request() req: ExpressRequest, @Body() query: AllocationInventoryQueryDto) { return this.realtime.getAllocationInventory(req.user!.userId, query) }

  @Get('stock-orders')
  @Header('Cache-Control', 'private, no-store')
  getStockOrders(@Request() req: ExpressRequest, @Query() query: StockOrdersQueryDto) { return this.reads.getStockOrders(req.user!.userId, query) }

  @Get('stock-orders/:orderId/supplier-follow-ups')
  @Header('Cache-Control', 'private, no-store')
  getStockSupplierFollowUps(@Request() req: ExpressRequest, @Param('orderId') orderId: string) { return this.supplierContacts(req.user!.userId, { context: 'stock', orderId, queue: 'procurement_shipping' }) }

  @Get('stock-orders/:orderId/supplier-follow-ups/:purchaseOrderId/launch')
  @Header('Cache-Control', 'private, no-store')
  getStockSupplierChat(@Request() req: ExpressRequest, @Param('orderId') orderId: string, @Param('purchaseOrderId') purchaseOrderId: string, @Query() query: SupplierChatQueryDto) { return this.supplierChat(req.user!.userId, { context: 'stock', orderId, queue: 'procurement_shipping' }, query.contactVersion, purchaseOrderId) }

  @Get('stock-customers')
  @Header('Cache-Control', 'private, no-store')
  getStockCustomers(@Request() req: ExpressRequest, @Query() query: StockScopeDto) { return this.realtime.getStockCustomers(req.user!.userId, query) }

  @Get('stock-inventory')
  @Header('Cache-Control', 'private, no-store')
  getStockInventory(@Request() req: ExpressRequest, @Query() query: StockInventoryQueryDto) { return this.realtime.getStockInventory(req.user!.userId, query) }

  @Post('stock-orders/export')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async exportStockOrders(@Request() req: ExpressRequest, @Body() body: ExportStockOrdersDto) {
    const buffer = await this.reads.exportStockOrders(req.user!.userId, body, req.user!.sessionVersion ?? 0)
    return new StreamableFile(buffer, { type: FULFILLMENT_EXPORT_MIME, disposition: `attachment; filename="stock-orders.xlsx"; filename*=UTF-8''${encodeURIComponent('备货清单.xlsx')}` })
  }

  @Post('fulfillment-orders/export')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async exportOrders(@Request() req: ExpressRequest, @Body() body: ExportFulfillmentOrdersDto) {
    const buffer = await this.reads.exportOrders(req.user!.userId, body, req.user!.sessionVersion ?? 0)
    const date = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
    const filename = `${body.completed && body.queue === 'review' ? completionLabels.review[0] : exportQueueLabels[body.queue]}_${date}.xlsx`
    return new StreamableFile(buffer, { type: FULFILLMENT_EXPORT_MIME, disposition: `attachment; filename="workbench-orders-${date}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}` })
  }

  @Post('fulfillment-orders/approvals/preview')
  @Header('Cache-Control', 'private, no-store')
  previewApproval(@Request() req: ExpressRequest, @Body() body: ApprovalPreviewDto) { return this.approvals.preview(req.user!.userId, body, req.user!.sessionVersion ?? 0) }

  @Post('fulfillment-orders/approvals')
  @Header('Cache-Control', 'private, no-store')
  submitApproval(@Request() req: ExpressRequest, @Body() body: ApprovalSubmitDto) { return this.approvals.submit(req.user!.userId, body, req.user!.sessionVersion ?? 0) }

  /** 无业务账号绑定时也可测试，但服务层仍要求当前账号同时具备系统及业务管理员角色。 */
  @AllowWithoutBusinessData()
  @Post('connection/test')
  @Header('Cache-Control', 'private, no-store')
  testConnection(@Request() req: ExpressRequest) {
    return this.data.testConnection(req.user!.userId)
  }

  @AllowWithoutBusinessData()
  @Post('connection/bind')
  @Header('Cache-Control', 'private, no-store')
  connectCurrentAdmin(@Request() req: ExpressRequest, @Body() body: ConfirmFopConnectionDto) {
    return this.data.connectCurrentAdmin(req.user!.userId, body)
  }

  @Get('fulfillment-orders')
  @Header('Cache-Control', 'private, no-store')
  async getOrders(@Request() req: ExpressRequest, @Query() query: ListFulfillmentOrdersDto) {
    return this.reads.getOrders(req.user!.userId, query)
  }

  @Get('fulfillment-orders/:orderId/supplier-follow-ups')
  @Header('Cache-Control', 'private, no-store')
  getSupplierFollowUps(@Request() req: ExpressRequest, @Param('orderId') orderId: string, @Query() _query: FopDataAccessQueryDto) {
    return this.supplierContacts(req.user!.userId, { context: 'fulfillment', orderId, queue: 'procurement_shipping' })
  }

  @Get('fulfillment-orders/:orderId/supplier-follow-ups/:purchaseOrderId/launch')
  @Header('Cache-Control', 'private, no-store')
  getSupplierChat(@Request() req: ExpressRequest, @Param('orderId') orderId: string, @Param('purchaseOrderId') purchaseOrderId: string, @Query() query: SupplierChatQueryDto) {
    return this.supplierChat(req.user!.userId, { context: 'fulfillment', orderId, queue: 'procurement_shipping' }, query.contactVersion, purchaseOrderId)
  }

  @AllowWithoutBusinessData()
  @Get('data-access')
  @Header('Cache-Control', 'private, no-store')
  getDataAccess(@Request() req: ExpressRequest, @Query() _query: FopDataAccessQueryDto) {
    return this.data.getDataAccess(req.user!.userId)
  }

  @AllowWithoutBusinessData()
  @Get('chart-access')
  @Header('Cache-Control', 'private, no-store')
  getChartAccess(@Request() req: ExpressRequest, @Query() _query: FopDataAccessQueryDto) {
    return this.data.getChartAccess(req.user!.userId)
  }

  @Get('order-volume')
  @Header('Cache-Control', 'private, no-store')
  getOrderVolume(@Request() req: ExpressRequest, @Query() query: OrderVolumeQueryDto) {
    return this.data.getOrderVolume(req.user!.userId, query)
  }

  @Get('order-volume/customers')
  @Header('Cache-Control', 'private, no-store')
  searchCustomers(@Request() req: ExpressRequest, @Query() query: OrderCustomerSearchDto) {
    return this.data.searchOrderCustomers(req.user!.userId, query)
  }

  @Get('order-volume/orders')
  @Header('Cache-Control', 'private, no-store')
  getVolumeOrders(@Request() req: ExpressRequest, @Query() query: OrderVolumeDetailsDto) {
    return this.data.getOrderVolumeDetails(req.user!.userId, query)
  }

  @Get('receipts')
  @Header('Cache-Control', 'private, no-store')
  getReceipts(@Request() req: ExpressRequest, @Query() query: ReceiptQueryDto) {
    return this.data.getReceipts(req.user!.userId, query)
  }

  @Get('order-volume/receipts')
  @Header('Cache-Control', 'private, no-store')
  getVolumeReceipts(@Request() req: ExpressRequest, @Query() query: OrderVolumeDetailsDto) {
    return this.data.getOrderVolumeReceipts(req.user!.userId, query)
  }

  @Get('freight')
  @Header('Cache-Control', 'private, no-store')
  getFreight(@Request() req: ExpressRequest, @Query() query: FreightQueryDto) {
    return this.data.getFreight(req.user!.userId, query)
  }

  @Get('freight/details')
  @Header('Cache-Control', 'private, no-store')
  getFreightDetails(@Request() req: ExpressRequest, @Query() query: FreightDetailsDto) {
    return this.data.getFreightDetails(req.user!.userId, query)
  }

  @Get('sales-performance')
  @Header('Cache-Control', 'private, no-store')
  getSalesPerformance(@Request() req: ExpressRequest, @Query() query: SalesPerformanceQueryDto) {
    return this.data.getSalesPerformance(req.user!.userId, query)
  }

  @Get('sales-performance/details')
  @Header('Cache-Control', 'private, no-store')
  getSalesPerformanceDetails(@Request() req: ExpressRequest, @Query() query: SalesPerformanceDetailsDto) {
    return this.data.getSalesPerformanceDetails(req.user!.userId, query)
  }

  @Get('dashboard')
  @Header('Cache-Control', 'private, no-store')
  getDashboard(@Request() req: ExpressRequest, @Query() query: FopDashboardQueryDto) {
    return this.data.getDashboard(req.user!.userId, query, query.includeQueues === false ? undefined : this.reads)
  }
}
