import type { ObjectDirective } from 'vue'

/** Fixed identity/product columns; every other column receives the same surplus. */
export function distributeTaskColumns(intrinsic: number[], available: number): number[] {
  const base = intrinsic.map((width, index) => index === 0 ? 196 : index === 1 ? 340 : Math.min(280, Math.max(88, Math.ceil(width))))
  const flexible = Math.max(0, base.length - 2)
  const extra = flexible ? Math.max(0, available - base.reduce((sum, width) => sum + width, 0)) / flexible : 0
  return base.map((width, index) => width + (index > 1 ? extra : 0))
}

type State = { frame: number; observer?: ResizeObserver; group: HTMLTableColElement; disposed: boolean; signature?: string }
const states = new WeakMap<HTMLTableElement, State>()
function columns(table: HTMLTableElement, state: State) {
  const count = table.tHead?.rows[0]?.cells.length ?? 0
  while (state.group.children.length > count) state.group.lastElementChild?.remove()
  while (state.group.children.length < count) state.group.appendChild(document.createElement('col'))
}
function measure(table: HTMLTableElement, state: State) {
  if (state.disposed || !table.isConnected || !table.parentElement) return
  // Existing responsive cards own their layout; remove desktop widths at that breakpoint.
  if (getComputedStyle(table).display !== 'table' || !table.tHead || getComputedStyle(table.tHead).display === 'none') {
    table.style.removeProperty('width')
    state.signature = undefined
    return
  }
  const available = table.parentElement.clientWidth
  if (!available) return
  const signature = `${available}:${table.tHead.textContent}`
  if (signature === state.signature) return
  state.signature = signature
  // Measure an inert clone in one layout pass. Never alter the visible table while measuring.
  const clone = table.cloneNode(true) as HTMLTableElement
  clone.setAttribute('aria-hidden', 'true')
  clone.inert = true
  // Column widths belong to the list schema, not to whichever rows arrive first.
  // Long product/customer text and loading placeholders must not move the headers.
  clone.querySelectorAll('colgroup,tbody,tfoot').forEach(node => node.remove())
  clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'))
  clone.removeAttribute('id')
  clone.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;width:max-content;max-width:none;min-width:0;table-layout:auto;display:table;z-index:-1'
  clone.querySelectorAll<HTMLElement>('th,td').forEach(cell => {
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
    const intrinsic = [...clone.tHead!.rows[0]!.cells].map(cell => Math.max(
      /时间|日期|time|date|paid at|created at|shipped at/i.test(cell.textContent ?? '') ? 168 : 128,
      cell.getBoundingClientRect().width,
    ))
    const widths = distributeTaskColumns(intrinsic, available)
    ;[...state.group.children].forEach((col, index) => { (col as HTMLElement).style.width = `${widths[index]}px` })
    table.style.width = `${Math.max(available, widths.reduce((sum, width) => sum + width, 0))}px`

  } finally { clone.remove() }
}
function schedule(table: HTMLTableElement) {
  const state = states.get(table)
  if (!state) return
  columns(table, state)
  if (state.frame) cancelAnimationFrame(state.frame)
  if (typeof requestAnimationFrame === 'function') state.frame = requestAnimationFrame(() => { state.frame = 0; measure(table, state) })
}
export const vTaskTableLayout: ObjectDirective<HTMLTableElement> = {
  mounted(table) {
    const group = document.createElement('colgroup')
    table.prepend(group)
    const state: State = { frame: 0, group, disposed: false }
    states.set(table, state)
    if (typeof ResizeObserver !== 'undefined' && table.parentElement) {
      state.observer = new ResizeObserver(() => schedule(table))
      state.observer.observe(table.parentElement)
    }
    schedule(table)
    void document.fonts?.ready.then(() => { if (!state.disposed) { state.signature = undefined; schedule(table) } })
  },
  updated: schedule,
  beforeUnmount(table) {
    const state = states.get(table)
    if (!state) return
    state.disposed = true
    state.observer?.disconnect()
    if (state.frame) cancelAnimationFrame(state.frame)
    states.delete(table)
  },
}
