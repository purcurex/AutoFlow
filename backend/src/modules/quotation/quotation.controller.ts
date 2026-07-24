import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common'
import { Request as ExpressRequest, Response } from 'express'
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

  @Get(':id/versions/:version/export.xlsx')
  async exportVersion(
    @Request() request: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
    @Res() response: Response,
  ) {
    const buffer = await this.quotationService.exportVersion(request.user!.userId, id, version)
    const asciiFilename = `AutoFlow-Quotation-${id}-v${version}.xlsx`
    const localizedFilename = encodeURIComponent(`AutoFlow报价_${id}_V${version}.xlsx`)
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${localizedFilename}`,
    )
    response.send(buffer)
  }

  @Post(':id/request-fop')
  requestFopQuote(
    @Request() request: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotationService.requestFopQuote(request.user!.userId, id)
  }
}
