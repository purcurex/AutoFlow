import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Note, EditorType } from './note.entity'

@Injectable()
export class NotesService {
  constructor(
    @InjectRepository(Note)
    private notesRepository: Repository<Note>,
  ) {}

  async findAll(userId: string): Promise<Note[]> {
    // 获取所有笔记，按 sortOrder 升序，再按 updatedAt 降序
    const notes = await this.notesRepository.find({
      where: { userId, isDeleted: false },
      order: { sortOrder: 'ASC', updatedAt: 'DESC' },
    })

    // 将空笔记排到最前面
    return this.sortNotesWithEmptyFirst(notes)
  }

  /**
   * 将空笔记排在最前面
   */
  private sortNotesWithEmptyFirst(notes: Note[]): Note[] {
    const emptyNotes = notes.filter(n => this.isEmptyNote(n))
    const otherNotes = notes.filter(n => !this.isEmptyNote(n))
    return [...emptyNotes, ...otherNotes]
  }

  async findById(id: string, userId: string): Promise<Note> {
    const note = await this.notesRepository.findOne({
      where: { id, userId },
    })
    if (!note) {
      throw new NotFoundException('笔记不存在')
    }
    return note
  }

  async create(userId: string, data: Partial<Note>): Promise<Note> {
    // 检查是否是创建空笔记
    const isEmptyNote = (!data.title || data.title === '无标题笔记' || data.title.trim() === '') &&
                        (!data.content || data.content.trim() === '')

    if (isEmptyNote) {
      // 查找是否已存在空笔记
      const existingEmptyNote = await this.notesRepository.findOne({
        where: {
          userId,
          isDeleted: false,
        },
      })

      // 查找标题为空或"无标题"且内容为空的笔记
      const allNotes = await this.notesRepository.find({
        where: { userId, isDeleted: false },
      })

      const emptyNote = allNotes.find(n => this.isEmptyNote(n))
      if (emptyNote) {
        // 返回已存在的空笔记
        return emptyNote
      }
    }

    // 获取当前最大的 sortOrder
    const maxSortOrder = await this.notesRepository
      .createQueryBuilder('note')
      .select('MAX(note.sortOrder)', 'max')
      .where('note.userId = :userId', { userId })
      .getRawOne()

    const sortOrder = (maxSortOrder?.max || 0) + 1

    const note = this.notesRepository.create({
      userId,
      title: data.title || '无标题笔记',
      content: data.content || '',
      folderId: data.folderId ?? null,
      editorType: data.editorType || EditorType.MARKDOWN,
      tags: data.tags || [],
      sortOrder: data.sortOrder ?? sortOrder,
    })
    return this.notesRepository.save(note)
  }

  async update(id: string, userId: string, data: Partial<Note>): Promise<Note> {
    const note = await this.findById(id, userId)
    Object.assign(note, data)
    return this.notesRepository.save(note)
  }

  async softDelete(id: string, userId: string): Promise<void> {
    const note = await this.findById(id, userId)
    note.isDeleted = true
    note.deletedAt = new Date()
    await this.notesRepository.save(note)
  }

  async restore(id: string, userId: string): Promise<Note> {
    const note = await this.notesRepository.findOne({
      where: { id, userId, isDeleted: true },
    })
    if (!note) {
      throw new NotFoundException('笔记不存在')
    }
    note.isDeleted = false
    note.deletedAt = null
    return this.notesRepository.save(note)
  }

  async permanentDelete(id: string, userId: string): Promise<void> {
    const note = await this.notesRepository.findOne({
      where: { id, userId },
    })
    if (!note) {
      throw new NotFoundException('笔记不存在')
    }
    await this.notesRepository.remove(note)
  }

  async getTrash(userId: string): Promise<Note[]> {
    return this.notesRepository.find({
      where: { userId, isDeleted: true },
      order: { deletedAt: 'DESC' },
    })
  }

  async search(userId: string, query: string): Promise<Note[]> {
    return this.notesRepository
      .createQueryBuilder('note')
      .where('note.userId = :userId', { userId })
      .andWhere('note.isDeleted = false')
      .andWhere('(note.title ILIKE :query OR note.content ILIKE :query)', {
        query: `%${query}%`,
      })
      .orderBy('note.sortOrder', 'ASC')
      .addOrderBy('note.updatedAt', 'DESC')
      .getMany()
  }

  /**
   * 检查是否是空笔记
   */
  private isEmptyNote(note: Partial<Note>): boolean {
    const title = (note.title || '').trim()
    const content = (note.content || '').trim()
    return (title === '' || title === '无标题' || title === '无标题笔记') && content === ''
  }

  /**
   * 重新排序笔记
   */
  async reorder(userId: string, noteIds: string[]): Promise<void> {
    for (let i = 0; i < noteIds.length; i++) {
      await this.notesRepository.update(
        { id: noteIds[i], userId },
        { sortOrder: i }
      )
    }
  }
}
