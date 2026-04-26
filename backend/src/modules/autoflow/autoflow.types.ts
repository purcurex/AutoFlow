export type SeedType = 'keyword' | 'image'
export type WorkflowStatus = 'draft' | 'running' | 'completed' | 'failed'
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
export type OutreachStatus = 'draft' | 'ready' | 'sent' | 'replied' | 'skipped'

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
  type: OutreachChannel
  value: string
  verified: boolean
}

export interface StoreLead {
  id: string
  workflowRunId: string
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
  nextFollowUpAt: string
  owner: string
}

export interface CrmStage {
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
  funnel: CrmStage[]
  recentWorkflows: WorkflowRun[]
  topLeads: StoreLead[]
  nextTasks: OutreachTask[]
}

export interface CreateWorkflowRequest {
  name?: string
  seedType: SeedType
  seedValue: string
  targetMarket?: string
}

export interface GenerateMessageRequest {
  channel?: OutreachChannel
  language?: string
  offer?: string
}

export interface UpdateOutreachTaskRequest {
  status?: OutreachStatus
  nextFollowUpAt?: string
  owner?: string
}
