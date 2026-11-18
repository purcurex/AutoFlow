/** One delayed tooltip for native title text and visually truncated labels, including teleports. */
export const TEXT_TOOLTIP_DELAY = 1000
export function isTextClipped(element: HTMLElement): boolean {
  const css = getComputedStyle(element)
  return (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1
    || element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1)
    && (css.textOverflow === 'ellipsis' || ['hidden', 'clip'].includes(css.overflow)
      || ['hidden', 'clip'].includes(css.overflowX) || ['hidden', 'clip'].includes(css.overflowY)
      || Number(css.webkitLineClamp) > 0)
}
export function installTextTooltips(root: HTMLElement = document.body): () => void {
  let active: HTMLElement | null = null, popup: HTMLDivElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined, serial = 0, description: string | null = null
  const marker = 'data-app-tooltip'
  const excluded = '[data-picking-name-tooltip],.info-tip,[role="tooltip"],input,textarea,[contenteditable="true"]'
  function close() {
    clearTimeout(timer); timer = undefined
    if (popup && active) {
      if (description === null) active.removeAttribute('aria-describedby')
      else active.setAttribute('aria-describedby', description)
    }
    popup?.remove(); popup = null; active = null
  }
  function clearLabel(element: HTMLElement) {
    const generated = element.getAttribute('data-app-tooltip-label')
    if (generated !== null && element.getAttribute('aria-label') === generated) element.removeAttribute('aria-label')
    element.removeAttribute('data-app-tooltip-label')
  }
  function capture(element: HTMLElement) {
    if (element.closest(excluded)) return
    const title = element.getAttribute('title')
    if (title?.trim()) {
      clearLabel(element)
      if (element.matches('button,a,[role="button"]') && !element.textContent?.trim() && !element.hasAttribute('aria-label') && !element.hasAttribute('aria-labelledby')) {
        element.setAttribute('aria-label', title); element.setAttribute('data-app-tooltip-label', title)
      }
      element.setAttribute(marker, title); element.setAttribute('title', '')
    }
  }
  function scan(node: Node) {
    if (!(node instanceof HTMLElement)) return
    capture(node); node.querySelectorAll<HTMLElement>('[title]').forEach(capture)
  }
  scan(root)
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        const element = record.target as HTMLElement, title = element.getAttribute('title')
        if (title === null || title === '' && record.oldValue === '') { element.removeAttribute(marker); clearLabel(element) }
        else capture(element)
      } else record.addedNodes.forEach(scan)
    }
    if (active && (!active.isConnected || records.some(r => active?.contains(r.target) && (r.type === 'attributes' || r.type === 'characterData' || r.type === 'childList')))) close()
  })
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'], attributeOldValue: true, characterData: true })
  function label(element: HTMLElement): string {
    if (element.closest(excluded)) return ''
    const explicit = element.getAttribute(marker)?.trim()
    const visible = element.textContent?.trim() ?? ''
    const clipped = isTextClipped(element)
    // A distinct action/explanation is useful; repeating fully visible text is not.
    const normalize = (text: string) => text.replace(/\s+/g, '')
    if (explicit && (clipped || normalize(explicit) !== normalize(visible))) return explicit
    return clipped ? visible : ''
  }
  function target(event: Event): HTMLElement | null {
    let element = event.target instanceof Element ? event.target : null
    if (element?.closest(excluded)) return null
    while (element && element !== root) {
      if (element instanceof HTMLElement && label(element)) return element
      element = element.parentElement
    }
    return null
  }
  function start(event: Event) {
    if ((event as PointerEvent).pointerType === 'touch') return
    const element = target(event)
    if (element === active) return
    close(); if (!element) return
    active = element
    timer = setTimeout(() => {
      if (!active?.isConnected) return close()
      const text = label(active); if (!text || text === '—') return close()
      popup = document.createElement('div'); popup.className = 'app-text-tooltip'; popup.id = `app-text-tooltip-${++serial}`
      popup.setAttribute('role', 'tooltip'); popup.textContent = text
      ;(active.closest('dialog[open]') ?? root).appendChild(popup)
      const bounds = active.getBoundingClientRect(), box = popup.getBoundingClientRect()
      popup.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - box.width - 12))}px`
      popup.style.top = `${Math.max(12, Math.min(bounds.bottom + 8 + box.height <= window.innerHeight - 12 ? bounds.bottom + 8 : bounds.top - box.height - 8, window.innerHeight - box.height - 12))}px`
      description = active.getAttribute('aria-describedby')
      active.setAttribute('aria-describedby', [description, popup.id].filter(Boolean).join(' '))
    }, TEXT_TOOLTIP_DELAY)
  }
  function leave(event: Event) {
    const next = (event as MouseEvent).relatedTarget
    if (active && next instanceof Node && active.contains(next)) return
    close()
  }
  function key(event: KeyboardEvent) { if (event.key === 'Escape') close() }
  root.addEventListener('pointerover', start); root.addEventListener('pointerout', leave)
  root.addEventListener('focusin', start); root.addEventListener('focusout', leave)
  root.addEventListener('pointerdown', close)
  document.addEventListener('keydown', key); window.addEventListener('scroll', close, true)
  window.addEventListener('resize', close); window.addEventListener('blur', close)
  return () => {
    close(); observer.disconnect()
    root.removeEventListener('pointerover', start); root.removeEventListener('pointerout', leave)
    root.removeEventListener('focusin', start); root.removeEventListener('focusout', leave); root.removeEventListener('pointerdown', close)
    document.removeEventListener('keydown', key); window.removeEventListener('scroll', close, true)
    window.removeEventListener('resize', close); window.removeEventListener('blur', close)
    root.querySelectorAll<HTMLElement>(`[${marker}]`).forEach(el => { el.setAttribute('title', el.getAttribute(marker)!); el.removeAttribute(marker); clearLabel(el) })
  }
}
