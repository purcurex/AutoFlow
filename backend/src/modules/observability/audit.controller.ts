import { Controller, Get, Request, UseGuards } from '@nestjs/common'
import type { Request as ExpressRequest } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AuditService } from './audit.service'

@Controller('autoflow/audit-events')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list(@Request() request: ExpressRequest) {
    return this.auditService.listForActor(request.user!.userId)
  }
}
