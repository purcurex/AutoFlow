import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common'
import { FoldersService } from './folders.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CreateFolderDto, UpdateFolderDto } from './dto/folder.dto'
import { Request as ExpressRequest } from 'express'

@Controller('folders')
@UseGuards(JwtAuthGuard)
export class FoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  @Get()
  async findAll(@Request() req: ExpressRequest) {
    return this.foldersService.findAll(req.user!.userId)
  }

  @Get(':id')
  async findById(@Request() req: ExpressRequest, @Param('id') id: string) {
    return this.foldersService.findById(id, req.user!.userId)
  }

  @Post()
  async create(@Request() req: ExpressRequest, @Body() createFolderDto: CreateFolderDto) {
    return this.foldersService.create(
      req.user!.userId,
      createFolderDto.name,
      createFolderDto.parentId,
    )
  }

  @Put(':id')
  async update(
    @Request() req: ExpressRequest,
    @Param('id') id: string,
    @Body() updateFolderDto: UpdateFolderDto,
  ) {
    return this.foldersService.update(id, req.user!.userId, updateFolderDto)
  }

  @Delete(':id')
  async remove(@Request() req: ExpressRequest, @Param('id') id: string) {
    await this.foldersService.delete(id, req.user!.userId)
    return { message: '文件夹已删除' }
  }
}
