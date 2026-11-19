// Run before the page can paint; keep defaults in sync with useTheme.ts.
// A same-origin classic script also works with the production script-src CSP.
;(function () {
  var palette = 'blue'
  try { var saved = localStorage.getItem('autoflow-palette'); if (['blue','green','purple','orange'].indexOf(saved) >= 0) palette = saved } catch (_) {}
  document.documentElement.setAttribute('data-palette', palette)
  var dark = false
  try { dark = localStorage.getItem('autoflow-theme') === 'dark' } catch (_) { /* Storage may be disabled. */ }
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#101720' : '#f5f7fa')
})()
