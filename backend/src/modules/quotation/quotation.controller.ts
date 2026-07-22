import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Request, UseGuards } from '@nestjs/common'
import { Request as ExpressRequest } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CreateQuotationDto, ListQuotationsQueryDto, QuoteDraftDto } from './dto/quotation.dto'
import { QuotationService } from './quotation.service'

@Controller('autoflow/quotes')
@UseGuards(JwtAuthGuard)
export class QuotationController {
  constructor(private readonly quotationService: QuotationService) {}

  @Post()
  create(@Request() request: ExpressRequest, @Body() body: CreateQuotationDto) {
    return this.quotationService.create(request.user!.userId, body)
  }

  @Get()
  list(@Request() request: ExpressRequest, @Query() query: ListQuotationsQueryDto) {
    return this.quotationService.list(request.user!.userId, query.leadId)
  }

  @Get(':id')
  get(@Request() request: ExpressRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotationService.get(request.user!.userId, id)
  }

  @Post(':id/versions')
  createVersion(
    @Request() request: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: QuoteDraftDto,
  ) {
    return this.quotationService.createVersion(request.user!.userId, id, body)
  }
}
