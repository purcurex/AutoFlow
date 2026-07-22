import { Controller, Get, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { FopIntegrationService } from './fop-integration.service'

@Controller('autoflow/integrations/fop')
@UseGuards(JwtAuthGuard)
export class FopIntegrationController {
  constructor(private readonly fopIntegrationService: FopIntegrationService) {}

  @Get('capabilities')
  getCapabilities() {
    return this.fopIntegrationService.getCapabilities()
  }
}
