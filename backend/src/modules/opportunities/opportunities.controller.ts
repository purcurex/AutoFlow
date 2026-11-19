import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request, StreamableFile, UseGuards } from '@nestjs/common'
import { Request as ExpressRequest } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { OpportunitiesService } from './opportunities.service'

@Controller('opportunities')
@UseGuards(JwtAuthGuard)
export class OpportunitiesController {
  constructor(private readonly opportunities:OpportunitiesService) {}
  @Get('options') options(@Request() req:ExpressRequest) {return this.opportunities.options(req.user!.userId)}
  @Get('export') async export(@Request() req:ExpressRequest,@Query() query:Record<string,unknown>) {
    return new StreamableFile(await this.opportunities.export(req.user!.userId,query),{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',disposition:'attachment; filename="opportunities.xlsx"'})
  }
  @Get() list(@Request() req:ExpressRequest,@Query() query:Record<string,unknown>) {return this.opportunities.list(req.user!.userId,query)}
  @Get(':id') detail(@Request() req:ExpressRequest,@Param('id',ParseUUIDPipe) id:string) {return this.opportunities.detail(req.user!.userId,id)}
  @Post() create(@Request() req:ExpressRequest,@Body() body:Record<string,unknown>) {return this.opportunities.create(req.user!.userId,body)}
  @Post('from-lead/:leadId') fromLead(@Request() req:ExpressRequest,@Param('leadId',ParseUUIDPipe) leadId:string) {return this.opportunities.fromLead(req.user!.userId,leadId)}
  @Patch(':id') update(@Request() req:ExpressRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:Record<string,unknown>) {return this.opportunities.update(req.user!.userId,id,body)}
  @Post(':id/follow-ups') followUp(@Request() req:ExpressRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:Record<string,unknown>) {return this.opportunities.addFollowUp(req.user!.userId,id,body)}
  @Delete(':id') remove(@Request() req:ExpressRequest,@Param('id',ParseUUIDPipe) id:string,@Query('version') version:string) {return this.opportunities.remove(req.user!.userId,id,/^\d+$/.test(version??'')?Number(version):undefined)}
}
