import type { LeadContact } from '@/api/autoflow'

export function contactDisplayValue(contact: LeadContact): string {
  if (!['whatsapp', 'facebook', 'instagram', 'linkedin'].includes(contact.type)) return contact.value
  try {
    const url = new URL(contact.value)
    if (contact.type === 'whatsapp') {
      const phone = url.pathname.replace(/\D/g, '') || url.searchParams.get('phone') || ''
      return phone ? `+${phone}` : 'WhatsApp'
    }
    const path = decodeURIComponent(url.pathname).replace(/^\/|\/$/g, '')
    return path ? `@${path.replace(/^(company|in)\//, '')}` : url.hostname
  } catch {
    return contact.value
  }
}

export function contactHref(contact: LeadContact): string {
  if (contact.type === 'email') return `mailto:${contact.value}`
  if (contact.type === 'phone') return `tel:${contact.value}`
  return contact.value
}
