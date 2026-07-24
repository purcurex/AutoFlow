import { afterEach, describe, expect, it } from 'vitest'
import {
  installExternalLinkPolicy,
  isExternalHref,
  secureExternalAnchor,
} from '@/utils/externalLinks'

const ORIGIN = 'http://127.0.0.1:5173'

describe('global external link policy', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('distinguishes business-system routes from outbound destinations', () => {
    expect(isExternalHref('/leads/lead-1', ORIGIN)).toBe(false)
    expect(isExternalHref(`${ORIGIN}/workflows`, ORIGIN)).toBe(false)
    expect(isExternalHref('https://example-shop.com/products/item', ORIGIN)).toBe(true)
    expect(isExternalHref('https://facebook.com/store-owner', ORIGIN)).toBe(true)
    expect(isExternalHref('mailto:buyer@example.com', ORIGIN)).toBe(true)
  })

  it('opens outbound anchors in a secure new tab without changing internal links', () => {
    const external = document.createElement('a')
    external.href = 'https://example-shop.com'
    external.rel = 'nofollow'
    expect(secureExternalAnchor(external, ORIGIN)).toBe(true)
    expect(external.target).toBe('_blank')
    expect(external.rel.split(' ')).toEqual(expect.arrayContaining([
      'nofollow',
      'noopener',
      'noreferrer',
    ]))

    const internal = document.createElement('a')
    internal.href = '/leads/lead-1'
    expect(secureExternalAnchor(internal, ORIGIN)).toBe(false)
    expect(internal.target).toBe('')
  })

  it('protects dynamically rendered links before navigation', () => {
    const dispose = installExternalLinkPolicy(document, ORIGIN)
    const container = document.createElement('div')
    container.innerHTML = '<a href="https://facebook.com/store-owner"><span>Owner</span></a>'
    document.body.append(container)

    const anchor = container.querySelector('a')!
    anchor.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(anchor.target).toBe('_blank')
    expect(anchor.rel).toContain('noopener')
    expect(anchor.rel).toContain('noreferrer')
    dispose()
  })
})
