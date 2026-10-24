import { AllowWithoutBusinessData } from '../auth/management-access.decorator'
import { BadRequestException, Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Post, Put, Query, Request, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Request as ExpressRequest } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AssignOrganizationEmployeeDto, CreateEmployeeAccountDto, CreateOrganizationEmployeeDto, CreateOrganizationNodeDto, ImportOrganizationEmployeesDto, OrganizationQueryDto, RemoveOrganizationEmployeesDto, UpdateEmployeeAccountDto, UpdateOrganizationEmployeeDto, UpdateOrganizationNodeDto } from './organization.dto'
import { OrganizationService } from './organization.service'
import { previewEmployeeImport } from './employee-import'

@AllowWithoutBusinessData()
@Controller('organization')
@UseGuards(JwtAuthGuard)
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(@Request() req: ExpressRequest, @Query() _query: OrganizationQueryDto) {
    return this.organization.getManagementWorkspace(req.user!.userId)
  }

  @Post('nodes')
  @Header('Cache-Control', 'private, no-store')
  create(@Request() req: ExpressRequest, @Body() body: CreateOrganizationNodeDto) {
    return this.organization.createNode(req.user!.userId, body)
  }

  @Put('nodes/:id')
  @Header('Cache-Control', 'private, no-store')
  update(@Request() req: ExpressRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateOrganizationNodeDto) {
    return this.organization.updateNode(req.user!.userId, id, body)
  }

  @Delete('nodes/:id')
  @Header('Cache-Control', 'private, no-store')
  delete(@Request() req: ExpressRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.organization.deleteNode(req.user!.userId, id)
  }

  @Put('employees/:id')
  @Header('Cache-Control', 'private, no-store')
  assign(@Request() req: ExpressRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: AssignOrganizationEmployeeDto) {
    return this.organization.assignEmployee(req.user!.userId, id, body.departmentId)
  }

  @Post('employees')
  @Header('Cache-Control', 'private, no-store')
  createEmployee(@Request() req: ExpressRequest, @Body() body: CreateOrganizationEmployeeDto) {
    return this.organization.createEmployee(req.user!.userId, body)
  }

  @Post('employees/:id/account')
  @Header('Cache-Control', 'private, no-store')
  createEmployeeAccount(@Request() req: ExpressRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateEmployeeAccountDto) {
    return this.organization.createEmployeeAccount(req.user!.userId, id, body)
  }

  @Put('employees/:id/details')
  @Header('Cache-Control', 'private, no-store')
  updateEmployee(@Request() req: ExpressRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateOrganizationEmployeeDto) {
    return this.organization.updateEmployee(req.user!.userId, id, body)
  }

  @Post('employees/remove')
  @Header('Cache-Control', 'private, no-store')
  removeEmployees(@Request() req: ExpressRequest, @Body() body: RemoveOrganizationEmployeesDto) {
    return this.organization.removeEmployees(req.user!.userId, body.ids)
  }

  @Post('employees/import')
  @Header('Cache-Control', 'private, no-store')
  importEmployees(@Request() req: ExpressRequest, @Body() body: ImportOrganizationEmployeesDto) {
    return this.organization.importEmployees(req.user!.userId, body.departmentId, body.employees)
  }

  @Post('employees/import-preview')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  async importPreview(@Request() req: ExpressRequest, @Body() body: AssignOrganizationEmployeeDto, @UploadedFile() file: Express.Multer.File) {
    const workspace = await this.organization.getManagementWorkspace(req.user!.userId)
    if (!workspace.nodes.some(node => node.id === body.departmentId && node.kind === 'department')) throw new BadRequestException('请选择可管理的部门')
    const preview = await previewEmployeeImport(file)
    return this.organization.validateImportPreview(req.user!.userId, body.departmentId, preview)
  }

  @Get('accounts/:id')
  @Header('Cache-Control', 'private, no-store')
  getAccount(@Request() req: ExpressRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.organization.getAccount(req.user!.userId, id)
  }

  @Put('accounts/:id')
  @Header('Cache-Control', 'private, no-store')
  updateAccount(@Request() req: ExpressRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateEmployeeAccountDto) {
    return this.organization.updateAccount(req.user!.userId, id, body)
  }
}
