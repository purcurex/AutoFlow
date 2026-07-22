import type { Note } from '@/types'

export function htmlToPlainText(html: string): string {
  if (!html) return ''

  const container = document.createElement('div')
  container.innerHTML = html
  container.querySelectorAll('br').forEach(element => element.replaceWith('\n'))
  container.querySelectorAll('p, div, li').forEach(element => {
    element.insertAdjacentText('afterend', '\n')
  })
  return container.textContent || container.innerText || ''
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function formatDateForExport(dateString: string): string {
  return new Date(dateString).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function createNoteElement(note: Note, creatorName: string): HTMLElement {
  const element = document.createElement('article')
  element.style.cssText = [
    'padding: 20px',
    'font-family: Arial, sans-serif',
    'background: white',
    'color: #1a1a1a',
  ].join(';')

  const title = document.createElement('h1')
  title.style.cssText = 'font-size: 22px; font-weight: bold; margin-bottom: 12px'
  title.textContent = note.title || '无标题业务记录'

  const metadata = document.createElement('p')
  metadata.style.cssText = 'font-size: 11px; color: #666; margin-bottom: 16px'
  metadata.textContent = `创建人：${creatorName}  创建时间：${formatDateForExport(note.createdAt)}  更新时间：${formatDateForExport(note.updatedAt)}`

  const content = document.createElement('div')
  content.style.cssText = 'font-size: 13px; line-height: 1.7; white-space: pre-wrap'
  content.textContent = htmlToPlainText(note.content)

  element.append(title, metadata, content)
  return element
}

export async function exportNoteToPdf(note: Note, username?: string): Promise<void> {
  const date = new Date().toISOString().slice(0, 10)
  return exportNotesToPdf([note], username, `${note.title || '无标题业务记录'}_${date}.pdf`)
}

export async function exportNotesToPdf(notes: Note[], username?: string, filename?: string): Promise<void> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ])
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const creatorName = username || '未知用户'
  const margin = 15
  const contentWidth = 180

  for (let index = 0; index < notes.length; index += 1) {
    const element = createNoteElement(notes[index], creatorName)
    const container = document.createElement('div')
    container.style.cssText = 'position: absolute; left: -9999px; top: 0; width: 800px; background: white'
    container.appendChild(element)
    document.body.appendChild(container)

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: 800,
      })
      const imageHeight = (canvas.height * contentWidth) / canvas.width
      if (index > 0) pdf.addPage()
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.98), 'JPEG', margin, margin, contentWidth, imageHeight)
    } finally {
      container.remove()
    }
  }

  pdf.save(filename || `业务记录导出_${notes.length}条_${new Date().toISOString().slice(0, 10)}.pdf`)
}
