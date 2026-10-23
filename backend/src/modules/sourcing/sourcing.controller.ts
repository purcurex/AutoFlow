import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common'
import type { Request as ExpressRequest } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { StartSourcingDto } from './dto/start-sourcing.dto'
import { ListSourcingDto } from './dto/list-sourcing.dto'
import { ExtendSourcingWindowDto } from './dto/extend-sourcing-window.dto'
import { SourcingService } from './sourcing.service'

@Controller('autoflow/workflows/:workflowRunId/sourcing')
@UseGuards(JwtAuthGuard)
export class SourcingController {
  constructor(private readonly sourcingService: SourcingService) {}

  @Get()
  getSummary(
    @Request() request: ExpressRequest,
    @Param('workflowRunId', ParseUUIDPipe) workflowRunId: string,
    @Query() query: ListSourcingDto,
  ) {
    return this.sourcingService.getSummary(request.user!.userId, workflowRunId, query)
  }

  @Post('search')
  @HttpCode(HttpStatus.ACCEPTED)
  startSearch(
    @Request() request: ExpressRequest,
    @Param('workflowRunId', ParseUUIDPipe) workflowRunId: string,
    @Body() body: StartSourcingDto,
  ) {
    return this.sourcingService.startSearch(request.user!.userId, workflowRunId, body)
  }

  @Post('searches/:searchId/pages/:pageNumber')
  @HttpCode(HttpStatus.ACCEPTED)
  requestPage(
    @Request() request: ExpressRequest,
    @Param('workflowRunId', ParseUUIDPipe) workflowRunId: string,
    @Param('searchId', ParseUUIDPipe) searchId: string,
    @Param('pageNumber', ParseIntPipe) pageNumber: number,
  ) {
    return this.sourcingService.requestPage(
      request.user!.userId,
      workflowRunId,
      searchId,
      pageNumber,
    )
  }

  @Post('searches/:searchId/window')
  @HttpCode(HttpStatus.OK)
  extendResultWindow(
    @Request() request: ExpressRequest,
    @Param('workflowRunId', ParseUUIDPipe) workflowRunId: string,
    @Param('searchId', ParseUUIDPipe) searchId: string,
    @Body() body: ExtendSourcingWindowDto,
  ) {
    return this.sourcingService.extendResultWindow(
      request.user!.userId,
      workflowRunId,
      searchId,
      body.targetLimit,
    )
  }
}
