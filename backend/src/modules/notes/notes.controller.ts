import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common'
import { NotesService } from './notes.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CreateNoteDto, UpdateNoteDto, ReorderNotesDto } from './dto/note.dto'
import { Request as ExpressRequest } from 'express'

@Controller('notes')
@UseGuards(JwtAuthGuard)
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Get()
  async findAll(@Request() req: ExpressRequest) {
    return this.notesService.findAll(req.user!.userId)
  }

  @Get('trash')
  async getTrash(@Request() req: ExpressRequest) {
    return this.notesService.getTrash(req.user!.userId)
  }

  @Get('search')
  async search(@Request() req: ExpressRequest, @Query('q') query: string) {
    return this.notesService.search(req.user!.userId, query)
  }

  @Get(':id')
  async findById(@Request() req: ExpressRequest, @Param('id') id: string) {
    return this.notesService.findById(id, req.user!.userId)
  }

  @Post()
  async create(@Request() req: ExpressRequest, @Body() createNoteDto: CreateNoteDto) {
    return this.notesService.create(req.user!.userId, createNoteDto)
  }

  @Put('reorder')
  async reorder(@Request() req: ExpressRequest, @Body() reorderDto: ReorderNotesDto) {
    await this.notesService.reorder(req.user!.userId, reorderDto.noteIds)
    return { message: '排序更新成功' }
  }

  @Put(':id')
  async update(
    @Request() req: ExpressRequest,
    @Param('id') id: string,
    @Body() updateNoteDto: UpdateNoteDto,
  ) {
    return this.notesService.update(id, req.user!.userId, updateNoteDto)
  }

  @Delete(':id')
  async remove(@Request() req: ExpressRequest, @Param('id') id: string) {
    await this.notesService.softDelete(id, req.user!.userId)
    return { message: '笔记已移至回收站' }
  }

  @Post(':id/restore')
  async restore(@Request() req: ExpressRequest, @Param('id') id: string) {
    return this.notesService.restore(id, req.user!.userId)
  }

  @Delete(':id/permanent')
  async permanentDelete(@Request() req: ExpressRequest, @Param('id') id: string) {
    await this.notesService.permanentDelete(id, req.user!.userId)
    return { message: '笔记已永久删除' }
  }
}
