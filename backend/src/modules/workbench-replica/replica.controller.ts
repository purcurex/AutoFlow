import { Body, Controller, Get, Header, Param, Post, Request, UseGuards } from '@nestjs/common'
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator'
import { Request as ExpressRequest } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { ReplicaSyncService } from './replica-sync.service'
import { ReplicaBootstrapService } from './replica-bootstrap.service'

export class ReplicaSyncRequestDto {
  @IsOptional() @IsIn(['manual', 'navigation']) trigger?: 'manual' | 'navigation'
  @IsString() @MaxLength(96) @Matches(/^[A-Za-z0-9:_-]+$/) requestKey: string
}
export class ReplicaBootstrapRequestDto {
  @IsUUID() companyId: string
  @IsString() @MaxLength(96) @Matches(/^[A-Za-z0-9:_-]+$/) requestKey: string
}

@Controller('workbench/replica')
@UseGuards(JwtAuthGuard)
export class ReplicaController {
  constructor(private readonly sync: ReplicaSyncService, private readonly bootstrap: ReplicaBootstrapService) {}
  @Post('bootstrap/configure') @Header('Cache-Control', 'private, no-store')
  configure(@Request() req: ExpressRequest) { return this.bootstrap.configure(req.user!.userId) }
  @Post('bootstrap') @Header('Cache-Control', 'private, no-store')
  initialize(@Request() req: ExpressRequest, @Body() body: ReplicaBootstrapRequestDto) { return this.bootstrap.initialize(req.user!.userId, body.companyId, body.requestKey) }
  @Post('bootstrap/status') @Header('Cache-Control', 'private, no-store')
  bootstrapStatus(@Request() req: ExpressRequest, @Body() body: ReplicaBootstrapRequestDto) { return this.bootstrap.status(req.user!.userId, body.companyId, body.requestKey) }
  @Get('status') @Header('Cache-Control', 'private, no-store')
  async status(@Request() req: ExpressRequest) { return { ...await this.sync.status(req.user!.userId), bootstrap: await this.bootstrap.readiness(req.user!.userId) } }
  @Post('sync') @Header('Cache-Control', 'private, no-store')
  request(@Request() req: ExpressRequest, @Body() body: ReplicaSyncRequestDto) { return this.sync.request(req.user!.userId, body.requestKey, body.trigger) }
  @Get('sync/:id') @Header('Cache-Control', 'private, no-store')
  job(@Request() req: ExpressRequest, @Param('id') id: string) { return this.sync.job(req.user!.userId, id) }
}
