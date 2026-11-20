/** Keep vertical wheel navigation on the page's designated scroll viewport. */
export function scrollOuterPage(event: WheelEvent, scroller?: HTMLElement | null) {
  if (!scroller || event.ctrlKey || event.metaKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
  // Workbench lists own vertical scrolling; do not redirect their wheel to the page.
  if (event.target instanceof Element && event.target.closest('.workbench-scroll-viewport')) return
  event.preventDefault()
  event.stopPropagation()
  // Dashboard keeps its overview fixed and explicitly owns a lower panel viewport.
  const viewport = scroller.querySelector<HTMLElement>('[data-page-scroll-target]') ?? scroller
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1
  viewport.scrollTop += event.deltaY * unit
}
