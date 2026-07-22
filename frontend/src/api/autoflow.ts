import api from './index'

export type SeedType = 'keyword' | 'image'
export type WorkflowStatus = 'draft' | 'running' | 'completed' | 'failed' | 'cancelled'
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

export type OutreachChannel = 'whatsapp' | 'email' | 'instagram' | 'facebook'
export type OutreachStatus = 'draft' | 'ready' | 'sent' | 'replied' | 'skipped' | 'failed'
export type LeadContactType = OutreachChannel | 'linkedin' | 'website' | 'phone'

export interface WorkflowRun {
  id: string
  name: string
  seedType: SeedType
  seedValue: string
  targetMarket: string
  status: WorkflowStatus
  currentStage: WorkflowStage
  progress: number
  leadCount: number
  createdAt: string
  updatedAt: string
}

export interface LeadContact {
  type: LeadContactType
  value: string
  verified: boolean
}

export interface StoreLead {
  id: string
  workflowRunId: string | null
  brandName: string
  domain: string
  storeUrl: string
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
  recommendedAngle: string
  contacts: LeadContact[]
  createdAt: string
}

export interface OutreachTask {
  id: string
  leadId: string
  leadName: string
  channel: OutreachChannel
  status: OutreachStatus
  message: string
  nextFollowUpAt: string | null
  owner: string
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
}

export interface DiscoveryStartResult {
  workflowRunId: string
  status: 'running'
  scheduled: boolean
  resumed: boolean
}

export interface GenerateMessageRequest {
  channel?: OutreachChannel
  language?: string
  offer?: string
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
  startDiscovery(id: string): Promise<DiscoveryStartResult> {
    return api.post(`/autoflow/workflows/${id}/start-discovery`)
  },
  getLeads(status?: LeadStatus): Promise<PaginatedResult<StoreLead>> {
    return api.get('/autoflow/leads', { params: { status } })
  },
  getLead(id: string): Promise<StoreLead> {
    return api.get(`/autoflow/leads/${id}`)
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
