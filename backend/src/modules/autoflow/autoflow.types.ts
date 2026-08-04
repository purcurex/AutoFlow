export const SEED_TYPES = ['keyword', 'image'] as const
export type SeedType = (typeof SEED_TYPES)[number]

export interface GoogleSearchOptions {
  exactPhrase: boolean
  titleMatch: boolean
  excludeMarketplaces: boolean
  findOwnerFacebook: boolean
}

export const DEFAULT_GOOGLE_SEARCH_OPTIONS: GoogleSearchOptions = {
  exactPhrase: true,
  titleMatch: false,
  excludeMarketplaces: true,
  findOwnerFacebook: true,
}

export const WORKFLOW_STATUSES = ['draft', 'running', 'completed', 'failed', 'cancelled'] as const
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]

export const WORKFLOW_STAGES = [
  'seed',
  'ad_discovery',
  'store_detection',
  'lead_cleaning',
  'lead_scoring',
  'message_generation',
  'outreach',
  'crm',
] as const
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number]

export const WORKFLOW_STEP_STATUSES = ['pending', 'running', 'completed', 'failed', 'skipped'] as const
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number]

export const WORKFLOW_FAILURE_CODES = [
  'provider_unavailable',
  'insufficient_credits',
  'image_unreachable',
  'no_results',
  'unknown',
] as const
export type WorkflowFailureCode = (typeof WORKFLOW_FAILURE_CODES)[number]

export const LEAD_STATUSES = [
  'new',
  'qualified',
  'contacted',
  'replied',
  'opportunity',
  'won',
  'lost',
  'invalid',
] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export const OUTREACH_CHANNELS = ['facebook', 'whatsapp', 'email', 'instagram', 'other'] as const
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number]

export const OUTREACH_STATUSES = ['draft', 'ready', 'sent', 'replied', 'skipped', 'failed'] as const
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number]

export const OUTREACH_QUOTE_MODES = ['none', 'product', 'logistics', 'combined'] as const
export type OutreachQuoteMode = (typeof OUTREACH_QUOTE_MODES)[number]

export interface OutreachTemplateOptions {
  quoteMode: OutreachQuoteMode
  includeProductVisual: boolean
  emphasizeSupplier: boolean
  emphasizeLogistics: boolean
  productImageUrl: string | null
  verifiedQuoteContext: string | null
}

export const LEAD_CONTACT_TYPES = [...OUTREACH_CHANNELS, 'linkedin', 'website', 'phone'] as const
export type LeadContactType = (typeof LEAD_CONTACT_TYPES)[number]

export const CRM_ACTIVITY_TYPES = [
  'note',
  'call',
  'email',
  'whatsapp',
  'status_change',
  'quote',
  'follow_up',
  'handoff',
] as const
export type CrmActivityType = (typeof CRM_ACTIVITY_TYPES)[number]

export const WORKFLOW_STATUS_TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  draft: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: ['running', 'cancelled'],
  cancelled: [],
}

export const LEAD_STATUS_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ['qualified', 'contacted', 'invalid'],
  qualified: ['contacted', 'invalid'],
  contacted: ['replied', 'opportunity', 'lost'],
  replied: ['opportunity', 'lost'],
  opportunity: ['won', 'lost'],
  won: [],
  lost: ['qualified'],
  invalid: [],
}

export const OUTREACH_STATUS_TRANSITIONS: Record<OutreachStatus, readonly OutreachStatus[]> = {
  draft: ['ready', 'skipped'],
  ready: ['sent', 'skipped', 'failed'],
  sent: ['replied', 'failed'],
  replied: [],
  skipped: [],
  failed: ['ready', 'skipped'],
}

export interface WorkflowRun {
  id: string
  displayId: string
  parentWorkflowRunId: string | null
  rootWorkflowRunId: string | null
  revisionNo: number
  name: string
  seedType: SeedType
  seedValue: string
  seedAssetPath: string | null
  seedAssetMimeType: string | null
  seedAssetSize: string | null
  seedAssetSha256: string | null
  targetMarket: string
  searchOptions: GoogleSearchOptions
  status: WorkflowStatus
  currentStage: WorkflowStage
  progress: number
  leadCount: number
  failureReason: string | null
  failureCode: WorkflowFailureCode | null
  failureProvider: 'pipiads' | 'google_lens' | 'google_search' | null
  failureRetryable: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkflowDeletionImpact {
  workflowId: string
  canDelete: boolean
  requiresArchive: boolean
  associatedLeadCount: number
  preservedLeadCount: number
  revisionCount: number
}

export interface LeadContact {
  type: LeadContactType
  value: string
  label: string | null
  verified: boolean
  sourceUrl: string | null
  sourceType: string
  verificationStatus: 'verified' | 'observed' | 'unverified'
  confidence: number
  evidence: Record<string, unknown>
  sourcePageTitle: string | null
  sourcePageKind: string | null
  extractedFrom: string
}

export interface LeadAdEvidence {
  provider: string
  evidenceSource: string
  platform: 'facebook' | 'instagram' | 'tiktok' | 'unknown'
  adId: string | null
  sourceUrl: string
  isDirectAdLink: boolean
  confidence: number
  matchReasons: string[]
}

export interface LeadWorkflowDiscovery {
  workflowRunId: string
  workflowDisplayId: string
  workflowName: string
  workflowCreatedAt: string
  discoveredAt: string
  score: number
}

export interface StoreLead {
  id: string
  workflowRunId: string | null
  brandName: string
  domain: string
  storeUrl: string
  productUrl: string | null
  ownerFacebookUrl: string | null
  discoverySources: DiscoverySource[]
  source: string
  country: string
  language: string
  category: string
  shopifyConfidence: number
  adActivityScore: number
  trafficScore: number
  contactScore: number
  totalScore: number
  status: LeadStatus
  discoveryStatus: 'first_seen' | 'seen_before'
  discoveryCount: number
  workflowDiscoveries: LeadWorkflowDiscovery[]
  recommendedAngle: string
  contacts: LeadContact[]
  adEvidence: LeadAdEvidence[]
  createdAt: string
}

export const DISCOVERY_SOURCES = ['pipiads', 'google_lens', 'google_search'] as const
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number]

export interface OutreachTask {
  id: string
  leadId: string
  leadName: string
  customer: {
    id: string
    name: string
    domain: string
    storeUrl: string
    country: string
    category: string
    totalScore: number
    status: LeadStatus
  }
  contactChannels: Array<{
    type: LeadContactType
    value: string
    label: string | null
    verified: boolean
    confidence: number
  }>
  channel: OutreachChannel
  status: OutreachStatus
  message: string
  targetContact: string | null
  subject: string | null
  templateKey: string
  templateOptions: OutreachTemplateOptions
  sendUrl: string | null
  recommendedNextAction: string
  nextFollowUpAt: string | null
  owner: string
  createdAt: string
}

export interface FollowUpStage {
  key: LeadStatus
  label: string
  count: number
  value: number
}

export interface AutoFlowDashboard {
  metrics: {
    activeWorkflows: number
    newLeads: number
    readyOutreach: number
    replies: number
    opportunities: number
  }
  funnel: FollowUpStage[]
  recentWorkflows: WorkflowRun[]
  topLeads: StoreLead[]
  nextTasks: OutreachTask[]
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
