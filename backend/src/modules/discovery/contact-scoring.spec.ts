import { calculateContactScore } from './contact-scoring'

describe('calculateContactScore', () => {
  const contact = (
    type: 'email' | 'phone' | 'whatsapp' | 'facebook',
    overrides: Record<string, unknown> = {},
  ) => ({
    type,
    verificationStatus: 'verified' as const,
    confidence: 95,
    ...overrides,
  })

  it('caps an email-only lead at 50', () => {
    expect(calculateContactScore([contact('email', { confidence: 100 })])).toMatchObject({
      score: 50,
      priorityCount: 0,
      emailOnlyCapApplied: true,
    })
  })

  it('heavily rewards phone and WhatsApp coverage', () => {
    const result = calculateContactScore([contact('email'), contact('phone'), contact('whatsapp')])
    expect(result.score).toBe(100)
    expect(result.priorityTypes).toEqual(['phone', 'whatsapp'])
  })

  it('counts only an owner profile as priority Facebook evidence', () => {
    const businessPage = calculateContactScore([contact('facebook', { sourceType: 'storefront_social_profile_link' })])
    const ownerProfile = calculateContactScore([contact('facebook', {
      sourceType: 'google_owner_search',
      verificationStatus: 'observed',
      confidence: 55,
    })])

    expect(businessPage.priorityCount).toBe(0)
    expect(ownerProfile).toMatchObject({ priorityCount: 1, hasOwnerFacebookProfile: true })
    expect(ownerProfile.score).toBeGreaterThan(50)
  })
})
