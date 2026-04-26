import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Note, EditorType } from './note.entity'
import ExcelJS from 'exceljs'

/**
 * 店铺信息接口
 */
interface StoreInfo {
  noteName: string
  keyword: string
  searchTime: string
  storeName: string
  storeUrl: string
  traffic: string
}

/**
 * 搜索元信息接口
 */
interface SearchMeta {
  noteName: string
  keyword: string
  searchTime: string
  totalStores: number
}

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
   * 管理员获取所有用户的笔记
   */
  async findAllForAdmin(): Promise<Note[]> {
    return this.notesRepository.find({
      where: { isDeleted: false },
      order: { updatedAt: 'DESC' },
      relations: ['user'],
    })
  }

  /**
   * 管理员删除任意笔记
   */
  async deleteByAdmin(id: string): Promise<void> {
    const note = await this.notesRepository.findOne({ where: { id } })
    if (!note) {
      throw new NotFoundException('笔记不存在')
    }
    await this.notesRepository.remove(note)
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

  /**
   * 将 HTML 内容转换为纯文本
   */
  private htmlToPlainText(html: string): string {
    if (!html) return ''
    // 移除 HTML 标签
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim()
  }

  /**
   * 格式化日期用于导出
   */
  private formatDateForExport(date: Date): string {
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  /**
   * 检查笔记是否是 Shopify 搜索结果
   */
  private isShopifySearchNote(content: string): boolean {
    return content.includes('Shopify店铺搜索结果') || content.includes('Shopify 店铺搜索结果')
  }

  /**
   * 从 HTML 中解析店铺信息和搜索元信息
   */
  private parseStoreInfoFromHtml(html: string, noteTitle: string): { stores: StoreInfo[]; meta: SearchMeta } {
    const stores: StoreInfo[] = []
    const meta: SearchMeta = {
      noteName: noteTitle,
      keyword: '',
      searchTime: '',
      totalStores: 0
    }

    if (!html) return { stores, meta }

    // 提取搜索关键词（关键词搜索）
    const keywordMatch = html.match(/搜索产品[：:]\s*([^<\n]+)/)
    if (keywordMatch) {
      meta.keyword = keywordMatch[1].trim()
    }

    // 提取图片URL（图片搜索）- 从链接中提取
    const imageSearchMatch = html.match(/搜索图片[：:]\s*<a[^>]+href="([^"]+)"/)
    if (imageSearchMatch) {
      meta.keyword = imageSearchMatch[1].trim()
    }

    // 提取搜索时间
    const searchTimeMatch = html.match(/搜索时间[:\s]*([^<\n]+)/)
    if (searchTimeMatch) {
      meta.searchTime = searchTimeMatch[1].trim()
    }

    // 匹配店铺段落 - 格式: <p><strong>1. 店铺名</strong></p>
    const storePattern = /<strong>\s*\d+\.\s*([^<]+)<\/strong>/g
    const urlPattern = /店铺地址[：:]\s*<a[^>]+href="([^"]+)"[^>]*>/g
    const trafficPattern = /流量数据[：:]\s*([^<\n]+)/g

    // 提取所有店铺名
    const storeNames: string[] = []
    let match
    while ((match = storePattern.exec(html)) !== null) {
      storeNames.push(match[1].trim())
    }

    // 提取所有店铺URL
    const storeUrls: string[] = []
    while ((match = urlPattern.exec(html)) !== null) {
      storeUrls.push(match[1].trim())
    }

    // 提取所有流量数据
    const traffics: string[] = []
    while ((match = trafficPattern.exec(html)) !== null) {
      traffics.push(match[1].trim())
    }

    // 组合数据 - 每个店铺独立一行
    for (let i = 0; i < storeNames.length; i++) {
      stores.push({
        noteName: noteTitle,
        keyword: meta.keyword,
        searchTime: meta.searchTime,
        storeName: storeNames[i] || '',
        storeUrl: storeUrls[i] || '',
        traffic: traffics[i] || ''
      })
    }

    meta.totalStores = stores.length

    return { stores, meta }
  }

  /**
   * 导出笔记为 Excel
   */
  async exportToExcel(userId: string, noteIds: string[]): Promise<Buffer> {
    // 获取所有指定的笔记
    const notes = await this.notesRepository.findByIds(noteIds)

    // 过滤出属于当前用户的笔记
    const userNotes = notes.filter(note => note.userId === userId)

    if (userNotes.length === 0) {
      throw new NotFoundException('没有找到可导出的笔记')
    }

    // 分离 Shopify 搜索笔记和普通笔记
    const shopifyNotes = userNotes.filter(note => this.isShopifySearchNote(note.content || ''))
    const regularNotes = userNotes.filter(note => !this.isShopifySearchNote(note.content || ''))

    const workbook = new ExcelJS.Workbook()

    // 如果有 Shopify 搜索结果，创建店铺列表工作表
    if (shopifyNotes.length > 0) {
      const storeWorksheet = workbook.addWorksheet('店铺列表')

      // 收集所有店铺和元信息
      const allStores: StoreInfo[] = []
      const metas: SearchMeta[] = []

      shopifyNotes.forEach(note => {
        const result = this.parseStoreInfoFromHtml(note.content || '', note.title || '无标题')
        allStores.push(...result.stores)
        if (result.stores.length > 0) {
          metas.push(result.meta)
        }
      })

      // 设置列宽
      storeWorksheet.columns = [
        { width: 8 },   // 序号/标签
        { width: 40 },  // 值/店铺名称
        { width: 45 },  // 店铺URL
        { width: 25 },  // 流量数据
        { width: 20 }   // 备注
      ]

      let currentRow = 1

      // 表头区域 - 元信息
      if (metas.length === 1) {
        // 单篇笔记：显示完整元信息
        const meta = metas[0]
        storeWorksheet.getCell(`A${currentRow}`).value = '笔记名称'
        storeWorksheet.getCell(`B${currentRow}`).value = meta.noteName
        storeWorksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'left', vertical: 'middle' }
        storeWorksheet.getCell(`B${currentRow}`).alignment = { horizontal: 'left', vertical: 'middle' }
        storeWorksheet.mergeCells(`B${currentRow}:E${currentRow}`)
        currentRow++

        storeWorksheet.getCell(`A${currentRow}`).value = '搜索关键词'
        storeWorksheet.getCell(`B${currentRow}`).value = meta.keyword
        storeWorksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'left', vertical: 'middle' }
        storeWorksheet.getCell(`B${currentRow}`).alignment = { horizontal: 'left', vertical: 'middle' }
        storeWorksheet.mergeCells(`B${currentRow}:E${currentRow}`)
        currentRow++

        storeWorksheet.getCell(`A${currentRow}`).value = '搜索时间'
        storeWorksheet.getCell(`B${currentRow}`).value = meta.searchTime
        storeWorksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'left', vertical: 'middle' }
        storeWorksheet.getCell(`B${currentRow}`).alignment = { horizontal: 'left', vertical: 'middle' }
        storeWorksheet.mergeCells(`B${currentRow}:E${currentRow}`)
        currentRow++

        storeWorksheet.getCell(`A${currentRow}`).value = '店铺总数'
        storeWorksheet.getCell(`B${currentRow}`).value = String(meta.totalStores)  // 转为字符串确保左对齐
        storeWorksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'left', vertical: 'middle' }
        storeWorksheet.getCell(`B${currentRow}`).alignment = { horizontal: 'left', vertical: 'middle' }
        storeWorksheet.mergeCells(`B${currentRow}:E${currentRow}`)
        currentRow++
      } else {
        // 多篇笔记：显示汇总
        storeWorksheet.getCell(`A${currentRow}`).value = '笔记名称'
        storeWorksheet.getCell(`B${currentRow}`).value = `${metas.length} 篇搜索笔记`
        storeWorksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'left', vertical: 'middle' }
        storeWorksheet.getCell(`B${currentRow}`).alignment = { horizontal: 'left', vertical: 'middle' }
        storeWorksheet.mergeCells(`B${currentRow}:E${currentRow}`)
        currentRow++

        storeWorksheet.getCell(`A${currentRow}`).value = '店铺总数'
        storeWorksheet.getCell(`B${currentRow}`).value = String(allStores.length)  // 转为字符串确保左对齐
        storeWorksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'left', vertical: 'middle' }
        storeWorksheet.getCell(`B${currentRow}`).alignment = { horizontal: 'left', vertical: 'middle' }
        storeWorksheet.mergeCells(`B${currentRow}:E${currentRow}`)
        currentRow++
      }

      // 空行
      currentRow++

      // 数据表头
      storeWorksheet.getCell(`A${currentRow}`).value = '序号'
      storeWorksheet.getCell(`B${currentRow}`).value = '店铺名称'
      storeWorksheet.getCell(`C${currentRow}`).value = '店铺URL'
      storeWorksheet.getCell(`D${currentRow}`).value = '流量数据'
      storeWorksheet.getCell(`E${currentRow}`).value = '备注'
      storeWorksheet.getRow(currentRow).font = { bold: true }
      storeWorksheet.getRow(currentRow).alignment = { horizontal: 'left', vertical: 'middle' }
      storeWorksheet.getRow(currentRow).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      }
      currentRow++

      // 每个店铺一行数据
      allStores.forEach((store, index) => {
        storeWorksheet.getCell(`A${currentRow}`).value = String(index + 1)  // 序号转为字符串左对齐
        storeWorksheet.getCell(`B${currentRow}`).value = store.storeName
        storeWorksheet.getCell(`C${currentRow}`).value = store.storeUrl
        storeWorksheet.getCell(`D${currentRow}`).value = store.traffic
        storeWorksheet.getCell(`E${currentRow}`).value = ''
        // 左对齐
        storeWorksheet.getRow(currentRow).alignment = { horizontal: 'left', vertical: 'middle' }
        currentRow++
      })

      // 如果还有普通笔记，创建笔记工作表
      if (regularNotes.length > 0) {
        const noteWorksheet = workbook.addWorksheet('普通笔记')

        noteWorksheet.columns = [
          { header: '标题', key: 'title', width: 25 },
          { header: '内容', key: 'content', width: 80 },
          { header: '标签', key: 'tags', width: 20 },
          { header: '创建时间', key: 'createdAt', width: 20 },
          { header: '更新时间', key: 'updatedAt', width: 20 },
          { header: '是否收藏', key: 'isFavorite', width: 10 }
        ]

        noteWorksheet.getRow(1).font = { bold: true }
        noteWorksheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        }

        regularNotes.forEach(note => {
          noteWorksheet.addRow({
            title: note.title || '无标题',
            content: this.htmlToPlainText(note.content),
            tags: note.tags?.join(', ') || '',
            createdAt: this.formatDateForExport(note.createdAt),
            updatedAt: this.formatDateForExport(note.updatedAt),
            isFavorite: note.isFavorite ? '是' : '否'
          })
        })
      }
    } else {
      // 只有普通笔记
      const worksheet = workbook.addWorksheet('笔记')

      worksheet.columns = [
        { header: '标题', key: 'title', width: 25 },
        { header: '内容', key: 'content', width: 80 },
        { header: '标签', key: 'tags', width: 20 },
        { header: '创建时间', key: 'createdAt', width: 20 },
        { header: '更新时间', key: 'updatedAt', width: 20 },
        { header: '是否收藏', key: 'isFavorite', width: 10 }
      ]

      worksheet.getRow(1).font = { bold: true }
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      }

      userNotes.forEach(note => {
        worksheet.addRow({
          title: note.title || '无标题',
          content: this.htmlToPlainText(note.content),
          tags: note.tags?.join(', ') || '',
          createdAt: this.formatDateForExport(note.createdAt),
          updatedAt: this.formatDateForExport(note.updatedAt),
          isFavorite: note.isFavorite ? '是' : '否'
        })
      })
    }

    // 生成 Buffer
    const buffer = await workbook.xlsx.writeBuffer()
    return Buffer.from(buffer)
  }
}
