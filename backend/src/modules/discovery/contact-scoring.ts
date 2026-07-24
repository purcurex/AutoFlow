import type { LeadContactType } from '../autoflow/autoflow.types'
import type { ContactVerificationStatus } from './discovery.types'

export interface ScoreableContact {
  type: LeadContactType
  label?: string | null
  sourceType?: string
  verificationStatus: ContactVerificationStatus
  confidence: number
  evidence?: Record<string, unknown>
}

export interface ContactScoreResult {
  score: number
  priorityTypes: Array<'phone' | 'whatsapp' | 'facebook_owner'>
  priorityCount: number
  emailOnlyCapApplied: boolean
  hasOwnerFacebookProfile: boolean
}

export function isOwnerFacebookContact(contact: ScoreableContact): boolean {
  if (contact.type !== 'facebook') return false
  const evidence = contact.evidence || {}
  const basis = [
    contact.label,
    contact.sourceType,
    evidence.queryBasis,
    evidence.profileType,
  ].filter((value): value is string => typeof value === 'string').join(' ').toLowerCase()
  return contact.sourceType === 'google_owner_search'
    || /\b(owner|founder|personal|店主|创始人)\b/i.test(basis)
}

export function calculateContactScore(contacts: ScoreableContact[]): ContactScoreResult {
  let score = 0
  const priorityTypes = new Set<ContactScoreResult['priorityTypes'][number]>()
  const meaningfulTypes = new Set<LeadContactType>()

  for (const contact of contacts) {
    if (contact.type === 'website') continue
    meaningfulTypes.add(contact.type)
    const ownerFacebook = isOwnerFacebookContact(contact)
    const channelWeight = ({
      email: 50,
      whatsapp: 100,
      phone: 95,
      instagram: 45,
      facebook: ownerFacebook ? 90 : 65,
      linkedin: 50,
      other: 20,
      website: 0,
    } as const)[contact.type]
    const verificationWeight = contact.verificationStatus === 'verified'
      ? 1
      : contact.verificationStatus === 'observed' ? 0.85 : 0.55
    const confidenceWeight = 0.7 + Math.max(0, Math.min(100, contact.confidence)) / 100 * 0.3
    score = Math.max(score, Math.round(channelWeight * verificationWeight * confidenceWeight))

    if (contact.type === 'phone') priorityTypes.add('phone')
    if (contact.type === 'whatsapp') priorityTypes.add('whatsapp')
    if (ownerFacebook) priorityTypes.add('facebook_owner')
  }

  const priorityCount = priorityTypes.size
  if (priorityCount > 1) score += priorityCount === 2 ? 10 : 20
  const emailOnlyCapApplied = meaningfulTypes.size === 1 && meaningfulTypes.has('email')
  if (emailOnlyCapApplied) score = Math.min(score, 50)

  return {
    score: Math.max(0, Math.min(100, score)),
    priorityTypes: [...priorityTypes],
    priorityCount,
    emailOnlyCapApplied,
    hasOwnerFacebookProfile: priorityTypes.has('facebook_owner'),
  }
}
