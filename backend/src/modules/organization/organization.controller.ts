import { AllowWithoutBusinessData } from '../auth/management-access.decorator'
import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Post, Put, Query, Request, UseGuards } from '@nestjs/common'
import { Request as ExpressRequest } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AssignOrganizationEmployeeDto, CreateOrganizationNodeDto, OrganizationQueryDto, UpdateOrganizationNodeDto } from './organization.dto'
import { OrganizationService } from './organization.service'

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
}
