import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common'
import type { Request as ExpressRequest } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { StartSourcingDto } from './dto/start-sourcing.dto'
import { SourcingService } from './sourcing.service'

@Controller('autoflow/workflows/:workflowRunId/sourcing')
@UseGuards(JwtAuthGuard)
export class SourcingController {
  constructor(private readonly sourcingService: SourcingService) {}

  @Get()
  getSummary(
    @Request() request: ExpressRequest,
    @Param('workflowRunId', ParseUUIDPipe) workflowRunId: string,
  ) {
    return this.sourcingService.getSummary(request.user!.userId, workflowRunId)
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
}
