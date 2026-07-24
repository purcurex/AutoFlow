import { describe, expect, it } from 'vitest'
import type { LeadContact } from '@/api/autoflow'
import { contactDisplayValue, contactHref } from '@/utils/contactEvidence'

function contact(type: LeadContact['type'], value: string): LeadContact {
  return {
    type,
    value,
    label: null,
    verified: true,
    sourceUrl: 'https://shop.example/pages/contact',
    sourceType: 'storefront_social_profile_link',
    verificationStatus: 'verified',
    confidence: 90,
    evidence: {},
    sourcePageTitle: 'Contact Us',
    sourcePageKind: 'contact',
    extractedFrom: 'social_profile_link',
  }
}

describe('contact evidence presentation', () => {
  it('shows readable account identifiers instead of long social URLs', () => {
    expect(contactDisplayValue(contact('whatsapp', 'https://wa.me/15551234567'))).toBe('+15551234567')
    expect(contactDisplayValue(contact('facebook', 'https://facebook.com/pawspark'))).toBe('@pawspark')
    expect(contactDisplayValue(contact('linkedin', 'https://linkedin.com/company/pawspark'))).toBe('@pawspark')
  })

  it('builds direct actions for email, phone, and web-based contact channels', () => {
    expect(contactHref(contact('email', 'sales@shop.example'))).toBe('mailto:sales@shop.example')
    expect(contactHref(contact('phone', '+15551234567'))).toBe('tel:+15551234567')
    expect(contactHref(contact('instagram', 'https://instagram.com/pawspark'))).toBe('https://instagram.com/pawspark')
  })
})
