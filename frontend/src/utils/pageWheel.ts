/** Keep vertical wheel navigation on the outer page (or active dialog). */
export function scrollOuterPage(event: WheelEvent, scroller?: HTMLElement | null) {
  if (!scroller || event.ctrlKey || event.metaKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
  event.preventDefault()
  event.stopPropagation()
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1
  scroller.scrollTop += event.deltaY * unit
}
