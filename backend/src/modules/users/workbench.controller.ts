import { AllowWithoutBusinessData } from '../auth/management-access.decorator'
import { Controller, Get, Header, Param, Query, Request, UseGuards } from '@nestjs/common'
import { Request as ExpressRequest } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { WorkbenchAccessService } from './workbench-access.service'
import { ListFulfillmentOrdersDto } from './dto/workbench.dto'
import { FopDataService } from '../fop-data/fop-data.service'
import { OrderVolumeQueryDto, OrderVolumeDetailsDto, OrderCustomerSearchDto } from '../fop-data/order-volume.dto'
import { FopDashboardQueryDto, FopDataAccessQueryDto } from '../fop-data/fop-data.dto'

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
  constructor(private readonly data: FopDataService) {}

  @Get('fulfillment-orders')
  @Header('Cache-Control', 'private, no-store')
  async getOrders(@Request() req: ExpressRequest, @Query() query: ListFulfillmentOrdersDto) {
    return this.data.getOrders(req.user!.userId, query)
  }

  @AllowWithoutBusinessData()
  @Get('data-access')
  @Header('Cache-Control', 'private, no-store')
  getDataAccess(@Request() req: ExpressRequest, @Query() _query: FopDataAccessQueryDto) {
    return this.data.getDataAccess(req.user!.userId)
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

  @Get('dashboard')
  @Header('Cache-Control', 'private, no-store')
  getDashboard(@Request() req: ExpressRequest, @Query() query: FopDashboardQueryDto) {
    return this.data.getDashboard(req.user!.userId, query)
  }
}
