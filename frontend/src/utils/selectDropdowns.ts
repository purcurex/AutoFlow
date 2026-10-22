/** Keep native values, labels, forms and Vue bindings; render the options consistently. */
export function installSelectDropdowns(root: HTMLElement): () => void {
  const bindings = new Map<HTMLSelectElement, () => void>()
  let current: HTMLSelectElement | undefined
  let popup: HTMLDivElement | undefined
  let activeIndex = -1
  let serial = 0
  let searchText = '', lastKeyAt = 0

  const enabled = (option?: HTMLOptionElement) => !!option && !option.disabled && !option.hidden && !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)
  function close() {
    popup?.remove(); popup = undefined
    current?.setAttribute('aria-expanded', 'false')
    current?.removeAttribute('aria-controls')
    current?.removeAttribute('aria-activedescendant')
    current = undefined; activeIndex = -1; searchText = ''
  }
  function position() {
    if (!current || !popup) return
    const rect = current.getBoundingClientRect()
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) { close(); return }
    const viewport = document.documentElement.clientWidth || window.innerWidth
    popup.style.minWidth = `${Math.min(rect.width, viewport - 16)}px`
    popup.style.maxWidth = `${Math.max(0, viewport - 16)}px`
    popup.style.maxHeight = `${Math.max(0, Math.min(288, window.innerHeight - rect.bottom - 14))}px`
    popup.style.top = `${rect.bottom + 6}px`
    popup.style.left = `${Math.max(8, Math.min(rect.left, viewport - popup.getBoundingClientRect().width - 8))}px`
  }
  function highlight(scroll = false) {
    if (!popup || !current) return
    for (const node of popup.querySelectorAll<HTMLElement>('[role=option]')) {
      const active = Number(node.dataset.index) === activeIndex
      node.classList.toggle('is-active', active)
      if (active) {
        current.setAttribute('aria-activedescendant', node.id)
        if (scroll) node.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      }
    }
  }
  function choose(index: number) {
    const select = current
    if (!select || select.disabled || !select.options[index] || !enabled(select.options[index]!)) return
    const changed = select.selectedIndex !== index
    select.selectedIndex = index
    close()
    if (changed) {
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (select.isConnected && !select.disabled) select.focus({ preventScroll: true })
  }
  function render() {
    if (!current || !popup) return
    popup.replaceChildren()
    let group = ''
    for (const [index, option] of [...current.options].entries()) {
      if (option.hidden) continue
      const label = option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : ''
      if (label && group !== label) {
        const heading = document.createElement('div'); heading.className = 'app-select-group'; heading.textContent = label; popup.append(heading)
      }
      group = label
      const row = document.createElement('div')
      row.id = `${popup.id}-${index}`; row.dataset.index = String(index); row.className = 'app-select-option'
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(option.selected)); row.setAttribute('aria-disabled', String(!enabled(option)))
      row.textContent = option.label
      row.addEventListener('pointermove', () => { if (enabled(option)) { activeIndex = index; highlight() } })
      row.addEventListener('click', () => choose(index))
      popup.append(row)
    }
    highlight(); position()
  }
  function open(select: HTMLSelectElement) {
    if (select.disabled || !select.options.length) return
    close(); current = select
    select.focus({ preventScroll: true })
    // Make room below a low control; never flip the menu above the control.
    if (window.innerHeight - select.getBoundingClientRect().bottom < 120) select.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' })
    popup = document.createElement('div'); popup.className = 'app-select-menu'; popup.id = `app-select-menu-${++serial}`
    popup.setAttribute('role', 'listbox')
    popup.setAttribute('aria-label', select.getAttribute('aria-label') || select.labels?.[0]?.textContent?.trim() || '选项 / Options')
    popup.addEventListener('mousedown', e => e.preventDefault())
    document.body.append(popup)
    select.setAttribute('aria-expanded', 'true'); select.setAttribute('aria-controls', popup.id)
    activeIndex = enabled(select.options[select.selectedIndex]!) ? select.selectedIndex : [...select.options].findIndex(enabled)
    render()
    // Scroll the options, not the page, to keep the current value in view.
    const selected = popup.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    if (selected) popup.scrollTop = Math.max(0, selected.offsetTop - popup.clientHeight / 2)
  }
  function attach(select: HTMLSelectElement) {
    if (bindings.has(select) || select.multiple || select.size > 1) return
    select.dataset.appSelect = ''; select.setAttribute('aria-expanded', 'false')
    const down = (e: MouseEvent) => { if (e.button === 0 && !select.disabled) { e.preventDefault(); select.focus({ preventScroll: true }) } }
    const click = (e: MouseEvent) => { e.preventDefault(); if (current === select) close(); else open(select) }
    const blur = () => { if (current === select) close() }
    const key = (e: KeyboardEvent) => {
      if (select.disabled || e.ctrlKey || e.metaKey || e.isComposing) return
      if (e.key === 'Tab') { close(); return }
      if (e.key === 'Escape') { if (current === select) { e.preventDefault(); close() } return }
      const navigation = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key)
      const typing = e.key.length === 1 && e.key !== ' ' && !e.altKey
      if (!navigation && !typing) return
      e.preventDefault()
      const wasOpen = current === select
      if (!wasOpen) open(select)
      if (!popup) return
      const indices = [...select.options].flatMap((option, index) => enabled(option) ? [index] : [])
      if (e.key === 'Enter' || e.key === ' ') { if (wasOpen) choose(activeIndex); return }
      if (e.key === 'Home') activeIndex = indices[0] ?? -1
      else if (e.key === 'End') activeIndex = indices.at(-1) ?? -1
      else if (wasOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const at = indices.indexOf(activeIndex), offset = e.key === 'ArrowDown' ? 1 : -1
        activeIndex = indices[Math.max(0, Math.min(indices.length - 1, at + offset))] ?? -1
      } else if (typing) {
        searchText = Date.now() - lastKeyAt > 600 ? e.key : searchText + e.key; lastKeyAt = Date.now()
        const match = indices.find(index => select.options[index]!.label.toLocaleLowerCase().startsWith(searchText.toLocaleLowerCase()))
        if (match !== undefined) activeIndex = match
      }
      highlight(true)
    }
    select.addEventListener('mousedown', down); select.addEventListener('click', click); select.addEventListener('keydown', key); select.addEventListener('blur', blur)
    bindings.set(select, () => {
      if (current === select) close()
      select.removeEventListener('mousedown', down); select.removeEventListener('click', click); select.removeEventListener('keydown', key); select.removeEventListener('blur', blur)
      delete select.dataset.appSelect; select.removeAttribute('aria-expanded')
    })
  }
  function reconcile() {
    for (const [select, cleanup] of bindings) if (!root.contains(select)) { cleanup(); bindings.delete(select) }
    if (root instanceof HTMLSelectElement) attach(root)
    root.querySelectorAll<HTMLSelectElement>('select').forEach(attach)
    if (current?.disabled || current && !current.options.length) close()
    else if (current) { if (!current.options[activeIndex] || !enabled(current.options[activeIndex]!)) activeIndex = current.selectedIndex; render() }
  }
  const outside = (event: Event) => { if (event.target !== current && !popup?.contains(event.target as Node)) close() }
  const scroll = (event: Event) => { if (!(event.target instanceof Node) || !popup?.contains(event.target)) position() }
  const observer = new MutationObserver(reconcile)
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label', 'value'] })
  reconcile()
  document.addEventListener('pointerdown', outside, true)
  window.addEventListener('resize', position); window.addEventListener('scroll', scroll, true); window.addEventListener('blur', close)
  return () => {
    close(); observer.disconnect(); bindings.forEach(cleanup => cleanup()); bindings.clear()
    document.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('resize', position); window.removeEventListener('scroll', scroll, true); window.removeEventListener('blur', close)
  }
}
