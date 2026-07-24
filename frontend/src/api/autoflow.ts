import api from './index'

export type SeedType = 'keyword' | 'image'
export type WorkflowStatus = 'draft' | 'running' | 'completed' | 'failed' | 'cancelled'
export type WorkflowFailureCode =
  | 'provider_unavailable'
  | 'insufficient_credits'
  | 'image_unreachable'
  | 'no_results'
  | 'unknown'
export type WorkflowStage =
  | 'seed'
  | 'ad_discovery'
  | 'store_detection'
  | 'lead_cleaning'
  | 'lead_scoring'
  | 'message_generation'
  | 'outreach'
  | 'crm'

export type LeadStatus =
  | 'new'
  | 'qualified'
  | 'contacted'
  | 'replied'
  | 'opportunity'
  | 'won'
  | 'lost'
  | 'invalid'

export type OutreachChannel = 'facebook' | 'whatsapp' | 'email' | 'instagram' | 'other'
export type OutreachStatus = 'draft' | 'ready' | 'sent' | 'replied' | 'skipped' | 'failed'
export type OutreachQuoteMode = 'none' | 'product' | 'logistics' | 'combined'

export interface OutreachTemplateOptions {
  quoteMode: OutreachQuoteMode
  includeProductVisual: boolean
  emphasizeSupplier: boolean
  emphasizeLogistics: boolean
  productImageUrl: string | null
  verifiedQuoteContext: string | null
}
export type LeadContactType = OutreachChannel | 'linkedin' | 'website' | 'phone'
export type DiscoverySource = 'pipiads' | 'google_lens' | 'google_search'

export interface GoogleSearchOptions {
  exactPhrase: boolean
  titleMatch: boolean
  excludeMarketplaces: boolean
  findOwnerFacebook: boolean
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
  workflowDiscoveries?: LeadWorkflowDiscovery[]
  recommendedAngle: string
  contacts: LeadContact[]
  adEvidence: LeadAdEvidence[]
  createdAt: string
}

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

export interface CreateWorkflowRequest {
  name?: string
  seedType: SeedType
  seedValue: string
  targetMarket?: string
  searchOptions?: GoogleSearchOptions
}

export interface WorkflowImageUpload {
  assetPath: string
  publicUrl: string
  providerReady: boolean
  originalName: string
  size: number
}

export interface DiscoveryStartResult {
  workflowRunId: string
  status: 'running'
  scheduled: boolean
  resumed: boolean
}

export type SourcingSearchStatus =
  | 'not_configured'
  | 'idle'
  | 'running'
  | 'failed'
  | 'completed'

export interface SourcingOffer {
  id: string
  providerOfferId?: string
  sourcingScore: number
  imageUrl?: string | null
  chineseTitle?: string | null
  foreignTitle?: string | null
  title?: string | null
  offerUrl?: string | null
  currency?: string | null
  priceMin?: number | string | null
  priceMax?: number | string | null
  price?: number | string | null
  moq?: number | string | null
  unit?: string | null
  salesVolume?: number | string | null
  repurchaseRate?: number | string | null
  supplier?: {
    companyName?: string | null
    shopName?: string | null
    shopUrl?: string | null
    score?: number | string | null
    identities?: string[]
    badges?: string[]
  } | null
  supplierCompanyName?: string | null
  supplierShopUrl?: string | null
  supplierScore?: number | string | null
  supplierIdentities?: string[]
  recommendationReasons?: string[]
  scoreReasons?: string[]
}

export interface SourcingSearch {
  id: string
  status: SourcingSearchStatus
  searchMode?: SeedType
  query?: string | null
  failureCode?: string | null
  failureMessage?: string | null
  startedAt?: string | null
  completedAt?: string | null
}

export interface SourcingSummary {
  workflowId?: string
  provider?: 'alibaba_1688'
  providerConfigured: boolean
  status?: SourcingSearchStatus
  latestSearch?: SourcingSearch | null
  search?: SourcingSearch | null
  offers: SourcingOffer[]
}

export interface StartSourcingRequest {
  force?: boolean
  priceMin?: number
  priceMax?: number
  pageSize?: number
}

export interface GenerateMessageRequest {
  channel?: OutreachChannel
  targetContact?: string
  language?: string
  offer?: string
  quoteMode?: OutreachQuoteMode
  includeProductVisual?: boolean
  emphasizeSupplier?: boolean
  emphasizeLogistics?: boolean
  productImageUrl?: string
  verifiedQuoteContext?: string
}

export interface UpdateOutreachTaskRequest {
  status?: OutreachStatus
  message?: string
  nextFollowUpAt?: string
}

export const autoflowApi = {
  getDashboard(): Promise<AutoFlowDashboard> {
    return api.get('/autoflow/dashboard')
  },
  getWorkflows(): Promise<PaginatedResult<WorkflowRun>> {
    return api.get('/autoflow/workflows')
  },
  createWorkflow(data: CreateWorkflowRequest): Promise<WorkflowRun> {
    return api.post('/autoflow/workflows', data)
  },
  getWorkflow(id: string): Promise<WorkflowRun> {
    return api.get(`/autoflow/workflows/${id}`)
  },
  createWorkflowRevision(id: string, data: CreateWorkflowRequest): Promise<WorkflowRun> {
    return api.post(`/autoflow/workflows/${id}/revisions`, data)
  },
  getWorkflowDeletionImpact(id: string): Promise<WorkflowDeletionImpact> {
    return api.get(`/autoflow/workflows/${id}/deletion-impact`)
  },
  deleteWorkflow(id: string): Promise<{ deleted: true; preservedLeadCount: number }> {
    return api.delete(`/autoflow/workflows/${id}`)
  },
  archiveWorkflow(id: string): Promise<WorkflowRun> {
    return api.post(`/autoflow/workflows/${id}/archive`)
  },
  uploadWorkflowImage(file: File): Promise<WorkflowImageUpload> {
    const formData = new FormData()
    formData.append('image', file)
    return api.post('/autoflow/workflow-images', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  startDiscovery(id: string): Promise<DiscoveryStartResult> {
    return api.post(`/autoflow/workflows/${id}/start-discovery`)
  },
  getWorkflowSourcing(id: string): Promise<SourcingSummary> {
    return api.get(`/autoflow/workflows/${id}/sourcing`)
  },
  startWorkflowSourcing(
    id: string,
    data: StartSourcingRequest = {},
  ): Promise<SourcingSummary> {
    return api.post(`/autoflow/workflows/${id}/sourcing/search`, data)
  },
  getLeads(status?: LeadStatus, page = 1, pageSize = 100): Promise<PaginatedResult<StoreLead>> {
    return api.get('/autoflow/leads', { params: { status, page, pageSize } })
  },
  getLead(id: string): Promise<StoreLead> {
    return api.get(`/autoflow/leads/${id}`)
  },

  analyzeLeadContacts(id: string): Promise<StoreLead> {
    return api.post(`/autoflow/leads/${id}/analyze-contacts`)
  },
  generateMessage(id: string, data: GenerateMessageRequest): Promise<OutreachTask> {
    return api.post(`/autoflow/leads/${id}/messages`, data)
  },
  updateLeadStatus(id: string, status: LeadStatus, note?: string): Promise<StoreLead> {
    return api.patch(`/autoflow/leads/${id}/status`, { status, note })
  },
  getOutreachTasks(): Promise<PaginatedResult<OutreachTask>> {
    return api.get('/autoflow/outreach-tasks')
  },
  updateOutreachTask(id: string, data: UpdateOutreachTaskRequest): Promise<OutreachTask> {
    return api.patch(`/autoflow/outreach-tasks/${id}`, data)
  },
  getFollowUps(): Promise<FollowUpStage[]> {
    return api.get('/autoflow/follow-ups')
  },
}
