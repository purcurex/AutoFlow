import type { ObjectDirective } from 'vue'

const logisticsColumn = /物流|跟踪|logistics|tracking|channel/i
const logisticsColumnWidth = 224

/** Fixed identity/product columns; every other column receives the same surplus. */
export function distributeTaskColumns(intrinsic: number[], available: number): number[] {
  const base = intrinsic.map((width, index) => index === 0 ? 196 : index === 1 ? 380 : Math.min(280, Math.max(88, Math.ceil(width))))
  const flexible = Math.max(0, base.length - 2)
  const extra = flexible ? Math.max(0, available - base.reduce((sum, width) => sum + width, 0)) / flexible : 0
  return base.map((width, index) => width + (index > 1 ? extra : 0))
}

/** Content widths are bounded so unusually long values cannot dominate the table. */
export function compactTaskColumn(label: string, index: number): number {
  if (index === 0) return /备货|Stock/i.test(label) ? 176 : 164
  if (index === 1) return 240
  if (/Shopify/i.test(label)) return 76
  if (/时间|日期|time|date|paid at|created at|shipped at/i.test(label)) return 124
  if (logisticsColumn.test(label)) return logisticsColumnWidth
  if (/单号|编号|通知单|RMA单|order number|document|receipt notice|RMA order/i.test(label)) return 152
  if (/金额|amount|payment$/i.test(label)) return 72
  if (/仓库|warehouse/i.test(label)) return 66
  if (/业务员|salesperson/i.test(label)) return 104
  if (/店铺|store/i.test(label)) return 72
  if (/客户|Customer/i.test(label)) return 88
  if (/操作|action/i.test(label)) return 56
  if (/原因|备注|reason|remark/i.test(label)) return 160
  if (/退货|return/i.test(label)) return 228
  if (/状态|进度|status|progress/i.test(label)) return 104
  return 104
}
export function fitTaskColumns(intrinsic: number[], labels: string[], available: number) {
  const compact = available < 1800
  const content = intrinsic.map(value => Math.min(280, Math.max(0, value)))
  const minimum = labels.map((label, index) => {
    if (index === 0) return compact ? compactTaskColumn(label, index) : 196
    if (index === 1) return compact ? 240 : 380
    if (/备注|remark/i.test(label)) return 240
    return compact ? compactTaskColumn(label, index) : logisticsColumn.test(label) ? logisticsColumnWidth : 88
  })
  const base = minimum.map((value, index) => index < 2 ? value : Math.max(value, content[index] ?? 0))
  const total = base.reduce((sum, value) => sum + value, 0)
  // Water-fill the whitespace, rather than adding equal width on top of unequal
  // schema reserves. Columns with generous minimum widths join only when needed.
  let low = 0, high = Math.max(0, available - total) + Math.max(0, ...minimum)
  const sumAt = (gap: number) => minimum.reduce((sum, floor, index) => sum + (index < 2 ? floor : Math.max(floor, (content[index] ?? 0) + gap)), 0)
  if (available > total && labels.length > 2) {
    for (let iteration = 0; iteration < 40; iteration++) {
      const middle = (low + high) / 2
      if (sumAt(middle) > available) high = middle
      else low = middle
    }
  }
  const widths = base.map((value, index) => index < 2 ? value : Math.max(value, (content[index] ?? 0) + low))
  const width = Math.max(available, widths.reduce((sum, value) => sum + value, 0))
  return { widths, width, scale: Math.min(1, available / width), compact }
}

/** Estimate a single displayed line at the shared 12px type size, including cell padding/icons. */
export function boundedContentWidth(value: string): number {
  let width = 28
  for (const char of value.trim().slice(0, 256)) width += /[\u2e80-\uffff]/.test(char) ? 12 : /[MW@%]/.test(char) ? 10 : 7
  return Math.min(280, Math.ceil(width))
}

export type TaskTableColumns = { widths: number[]; grow: number[] }

export function fitConfiguredTaskColumns(intrinsic: number[], available: number, columns: TaskTableColumns) {
  const base = columns.widths.map((width, index) => Math.max(width, intrinsic[index] ?? 0))
  const total = base.reduce((sum, width) => sum + width, 0)
  const extra = Math.max(0, available - total)
  const weight = columns.grow.reduce((sum, value) => sum + value, 0) || 1
  const widths = base.map((width, index) => width + extra * (columns.grow[index] ?? 0) / weight)
  const width = Math.max(available, total)
  return { widths, width, scale: Math.min(1, available / width), compact: available < 1800 }
}

type State = { config?: TaskTableColumns; frame: number; observer?: ResizeObserver; group: HTMLTableColElement; disposed: boolean; signature?: string }
const states = new WeakMap<HTMLTableElement, State>()
function columns(table: HTMLTableElement, state: State) {
  const count = table.tHead?.rows[0]?.cells.length ?? 0
  while (state.group.children.length > count) state.group.lastElementChild?.remove()
  while (state.group.children.length < count) state.group.appendChild(document.createElement('col'))
}
function measure(table: HTMLTableElement, state: State) {
  if (state.disposed || !table.isConnected || !table.parentElement) return
  // Phone cards retain their own layout; laptop viewports always keep table columns.
  if (getComputedStyle(table).display !== 'table' || !table.tHead || getComputedStyle(table.tHead).display !== 'table-header-group') {
    table.style.removeProperty('width')
    table.style.removeProperty('zoom')
    delete table.dataset.taskLayout
    state.signature = undefined
    return
  }
  const available = table.parentElement.clientWidth
  if (!available) return
  const rows = Array.from(table.tBodies).flatMap(body => Array.from(body.rows))
    .filter(row => row.cells.length === table.tHead!.rows[0]!.cells.length && Array.from(row.cells).every(cell => cell.colSpan === 1)).slice(0, 100)
  const content = rows.map(row => Array.from(row.cells).slice(2).map(cell => cell.innerText ?? cell.textContent ?? ''))
  const signature = `${available}:${table.tHead.textContent}:${JSON.stringify(state.config)}:${JSON.stringify(content)}`
  if (signature === state.signature) return
  state.signature = signature
  // Measure an inert clone in one layout pass. Never alter the visible table while measuring.
  const clone = table.cloneNode(true) as HTMLTableElement
  clone.setAttribute('aria-hidden', 'true')
  clone.inert = true
  // Measure headings separately from bounded business text; ignore loading/colspan rows.
  clone.querySelectorAll('colgroup,tbody,tfoot').forEach(node => node.remove())
  clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'))
  clone.removeAttribute('id')
  clone.dataset.taskLayout = available < 1800 ? 'compact' : 'wide'
  clone.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;width:max-content;max-width:none;min-width:0;table-layout:auto;display:table;z-index:-1'
  clone.querySelectorAll<HTMLElement>('th,td').forEach(cell => {
    cell.style.setProperty('padding-inline', available < 1800 ? '4px' : '8px', 'important')
    cell.style.setProperty('width', 'auto', 'important')
    cell.style.setProperty('min-width', '0', 'important')
    cell.style.setProperty('max-width', 'none', 'important')
    cell.style.setProperty('white-space', 'nowrap', 'important')
    cell.style.setProperty('overflow-wrap', 'normal', 'important')
  })
  clone.querySelectorAll<HTMLElement>('button,span,small,p,div').forEach(node => {
    node.style.setProperty('white-space', 'nowrap', 'important')
    node.style.setProperty('max-width', 'none', 'important')
    node.style.setProperty('flex-wrap', 'nowrap', 'important')
  })
  table.parentElement.appendChild(clone)
  try {
    const headers = [...clone.tHead!.rows[0]!.cells]
    const labels = headers.map(cell => cell.textContent?.trim() ?? '')
    const intrinsic = headers.map((cell, index) => {
      const headingWidth = Math.ceil(cell.getBoundingClientRect().width)
      if (index < 2 || state.config) return headingWidth
      const values = content.flatMap(row => (row[index - 2] ?? '').split(/\n/))
      return Math.max(headingWidth, ...values.map(value => boundedContentWidth(value)))
    })
    const layout = state.config?.widths.length === labels.length
      ? fitConfiguredTaskColumns(intrinsic, available, state.config)
      : fitTaskColumns(intrinsic, labels, available)
    ;[...state.group.children].forEach((col, index) => { (col as HTMLElement).style.width = `${layout.widths[index]}px` })
    table.dataset.taskLayout = layout.compact ? 'compact' : 'wide'
    table.style.width = `${layout.width}px`
    table.style.setProperty('zoom', String(layout.scale))

  } finally { clone.remove() }
}
function schedule(table: HTMLTableElement) {
  const state = states.get(table)
  if (!state) return
  columns(table, state)
  if (state.frame) cancelAnimationFrame(state.frame)
  if (typeof requestAnimationFrame === 'function') state.frame = requestAnimationFrame(() => { state.frame = 0; measure(table, state) })
}
export const vTaskTableLayout: ObjectDirective<HTMLTableElement, TaskTableColumns | undefined> = {
  mounted(table, binding) {
    const group = document.createElement('colgroup')
    table.prepend(group)
    const state: State = { config: binding.value, frame: 0, group, disposed: false }
    states.set(table, state)
    if (typeof ResizeObserver !== 'undefined' && table.parentElement) {
      state.observer = new ResizeObserver(() => schedule(table))
      state.observer.observe(table.parentElement)
    }
    schedule(table)
    void document.fonts?.ready.then(() => { if (!state.disposed) { state.signature = undefined; schedule(table) } })
  },
  updated(table, binding) {
    const state = states.get(table)
    if (state) state.config = binding.value
    schedule(table)
  },
  beforeUnmount(table) {
    const state = states.get(table)
    if (!state) return
    state.disposed = true
    state.observer?.disconnect()
    if (state.frame) cancelAnimationFrame(state.frame)
    states.delete(table)
  },
}
