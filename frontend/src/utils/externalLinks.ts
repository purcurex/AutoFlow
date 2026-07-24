const EXTERNAL_PROTOCOLS = new Set([
  'http:',
  'https:',
  'mailto:',
  'tel:',
  'sms:',
  'whatsapp:',
])

export function isExternalHref(href: string, currentOrigin: string): boolean {
  const value = href.trim()
  if (!value || value.startsWith('#')) return false

  try {
    const url = new URL(value, `${currentOrigin}/`)
    if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return false
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.origin !== currentOrigin
    }
    return true
  } catch {
    return false
  }
}

export function secureExternalAnchor(anchor: HTMLAnchorElement, currentOrigin: string): boolean {
  const href = anchor.getAttribute('href')
  if (!href || !isExternalHref(href, currentOrigin)) return false

  anchor.target = '_blank'
  const rel = new Set(anchor.rel.split(/\s+/).filter(Boolean))
  rel.add('noopener')
  rel.add('noreferrer')
  anchor.rel = Array.from(rel).join(' ')
  return true
}

export function installExternalLinkPolicy(
  documentRef: Document = document,
  currentOrigin: string = window.location.origin,
): () => void {
  const secureLinks = (root: ParentNode) => {
    if (root instanceof HTMLAnchorElement) secureExternalAnchor(root, currentOrigin)
    root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
      secureExternalAnchor(anchor, currentOrigin)
    })
  }

  const handleActivation = (event: Event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest<HTMLAnchorElement>('a[href]')
    if (anchor) secureExternalAnchor(anchor, currentOrigin)
  }

  secureLinks(documentRef)
  documentRef.addEventListener('click', handleActivation, true)
  documentRef.addEventListener('auxclick', handleActivation, true)

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLAnchorElement) {
        secureExternalAnchor(mutation.target, currentOrigin)
      }
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) secureLinks(node)
      })
    }
  })
  observer.observe(documentRef.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['href'],
  })

  return () => {
    observer.disconnect()
    documentRef.removeEventListener('click', handleActivation, true)
    documentRef.removeEventListener('auxclick', handleActivation, true)
  }
}
