/** Gently align section boundaries after a user scroll, without paging tall charts. */
export function installDashboardPanelSnap(viewport: HTMLElement, cards: HTMLElement): () => void {
  const root = viewport.parentElement
  if (!root) return () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  let armed = false
  let lastStop: number | undefined

  const clearTimer = () => { clearTimeout(timer); timer = undefined }
  const cancel = () => { clearTimer(); armed = false }
  const inside = (event: Event) => event.target instanceof Node && root.contains(event.target)
  const arm = () => {
    cancel(); armed = true
    // A wheel at the scroll limit must not arm a later data-driven layout change.
    timer = setTimeout(cancel, 500)
  }
  const align = () => {
    cancel()
    const frame = viewport.getBoundingClientRect()
    const fixedBottom = cards.getBoundingClientRect().bottom
    if (!frame.height || !fixedBottom) return
    const current = viewport.scrollTop
    const radius = Math.min(64, viewport.clientHeight * .12)
    if (lastStop !== undefined && Math.abs(current - lastStop) > radius * 1.5) lastStop = undefined

    // Read fresh positions: permissions, filters and expanded details can alter heights.
    const panels = Array.from(viewport.querySelectorAll<HTMLElement>('[data-dashboard-panel]'))
      .map(panel => panel.getBoundingClientRect())
      .filter(rect => rect.height > 0 && rect.width > 0)
      .map(rect => ({ top: rect.top - frame.top + current, bottom: rect.bottom - frame.top + current }))
      .sort((a, b) => a.top - b.top)
    const rows: Array<{ top: number; bottom: number }> = []
    for (const panel of panels) {
      const row = rows.at(-1)
      if (row && Math.abs(row.top - panel.top) < 1) row.bottom = Math.max(row.bottom, panel.bottom)
      else rows.push({ ...panel })
    }
    const max = viewport.scrollHeight - viewport.clientHeight
    const targets = rows.slice(0, -1)
      .map(row => row.bottom + frame.top - fixedBottom)
      .filter(top => top >= 0 && top <= max && Math.abs(top - current) <= radius && (lastStop === undefined || Math.abs(top - lastStop) > 1))
      .sort((a, b) => Math.abs(a - current) - Math.abs(b - current))
    const target = targets[0]
    if (target === undefined) return
    lastStop = target
    if (Math.abs(target - current) < 1) return
    viewport.scrollTo({ top: target, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }
  const onScroll = () => {
    if (!armed) return
    clearTimer(); timer = setTimeout(align, 140)
  }
  const onWheel = (event: WheelEvent) => {
    if (inside(event) && !event.ctrlKey && !event.metaKey && event.deltaY && Math.abs(event.deltaY) >= Math.abs(event.deltaX)) arm()
  }
  const onTouch = (event: TouchEvent) => { if (inside(event)) arm() }
  const onKey = (event: KeyboardEvent) => {
    if (!inside(event)) return
    if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable="true"]')) { cancel(); return }
    if (event.key === 'Home' || event.key === 'End') { cancel(); return }
    if (!event.ctrlKey && !event.metaKey && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' '].includes(event.key)) arm()
  }
  const onPointer = (event: PointerEvent) => {
    cancel()
    if (event.target === viewport) arm()
  }
  const onResize = () => { cancel(); lastStop = undefined }

  // Window capture runs before AppLayout routes wheel scrolling into this viewport.
  window.addEventListener('wheel', onWheel, { capture: true, passive: true })
  window.addEventListener('touchmove', onTouch, { capture: true, passive: true })
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', onResize)
  root.addEventListener('pointerdown', onPointer, true)
  root.addEventListener('input', cancel, true)
  root.addEventListener('change', cancel, true)
  root.addEventListener('toggle', cancel, true)
  viewport.addEventListener('scroll', onScroll, { passive: true })
  return () => {
    cancel()
    window.removeEventListener('wheel', onWheel, true)
    window.removeEventListener('touchmove', onTouch, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', onResize)
    root.removeEventListener('pointerdown', onPointer, true)
    root.removeEventListener('input', cancel, true)
    root.removeEventListener('change', cancel, true)
    root.removeEventListener('toggle', cancel, true)
    viewport.removeEventListener('scroll', onScroll)
  }
}
