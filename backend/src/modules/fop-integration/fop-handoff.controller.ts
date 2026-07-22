import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common'
import { Request as ExpressRequest } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CreateFopHandoffDto } from './fop-handoff.dto'
import { FopHandoffService } from './fop-handoff.service'

@Controller('autoflow/leads/:leadId/fop-handoff')
@UseGuards(JwtAuthGuard)
export class FopHandoffController {
  constructor(private readonly handoffService: FopHandoffService) {}

  @Get()
  get(@Request() request: ExpressRequest, @Param('leadId', ParseUUIDPipe) leadId: string) {
    return this.handoffService.getForLead(request.user!.userId, leadId)
  }

  @Post()
  create(
    @Request() request: ExpressRequest,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() body: CreateFopHandoffDto,
  ) {
    return this.handoffService.handoff(request.user!.userId, leadId, body.reason)
  }
}
