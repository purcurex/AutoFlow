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
import { exportQueueLabels, FULFILLMENT_EXPORT_MIME } from '../fop-data/fop-order-export'
import { FopDataService } from '../fop-data/fop-data.service'
import { OrderVolumeQueryDto, OrderVolumeDetailsDto, OrderCustomerSearchDto } from '../fop-data/order-volume.dto'
import { ReceiptQueryDto } from '../fop-data/fop-receipts.dto'
import { FopDashboardQueryDto, FopDataAccessQueryDto, SupplierChatQueryDto } from '../fop-data/fop-data.dto'

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
  constructor(private readonly data: FopDataService, private readonly approvals: FopApprovalService) {}

  @Post('fulfillment-orders/export')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async exportOrders(@Request() req: ExpressRequest, @Body() body: ExportFulfillmentOrdersDto) {
    const buffer = await this.data.exportOrders(req.user!.userId, body, req.user!.sessionVersion ?? 0)
    const date = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
    const filename = `${exportQueueLabels[body.queue]}_${date}.xlsx`
    return new StreamableFile(buffer, { type: FULFILLMENT_EXPORT_MIME, disposition: `attachment; filename="workbench-orders-${date}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}` })
  }

  @Post('fulfillment-orders/approvals/preview')
  @Header('Cache-Control', 'private, no-store')
  previewApproval(@Request() req: ExpressRequest, @Body() body: ApprovalPreviewDto) { return this.approvals.preview(req.user!.userId, body, req.user!.sessionVersion ?? 0) }

  @Post('fulfillment-orders/approvals')
  @Header('Cache-Control', 'private, no-store')
  submitApproval(@Request() req: ExpressRequest, @Body() body: ApprovalSubmitDto) { return this.approvals.submit(req.user!.userId, body, req.user!.sessionVersion ?? 0) }

  @Get('fulfillment-orders')
  @Header('Cache-Control', 'private, no-store')
  async getOrders(@Request() req: ExpressRequest, @Query() query: ListFulfillmentOrdersDto) {
    return this.data.getOrders(req.user!.userId, query)
  }

  @Get('fulfillment-orders/:orderId/supplier-follow-ups')
  @Header('Cache-Control', 'private, no-store')
  getSupplierFollowUps(@Request() req: ExpressRequest, @Param('orderId') orderId: string, @Query() _query: FopDataAccessQueryDto) {
    return this.data.getSupplierFollowUps(req.user!.userId, orderId)
  }

  @Get('fulfillment-orders/:orderId/supplier-follow-ups/:purchaseOrderId/launch')
  @Header('Cache-Control', 'private, no-store')
  getSupplierChat(@Request() req: ExpressRequest, @Param('orderId') orderId: string, @Param('purchaseOrderId') purchaseOrderId: string, @Query() query: SupplierChatQueryDto) {
    return this.data.getSupplierChat(req.user!.userId, orderId, purchaseOrderId, query.contactVersion)
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
    return this.data.getDashboard(req.user!.userId, query)
  }
}
