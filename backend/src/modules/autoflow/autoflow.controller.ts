import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common'
import { Request as ExpressRequest } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AutoflowService } from './autoflow.service'
import {
  CreateWorkflowDto,
  GenerateMessageDto,
  ListLeadsQueryDto,
  ListOutreachTasksQueryDto,
  ListWorkflowsQueryDto,
  UpdateLeadStatusDto,
  UpdateOutreachTaskDto,
} from './dto/autoflow.dto'
import { WorkflowExecutionService } from '../discovery/workflow-execution.service'

@Controller('autoflow')
@UseGuards(JwtAuthGuard)
export class AutoflowController {
  constructor(
    private readonly autoflowService: AutoflowService,
    private readonly workflowExecutionService: WorkflowExecutionService,
  ) {}

  @Get('dashboard')
  getDashboard(@Request() req: ExpressRequest) {
    return this.autoflowService.getDashboard(req.user!.userId)
  }

  @Get('workflows')
  getWorkflows(@Request() req: ExpressRequest, @Query() query: ListWorkflowsQueryDto) {
    return this.autoflowService.getWorkflows(req.user!.userId, query)
  }

  @Post('workflows')
  createWorkflow(@Request() req: ExpressRequest, @Body() body: CreateWorkflowDto) {
    return this.autoflowService.createWorkflow(req.user!.userId, body)
  }

  @Post('workflows/:id/start-discovery')
  @HttpCode(HttpStatus.ACCEPTED)
  startDiscovery(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workflowExecutionService.startDiscovery(req.user!.userId, id)
  }

  @Get('leads')
  getLeads(@Request() req: ExpressRequest, @Query() query: ListLeadsQueryDto) {
    return this.autoflowService.getLeads(req.user!.userId, query)
  }

  @Get('leads/:id')
  getLead(@Request() req: ExpressRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.autoflowService.getLead(req.user!.userId, id)
  }

  @Patch('leads/:id/status')
  updateLeadStatus(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateLeadStatusDto,
  ) {
    return this.autoflowService.updateLeadStatus(req.user!.userId, id, body)
  }

  @Post('leads/:id/messages')
  generateMessage(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GenerateMessageDto,
  ) {
    return this.autoflowService.generateMessage(req.user!.userId, id, body)
  }

  @Get('outreach-tasks')
  getOutreachTasks(@Request() req: ExpressRequest, @Query() query: ListOutreachTasksQueryDto) {
    return this.autoflowService.getOutreachTasks(req.user!.userId, query)
  }

  @Patch('outreach-tasks/:id')
  updateOutreachTask(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateOutreachTaskDto,
  ) {
    return this.autoflowService.updateOutreachTask(req.user!.userId, id, body)
  }

  @Get('crm')
  getCrm(@Request() req: ExpressRequest) {
    return this.autoflowService.getFollowUps(req.user!.userId)
  }

  @Get('follow-ups')
  getFollowUps(@Request() req: ExpressRequest) {
    return this.autoflowService.getFollowUps(req.user!.userId)
  }
}
