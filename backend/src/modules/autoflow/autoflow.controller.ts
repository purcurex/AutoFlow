import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Request as ExpressRequest } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AutoflowService } from './autoflow.service'
import { WorkbenchAccessService } from '../users/workbench-access.service'
import {
  CreateWorkflowDto,
  CreateWorkflowRevisionDto,
  GenerateMessageDto,
  ListLeadsQueryDto,
  ListOutreachTasksQueryDto,
  ListWorkflowsQueryDto,
  UpdateLeadStatusDto,
  UpdateOutreachTaskDto,
} from './dto/autoflow.dto'
import { WorkflowExecutionService } from '../discovery/workflow-execution.service'
import {
  WORKFLOW_IMAGE_MAX_BYTES,
  WorkflowSeedAssetService,
} from './workflow-seed-asset.service'

@Controller('autoflow')
@UseGuards(JwtAuthGuard)
export class AutoflowController {
  constructor(
    private readonly autoflowService: AutoflowService,
    private readonly workflowExecutionService: WorkflowExecutionService,
    private readonly workflowSeedAssetService: WorkflowSeedAssetService,
    private readonly workbenchAccess: WorkbenchAccessService,
  ) {}

  @Get('dashboard')
  async getDashboard(@Request() req: ExpressRequest) {
    await this.workbenchAccess.requireRole(req.user!.userId, 'sales')
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

  @Get('workflows/:id')
  getWorkflow(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.autoflowService.getWorkflow(req.user!.userId, id)
  }

  @Get('workflows/:id/deletion-impact')
  getWorkflowDeletionImpact(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.autoflowService.getWorkflowDeletionImpact(req.user!.userId, id)
  }

  @Post('workflows/:id/revisions')
  createWorkflowRevision(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateWorkflowRevisionDto,
  ) {
    return this.autoflowService.createWorkflowRevision(req.user!.userId, id, body)
  }

  @Post('workflows/:id/archive')
  archiveWorkflow(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.autoflowService.archiveWorkflow(req.user!.userId, id)
  }

  @Delete('workflows/:id')
  deleteWorkflow(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.autoflowService.deleteWorkflow(req.user!.userId, id)
  }

  @Post('workflow-images')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: WORKFLOW_IMAGE_MAX_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
          callback(new BadRequestException('Only PNG, JPEG, and WebP images are supported.'), false)
          return
        }
        callback(null, true)
      },
    }),
  )
  uploadWorkflowImage(
    @Request() req: ExpressRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.workflowSeedAssetService.save(req.user!.userId, file, req)
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

  @Post('leads/:id/analyze-contacts')
  analyzeLeadContacts(@Request() req: ExpressRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.autoflowService.analyzeLeadContacts(req.user!.userId, id)
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
