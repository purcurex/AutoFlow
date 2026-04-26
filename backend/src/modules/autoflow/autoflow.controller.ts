import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AutoflowService } from './autoflow.service'
import {
  CreateWorkflowRequest,
  GenerateMessageRequest,
  LeadStatus,
  UpdateOutreachTaskRequest,
} from './autoflow.types'

@Controller('autoflow')
@UseGuards(JwtAuthGuard)
export class AutoflowController {
  constructor(private readonly autoflowService: AutoflowService) {}

  @Get('dashboard')
  getDashboard() {
    return this.autoflowService.getDashboard()
  }

  @Get('workflows')
  getWorkflows() {
    return this.autoflowService.getWorkflows()
  }

  @Post('workflows')
  createWorkflow(@Body() body: CreateWorkflowRequest) {
    return this.autoflowService.createWorkflow(body)
  }

  @Get('leads')
  getLeads(@Query('status') status?: LeadStatus) {
    return this.autoflowService.getLeads(status)
  }

  @Get('leads/:id')
  getLead(@Param('id') id: string) {
    return this.autoflowService.getLead(id)
  }

  @Post('leads/:id/messages')
  generateMessage(@Param('id') id: string, @Body() body: GenerateMessageRequest) {
    return this.autoflowService.generateMessage(id, body)
  }

  @Get('outreach-tasks')
  getOutreachTasks() {
    return this.autoflowService.getOutreachTasks()
  }

  @Patch('outreach-tasks/:id')
  updateOutreachTask(@Param('id') id: string, @Body() body: UpdateOutreachTaskRequest) {
    return this.autoflowService.updateOutreachTask(id, body)
  }

  @Get('crm')
  getCrm() {
    return this.autoflowService.getCrm()
  }
}
