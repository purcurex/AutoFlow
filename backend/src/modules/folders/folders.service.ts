import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, IsNull } from 'typeorm'
import { Folder } from './folder.entity'
import { Note } from '../notes/note.entity'

@Injectable()
export class FoldersService {
  constructor(
    @InjectRepository(Folder)
    private foldersRepository: Repository<Folder>,
    @InjectRepository(Note)
    private notesRepository: Repository<Note>,
  ) {}

  async findAll(userId: string): Promise<Folder[]> {
    return this.foldersRepository.find({
      where: { userId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    })
  }

  async findById(id: string, userId: string): Promise<Folder> {
    const folder = await this.foldersRepository.findOne({
      where: { id, userId },
    })
    if (!folder) {
      throw new NotFoundException('文件夹不存在')
    }
    return folder
  }

  async create(userId: string, name: string, parentId?: string): Promise<Folder> {
    // 检查同级目录下是否有同名文件夹
    const existing = await this.foldersRepository.findOne({
      where: {
        userId,
        name,
        parentId: parentId ? parentId : IsNull(),
      },
    })
    if (existing) {
      throw new ConflictException('该目录下已存在同名文件夹')
    }

    // 获取排序号
    const maxOrder = await this.foldersRepository
      .createQueryBuilder('folder')
      .where('folder.userId = :userId', { userId })
      .andWhere(parentId ? 'folder.parentId = :parentId' : 'folder.parentId IS NULL', { parentId })
      .select('MAX(folder.sortOrder)', 'max')
      .getRawOne()

    const sortOrder = (maxOrder?.max || 0) + 1

    const folder = this.foldersRepository.create({
      userId,
      name,
      parentId: parentId || null,
      sortOrder,
    })
    return this.foldersRepository.save(folder)
  }

  async update(id: string, userId: string, data: Partial<Folder>): Promise<Folder> {
    const folder = await this.findById(id, userId)
    Object.assign(folder, data)
    return this.foldersRepository.save(folder)
  }

  async delete(id: string, userId: string): Promise<void> {
    const folder = await this.findById(id, userId)

    // 检查是否有子文件夹
    const children = await this.foldersRepository.find({
      where: { parentId: id },
    })
    if (children.length > 0) {
      throw new ConflictException('该文件夹下有子文件夹，无法删除')
    }

    // 检查是否有笔记
    const notesCount = await this.notesRepository.count({
      where: { folderId: id },
    })
    if (notesCount > 0) {
      throw new ConflictException('该文件夹下有笔记，请先移动或删除笔记')
    }

    await this.foldersRepository.remove(folder)
  }

  /**
   * 重新排序文件夹
   */
  async reorder(userId: string, folderIds: string[]): Promise<void> {
    for (let i = 0; i < folderIds.length; i++) {
      await this.foldersRepository.update(
        { id: folderIds[i], userId },
        { sortOrder: i }
      )
    }
  }
}
