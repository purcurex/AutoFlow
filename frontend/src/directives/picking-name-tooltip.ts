import type { ObjectDirective } from 'vue'
import { TEXT_TOOLTIP_DELAY, isTextClipped } from '@/utils/textTooltips'

export const PICKING_NAME_DELAY = TEXT_TOOLTIP_DELAY
let nextId = 0
let dismissActive: (() => void) | undefined
type State = { value: string; close: () => void; destroy: () => void }
const states = new WeakMap<HTMLElement, State>()
export const vPickingNameTooltip: ObjectDirective<HTMLElement, string | null | undefined> = {
  mounted(element, binding) {
    element.setAttribute('data-picking-name-tooltip', '')
    let timer: ReturnType<typeof setTimeout> | undefined
    let tooltip: HTMLDivElement | undefined
    let originalDescription: string | null = null
    const originalTabIndex = element.getAttribute('tabindex')
    const close = () => {
      clearTimeout(timer); timer = undefined
      if (tooltip) {
        tooltip.remove(); tooltip = undefined
        if (originalDescription === null) element.removeAttribute('aria-describedby')
        else element.setAttribute('aria-describedby', originalDescription)
      }
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      document.removeEventListener('keydown', keydown)
      if (dismissActive === close) dismissActive = undefined
    }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    const start = (event: Event) => {
      if ((event as PointerEvent).pointerType === 'touch' || !state.value || state.value === '—' || !isTextClipped(element)) return
      dismissActive?.(); dismissActive = close
      window.addEventListener('scroll', close, true)
      window.addEventListener('resize', close)
      window.addEventListener('blur', close)
      document.addEventListener('keydown', keydown)
      timer = setTimeout(() => {
        if (!element.isConnected || !isTextClipped(element)) return close()
        tooltip = document.createElement('div')
        tooltip.id = `picking-name-tooltip-${++nextId}`
        tooltip.className = 'picking-name-tooltip'
        tooltip.setAttribute('role', 'tooltip')
        tooltip.textContent = state.value
        document.body.appendChild(tooltip)
        const bounds = element.getBoundingClientRect(), box = tooltip.getBoundingClientRect()
        tooltip.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - box.width - 12))}px`
        tooltip.style.top = `${Math.max(12, Math.min(bounds.bottom + 8 + box.height <= window.innerHeight - 12 ? bounds.bottom + 8 : bounds.top - box.height - 8, window.innerHeight - box.height - 12))}px`
        originalDescription = element.getAttribute('aria-describedby')
        element.setAttribute('aria-describedby', [originalDescription, tooltip.id].filter(Boolean).join(' '))
      }, PICKING_NAME_DELAY)
    }
    const state: State = { value: binding.value?.trim() || '', close, destroy: () => {
      close()
      element.removeAttribute('data-picking-name-tooltip')
      element.removeEventListener('pointerenter', start)
      element.removeEventListener('pointerleave', close)
      element.removeEventListener('focus', start)
      element.removeEventListener('blur', close)
      if (originalTabIndex === null) element.removeAttribute('tabindex')
      else element.setAttribute('tabindex', originalTabIndex)
    } }
    states.set(element, state)
    element.removeAttribute('title')
    element.tabIndex = state.value && state.value !== '—' ? 0 : -1
    element.addEventListener('pointerenter', start)
    element.addEventListener('pointerleave', close)
    element.addEventListener('focus', start)
    element.addEventListener('blur', close)
  },
  updated(element, binding) {
    const state = states.get(element)
    if (!state) return
    const value = binding.value?.trim() || ''
    if (state.value !== value) { state.close(); state.value = value }
    element.removeAttribute('title')
    element.tabIndex = value && value !== '—' ? 0 : -1
  },
  beforeUnmount(element) { states.get(element)?.destroy(); states.delete(element) },
}
