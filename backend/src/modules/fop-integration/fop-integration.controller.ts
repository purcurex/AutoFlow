import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { Request as ExpressRequest } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { FopProductCostLookupDto } from './dto/fop-quote.dto'
import { FopIntegrationService } from './fop-integration.service'
import { FopLogisticsCatalogPort, FopProductCostPort } from './fop-integration.types'
import { FopDataService } from '../fop-data/fop-data.service'

@Controller('autoflow/integrations/fop')
@UseGuards(JwtAuthGuard)
export class FopIntegrationController {
  constructor(
    private readonly fopIntegrationService: FopIntegrationService,
    private readonly productCostPort: FopProductCostPort,
    private readonly logisticsCatalogPort: FopLogisticsCatalogPort,
    private readonly dataAccess: FopDataService,
  ) {}

  @Get('capabilities')
  getCapabilities() {
    return this.fopIntegrationService.getCapabilities()
  }

  @Post('products/purchase-costs')
  async getPurchaseCosts(
    @Request() request: ExpressRequest,
    @Body() body: FopProductCostLookupDto,
  ) {
    await this.dataAccess.requireResourcePermission(request.user!.userId)
    const requestId = randomUUID()
    return this.productCostPort.getProductCosts({
      idempotencyKey: `cost-lookup-${request.user!.userId}-${requestId}`,
      correlationId: requestId,
      currency: body.currency,
      items: [{
        lineId: body.lineId,
        productReference: body.productReference.trim(),
        unit: body.unit.trim(),
        productProfitMarginRate: body.productProfitMarginRate,
        quantityTiers: body.quantityTiers,
      }],
    })
  }

  @Get('logistics/custom-channels')
  async getCustomLogisticsChannels(@Request() request: ExpressRequest) {
    await this.dataAccess.requireResourcePermission(request.user!.userId)
    return this.logisticsCatalogPort.getCustomChannels()
  }

  @Get('logistics/custom-channels/:customChannelCode/actual-channels')
  async getActualLogisticsChannels(@Request() request: ExpressRequest, @Param('customChannelCode') customChannelCode: string) {
    await this.dataAccess.requireResourcePermission(request.user!.userId)
    return this.logisticsCatalogPort.getActualChannels(customChannelCode.trim())
  }
}
