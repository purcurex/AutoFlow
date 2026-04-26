import * as XLSX from 'xlsx'
import html2pdf from 'html2pdf.js'
import type { Note } from '@/types'

/**
 * 店铺信息接口
 */
export interface StoreInfo {
  noteName: string
  keyword: string
  searchTime: string
  storeName: string
  storeUrl: string
  traffic: string
}

/**
 * 搜索元信息
 */
export interface SearchMeta {
  noteName: string
  keyword: string
  searchTime: string
  totalStores: number
}

/**
 * 将 HTML 内容转换为纯文本
 */
export function htmlToPlainText(html: string): string {
  if (!html) return ''

  // 创建临时元素来解析 HTML
  const temp = document.createElement('div')
  temp.innerHTML = html

  // 处理换行
  temp.querySelectorAll('br').forEach(br => br.replaceWith('\n'))
  temp.querySelectorAll('p, div').forEach(el => {
    el.insertAdjacentText('afterend', '\n')
  })
  temp.querySelectorAll('li').forEach(el => {
    el.insertAdjacentText('afterend', '\n')
  })

  return temp.textContent || temp.innerText || ''
}

/**
 * 从笔记 HTML 内容中解析店铺信息和搜索元信息
 */
export function parseStoreInfoFromHtml(html: string, noteTitle: string): { stores: StoreInfo[]; meta: SearchMeta } {
  const stores: StoreInfo[] = []
  const meta: SearchMeta = {
    noteName: noteTitle,
    keyword: '',
    searchTime: '',
    totalStores: 0
  }

  if (!html) return { stores, meta }

  const temp = document.createElement('div')
  temp.innerHTML = html

  // 提取搜索关键词/图片URL
  const pElements = temp.querySelectorAll('p')
  pElements.forEach(p => {
    const text = p.textContent || ''

    // 关键词搜索：匹配 "搜索产品：xxx"
    const productMatch = text.match(/搜索产品[：:]\s*(.+)/)
    if (productMatch) {
      meta.keyword = productMatch[1].trim()
    }

    // 图片搜索：匹配 "搜索图片：" 并提取链接
    if (text.includes('搜索图片')) {
      const linkEl = p.querySelector('a')
      if (linkEl) {
        meta.keyword = linkEl.getAttribute('href') || linkEl.textContent || ''
      }
    }
  })

  // 提取搜索时间
  const emElements = temp.querySelectorAll('em')
  emElements.forEach(em => {
    const text = em.textContent || ''
    if (text.includes('搜索时间')) {
      const match = text.match(/搜索时间[：:\s]*(.+)/)
      if (match) {
        meta.searchTime = match[1].trim()
      }
    }
  })

  // 提取店铺总数
  pElements.forEach(p => {
    const text = p.textContent || ''
    const totalMatch = text.match(/共找到\s*(\d+)\s*个/)
    if (totalMatch) {
      meta.totalStores = parseInt(totalMatch[1], 10)
    }
  })

  // 解析店铺信息
  let currentStoreName = ''
  let currentStoreUrl = ''
  let currentTraffic = ''

  pElements.forEach(p => {
    const strongEl = p.querySelector('strong')
    if (strongEl) {
      const strongText = strongEl.textContent || ''
      // 匹配 "1. 店铺名称" 格式
      const storeMatch = strongText.match(/^\d+\.\s*(.+)$/)
      if (storeMatch) {
        // 保存上一个店铺
        if (currentStoreName) {
          stores.push({
            noteName: noteTitle,
            keyword: meta.keyword,
            searchTime: meta.searchTime,
            storeName: currentStoreName,
            storeUrl: currentStoreUrl,
            traffic: currentTraffic
          })
        }
        currentStoreName = storeMatch[1].trim()
        currentStoreUrl = ''
        currentTraffic = ''
      }
    }

    // 提取店铺地址
    const linkEl = p.querySelector('a')
    if (linkEl && currentStoreName) {
      const href = linkEl.getAttribute('href') || ''
      const pText = p.textContent || ''
      // 判断是否是店铺地址行
      if (pText.includes('店铺地址') && href) {
        currentStoreUrl = href
      }
    }

    // 提取流量数据
    const pText = p.textContent || ''
    if (pText.includes('流量数据') && currentStoreName) {
      const match = pText.match(/流量数据[：:\s]*(.+)/)
      if (match) {
        currentTraffic = match[1].trim()
      }
    }
  })

  // 保存最后一个店铺
  if (currentStoreName) {
    stores.push({
      noteName: noteTitle,
      keyword: meta.keyword,
      searchTime: meta.searchTime,
      storeName: currentStoreName,
      storeUrl: currentStoreUrl,
      traffic: currentTraffic
    })
  }

  meta.totalStores = stores.length

  return { stores, meta }
}

/**
 * 从笔记中解析所有店铺信息
 */
export function parseStoresFromNotes(notes: Note[]): { stores: StoreInfo[]; metas: SearchMeta[] } {
  const allStores: StoreInfo[] = []
  const metas: SearchMeta[] = []

  notes.forEach(note => {
    const result = parseStoreInfoFromHtml(note.content, note.title || '无标题')
    allStores.push(...result.stores)
    if (result.stores.length > 0) {
      metas.push(result.meta)
    }
  })

  return { stores: allStores, metas }
}

/**
 * 下载 Blob 文件
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * 格式化日期用于导出
 */
export function formatDateForExport(dateString: string): string {
  const date = new Date(dateString)
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
function isShopifySearchNote(note: Note): boolean {
  const content = note.content || ''
  return content.includes('Shopify店铺搜索结果') || content.includes('Shopify 店铺搜索结果')
}

/**
 * 设置单元格左对齐样式
 */
function setLeftAlignment(ws: XLSX.WorkSheet, rows: number, cols: number): void {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
  for (let r = range.s.r; r <= Math.min(rows, range.e.r); r++) {
    for (let c = range.s.c; c <= Math.min(cols, range.e.c); c++) {
      const cellAddress = XLSX.utils.encode_cell({ r, c })
      if (ws[cellAddress]) {
        ws[cellAddress].s = { alignment: { horizontal: 'left', vertical: 'center' } }
      }
    }
  }
}

/**
 * 导出单个笔记为 Excel
 */
export function exportNoteToExcel(note: Note): void {
  // 检查是否是 Shopify 搜索结果笔记
  if (isShopifySearchNote(note)) {
    const { stores, meta } = parseStoreInfoFromHtml(note.content, note.title || '无标题')

    if (stores.length > 0) {
      // 构建数据 - 表头区域存放元信息
      const data: (string | number)[][] = [
        ['笔记名称', meta.noteName, '', '', '', ''],
        ['搜索关键词', meta.keyword, '', '', '', ''],
        ['搜索时间', meta.searchTime, '', '', '', ''],
        ['店铺总数', meta.totalStores, '', '', '', ''],
        ['', '', '', '', '', ''],  // 空行
        ['序号', '店铺名称', '店铺URL', '流量数据', '备注', '']  // 数据表头
      ]

      // 每个店铺一行
      stores.forEach((store, index) => {
        data.push([
          String(index + 1),  // 序号转为字符串确保左对齐
          store.storeName,
          store.storeUrl,
          store.traffic,
          ''
        ])
      })

      const ws = XLSX.utils.aoa_to_sheet(data)

      // 设置列宽
      ws['!cols'] = [
        { wch: 8 },   // 序号/标签
        { wch: 40 },  // 店铺名称/值
        { wch: 45 },  // 店铺URL
        { wch: 25 },  // 流量数据
        { wch: 20 }   // 备注
      ]

      // 合并表头区域的单元格（元信息行）
      ws['!merges'] = [
        { s: { r: 0, c: 1 }, e: { r: 0, c: 4 } },  // 笔记名称
        { s: { r: 1, c: 1 }, e: { r: 1, c: 4 } },  // 搜索关键词
        { s: { r: 2, c: 1 }, e: { r: 2, c: 4 } },  // 搜索时间
        { s: { r: 3, c: 1 }, e: { r: 3, c: 4 } },  // 店铺总数
      ]

      // 设置左对齐
      setLeftAlignment(ws, data.length, 5)

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '店铺列表')

      const filename = `${note.title || '店铺导出'}_${new Date().toISOString().slice(0, 10)}.xlsx`
      XLSX.writeFile(wb, filename)
      return
    }
  }

  // 普通笔记导出
  const plainContent = htmlToPlainText(note.content)

  const data = [
    ['标题', '内容', '标签', '创建时间', '更新时间', '是否收藏'],
    [
      note.title || '无标题',
      plainContent,
      note.tags?.join(', ') || '',
      formatDateForExport(note.createdAt),
      formatDateForExport(note.updatedAt),
      note.isFavorite ? '是' : '否'
    ]
  ]

  const ws = XLSX.utils.aoa_to_sheet(data)

  // 设置列宽
  ws['!cols'] = [
    { wch: 20 },  // 标题
    { wch: 80 },  // 内容
    { wch: 20 },  // 标签
    { wch: 20 },  // 创建时间
    { wch: 20 },  // 更新时间
    { wch: 10 }   // 是否收藏
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '笔记')

  const filename = `${note.title || '无标题笔记'}_${new Date().toISOString().slice(0, 10)}.xlsx`
  XLSX.writeFile(wb, filename)
}

/**
 * 导出多个笔记为 Excel
 */
export function exportNotesToExcel(notes: Note[]): void {
  // 检查是否包含 Shopify 搜索结果笔记
  const shopifyNotes = notes.filter(isShopifySearchNote)
  const regularNotes = notes.filter(n => !isShopifySearchNote(n))

  // 如果有 Shopify 搜索结果，使用店铺格式导出
  if (shopifyNotes.length > 0) {
    const { stores, metas } = parseStoresFromNotes(shopifyNotes)

    if (stores.length > 0) {
      // 构建数据
      const data: (string | number)[][] = []

      // 如果只有一篇搜索笔记，显示完整元信息
      if (metas.length === 1) {
        const meta = metas[0]
        data.push(
          ['笔记名称', meta.noteName, '', '', '', ''],
          ['搜索关键词', meta.keyword, '', '', '', ''],
          ['搜索时间', meta.searchTime, '', '', '', ''],
          ['店铺总数', meta.totalStores, '', '', '', ''],
          ['', '', '', '', '', ''],
          ['序号', '店铺名称', '店铺URL', '流量数据', '备注', '']
        )
      } else {
        // 多篇搜索笔记，显示汇总信息
        data.push(
          ['笔记名称', `${metas.length} 篇搜索笔记`, '', '', '', ''],
          ['店铺总数', stores.length, '', '', '', ''],
          ['', '', '', '', '', ''],
          ['序号', '店铺名称', '店铺URL', '流量数据', '备注', '']
        )
      }

      // 每个店铺一行
      stores.forEach((store, index) => {
        data.push([
          String(index + 1),  // 序号转为字符串确保左对齐
          store.storeName,
          store.storeUrl,
          store.traffic,
          ''
        ])
      })

      // 如果还有普通笔记，追加到新工作表
      let wb: XLSX.WorkBook
      const ws = XLSX.utils.aoa_to_sheet(data)

      ws['!cols'] = [
        { wch: 8 },   // 序号/标签
        { wch: 40 },  // 店铺名称/值
        { wch: 45 },  // 店铺URL
        { wch: 25 },  // 流量数据
        { wch: 20 }   // 备注
      ]

      // 合并表头单元格
      if (metas.length === 1) {
        ws['!merges'] = [
          { s: { r: 0, c: 1 }, e: { r: 0, c: 4 } },
          { s: { r: 1, c: 1 }, e: { r: 1, c: 4 } },
          { s: { r: 2, c: 1 }, e: { r: 2, c: 4 } },
          { s: { r: 3, c: 1 }, e: { r: 3, c: 4 } },
        ]
      } else {
        ws['!merges'] = [
          { s: { r: 0, c: 1 }, e: { r: 0, c: 4 } },
          { s: { r: 1, c: 1 }, e: { r: 1, c: 4 } },
        ]
      }

      // 设置左对齐
      setLeftAlignment(ws, data.length, 5)

      wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '店铺列表')

      // 添加普通笔记工作表
      if (regularNotes.length > 0) {
        const noteData = [
          ['标题', '内容', '标签', '创建时间', '更新时间', '是否收藏']
        ]

        regularNotes.forEach(note => {
          const plainContent = htmlToPlainText(note.content)
          noteData.push([
            note.title || '无标题',
            plainContent,
            note.tags?.join(', ') || '',
            formatDateForExport(note.createdAt),
            formatDateForExport(note.updatedAt),
            note.isFavorite ? '是' : '否'
          ])
        })

        const noteWs = XLSX.utils.aoa_to_sheet(noteData)
        noteWs['!cols'] = [
          { wch: 20 },
          { wch: 80 },
          { wch: 20 },
          { wch: 20 },
          { wch: 20 },
          { wch: 10 }
        ]
        XLSX.utils.book_append_sheet(wb, noteWs, '普通笔记')
      }

      const filename = `店铺导出_${stores.length}家_${new Date().toISOString().slice(0, 10)}.xlsx`
      XLSX.writeFile(wb, filename)
      return
    }
  }

  // 普通笔记批量导出
  const data = [
    ['标题', '内容', '标签', '创建时间', '更新时间', '是否收藏']
  ]

  notes.forEach(note => {
    const plainContent = htmlToPlainText(note.content)
    data.push([
      note.title || '无标题',
      plainContent,
      note.tags?.join(', ') || '',
      formatDateForExport(note.createdAt),
      formatDateForExport(note.updatedAt),
      note.isFavorite ? '是' : '否'
    ])
  })

  const ws = XLSX.utils.aoa_to_sheet(data)

  ws['!cols'] = [
    { wch: 20 },
    { wch: 80 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
    { wch: 10 }
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '笔记')

  const filename = `笔记导出_${notes.length}篇_${new Date().toISOString().slice(0, 10)}.xlsx`
  XLSX.writeFile(wb, filename)
}

/**
 * 导出单个笔记为 PDF
 */
export function exportNoteToPdf(note: Note, username?: string): void {
  const plainContent = htmlToPlainText(note.content)
  const creatorName = username || '未知用户'

  const element = document.createElement('div')
  element.innerHTML = `
    <div style="padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <h1 style="font-size: 24px; font-weight: bold; margin-bottom: 16px; color: #1a1a1a;">
        ${note.title || '无标题笔记'}
      </h1>
      <div style="display: flex; gap: 24px; margin-bottom: 24px; font-size: 12px; color: #666;">
        <span>创建人：${creatorName}</span>
        <span>创建时间：${formatDateForExport(note.createdAt)}</span>
        <span>更新时间：${formatDateForExport(note.updatedAt)}</span>
      </div>
      <div style="border-top: 1px solid #e5e5e5; padding-top: 16px;">
        <div style="font-size: 14px; line-height: 1.8; white-space: pre-wrap; color: #333;">
          ${plainContent}
        </div>
      </div>
    </div>
  `

  const opt = {
    margin: [15, 15, 15, 15] as [number, number, number, number],
    filename: `${note.title || '无标题笔记'}_${new Date().toISOString().slice(0, 10)}.pdf`,
    image: { type: 'jpeg' as const, quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const }
  }

  html2pdf().set(opt).from(element).save()
}

/**
 * 创建笔记 HTML 元素
 */
function createNoteElement(note: Note, creatorName: string): HTMLElement {
  const plainContent = htmlToPlainText(note.content)
  const element = document.createElement('div')
  element.innerHTML = `
    <div style="padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: white;">
      <h1 style="font-size: 22px; font-weight: bold; margin-bottom: 12px; color: #1a1a1a;">
        ${note.title || '无标题笔记'}
      </h1>
      <div style="display: flex; gap: 20px; margin-bottom: 16px; font-size: 11px; color: #666;">
        <span>创建人：${creatorName}</span>
        <span>创建时间：${formatDateForExport(note.createdAt)}</span>
        <span>更新时间：${formatDateForExport(note.updatedAt)}</span>
      </div>
      <div style="font-size: 13px; line-height: 1.7; white-space: pre-wrap; color: #333;">
        ${plainContent}
      </div>
    </div>
  `
  return element.firstElementChild as HTMLElement
}

/**
 * 导出多个笔记为 PDF（每篇笔记单独一页）
 */
export async function exportNotesToPdf(notes: Note[], username?: string): Promise<void> {
  const creatorName = username || '未知用户'

  // 动态导入 jsPDF
  const jsPDF = (await import('jspdf')).default

  // 创建 PDF 文档
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  })

  const pageWidth = 210
  const pageHeight = 297
  const margin = 15
  const contentWidth = pageWidth - margin * 2

  // 逐个处理每篇笔记
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]
    const element = createNoteElement(note, creatorName)

    // 将元素添加到 DOM 以便渲染
    const container = document.createElement('div')
    container.style.cssText = 'position: absolute; left: -9999px; top: 0; width: 800px; background: white;'
    container.appendChild(element)
    document.body.appendChild(container)

    // 使用 html2canvas 渲染元素
    const html2canvas = (await import('html2canvas')).default
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: 800
    })

    // 移除临时元素
    document.body.removeChild(container)

    // 计算图片尺寸
    const imgData = canvas.toDataURL('image/jpeg', 0.98)
    const imgWidth = contentWidth
    const imgHeight = (canvas.height * imgWidth) / canvas.width

    // 如果不是第一篇笔记，添加新页面
    if (i > 0) {
      pdf.addPage()
    }

    // 添加图片到 PDF
    pdf.addImage(imgData, 'JPEG', margin, margin, imgWidth, imgHeight)

    // 如果内容超过一页，添加更多页面
    let remainingHeight = imgHeight
    let position = -pageHeight + margin * 2
    const usableHeight = pageHeight - margin * 2

    while (remainingHeight > usableHeight) {
      pdf.addPage()
      pdf.addImage(imgData, 'JPEG', margin, position + margin, imgWidth, imgHeight)
      remainingHeight -= usableHeight
      position -= usableHeight
    }
  }

  // 保存 PDF
  pdf.save(`笔记导出_${notes.length}篇_${new Date().toISOString().slice(0, 10)}.pdf`)
}
