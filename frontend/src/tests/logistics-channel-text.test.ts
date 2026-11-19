import { describe, expect, it } from 'vitest'
import { channelNameParts } from '@/utils/logistics-channel-text'

describe('logistics channel word wrapping', () => {
  it('keeps English words whole and preserves their spaces', () => {
    expect(channelNameParts('HZpacket Standard Electronics')).toEqual(['HZpacket', ' ', 'Standard', ' ', 'Electronics'])
  })
  it.each([
    ['云途全球专线挂号（特惠普货）', '（特惠普货）'],
    ['联邮通经济挂号-普货（O5）', '（O5）'],
    ['Standard (Battery included)', '(Battery included)'],
    ['专线（特惠（含电）） / 专线【普货】', '（特惠（含电））'],
  ])('moves a complete qualifier in %s as one unit', (name, qualifier) => {
    const parts = channelNameParts(name)
    expect(parts).toContain(qualifier)
    expect(parts.join('')).toBe(name)
  })
  it('preserves incomplete brackets and separates subsequent words', () => {
    const parts = channelNameParts('Standard (Battery included')
    expect(parts).toContain('Battery')
    expect(parts).toContain('included')
    expect(parts.join('')).toBe('Standard (Battery included')
  })
})
