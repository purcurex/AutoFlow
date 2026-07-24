import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { Request as ExpressRequest } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { FopProductCostLookupDto } from './dto/fop-quote.dto'
import { FopIntegrationService } from './fop-integration.service'
import { FopLogisticsCatalogPort, FopProductCostPort } from './fop-integration.types'

@Controller('autoflow/integrations/fop')
@UseGuards(JwtAuthGuard)
export class FopIntegrationController {
  constructor(
    private readonly fopIntegrationService: FopIntegrationService,
    private readonly productCostPort: FopProductCostPort,
    private readonly logisticsCatalogPort: FopLogisticsCatalogPort,
  ) {}

  @Get('capabilities')
  getCapabilities() {
    return this.fopIntegrationService.getCapabilities()
  }

  @Post('products/purchase-costs')
  getPurchaseCosts(
    @Request() request: ExpressRequest,
    @Body() body: FopProductCostLookupDto,
  ) {
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
  getCustomLogisticsChannels() {
    return this.logisticsCatalogPort.getCustomChannels()
  }

  @Get('logistics/custom-channels/:customChannelCode/actual-channels')
  getActualLogisticsChannels(@Param('customChannelCode') customChannelCode: string) {
    return this.logisticsCatalogPort.getActualChannels(customChannelCode.trim())
  }
}
