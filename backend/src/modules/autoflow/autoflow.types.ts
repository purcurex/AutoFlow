export const SEED_TYPES = ['keyword', 'image'] as const
export type SeedType = (typeof SEED_TYPES)[number]

export const WORKFLOW_STATUSES = ['draft', 'running', 'completed', 'failed'] as const
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

export const OUTREACH_CHANNELS = ['whatsapp', 'email', 'instagram', 'facebook'] as const
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number]

export const OUTREACH_STATUSES = ['draft', 'ready', 'sent', 'replied', 'skipped'] as const
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number]

export const LEAD_CONTACT_TYPES = [...OUTREACH_CHANNELS, 'website', 'phone'] as const
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
