/** Clipboard API needs HTTPS; the fallback also supports internal HTTP demo addresses. */
export async function copyText(value: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return
    }
  } catch { /* Try the user-initiated legacy copy path. */ }
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const input = document.createElement('textarea')
  input.value = value
  input.readOnly = true
  input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;'
  document.body.appendChild(input)
  try {
    input.select()
    if (!document.execCommand?.('copy')) throw new Error('Copy unavailable')
  } finally {
    input.remove()
    active?.focus({ preventScroll: true })
  }
}
