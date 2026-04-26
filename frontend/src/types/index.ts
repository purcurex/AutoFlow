// 用户相关类型
export type UserRole = 'admin' | 'user'

export interface User {
  id: string
  email: string
  username: string
  avatarUrl?: string
  role: UserRole
  createdAt: string
  updatedAt: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  username: string
  password: string
}

export interface AuthResponse {
  token: string
  user: User
}

// 笔记相关类型
export type EditorType = 'markdown' | 'richtext'

export interface Note {
  id: string
  userId: string
  folderId: string | null
  title: string
  content: string
  contentHtml?: string
  editorType: EditorType
  tags: string[]
  isFavorite: boolean
  isDeleted: boolean
  deletedAt: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateNoteRequest {
  title?: string
  content?: string
  folderId?: string | null
  editorType?: EditorType
  tags?: string[]
}

export interface UpdateNoteRequest {
  title?: string
  content?: string
  folderId?: string | null
  tags?: string[]
  isFavorite?: boolean
  sortOrder?: number
}

export interface ReorderNotesRequest {
  noteIds: string[]
}

// 文件夹相关类型
export interface Folder {
  id: string
  userId: string
  parentId: string | null
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateFolderRequest {
  name: string
  parentId?: string | null
}

export interface UpdateFolderRequest {
  name?: string
  parentId?: string | null
  sortOrder?: number
}

// 标签相关类型
export interface Tag {
  id: string
  userId: string
  name: string
  color: string
  createdAt: string
}

// API响应类型
export interface ApiResponse<T> {
  data: T
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

// AI相关类型
export interface AIRequest {
  action: 'continue' | 'polish' | 'summarize' | 'translate' | 'expand' | 'condense'
  content: string
  context?: string
  targetLanguage?: string
}

export interface AIResponse {
  result: string
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

export type WorkflowSeedType = 'keyword' | 'image'
export type WorkflowStatus = 'draft' | 'running' | 'completed' | 'failed'
export type LeadStatus = 'new' | 'qualified' | 'contacted' | 'replied' | 'opportunity' | 'won' | 'lost' | 'invalid'
export type OutreachChannel = 'whatsapp' | 'email' | 'instagram' | 'facebook'
export type OutreachStatus = 'draft' | 'ready' | 'sent' | 'replied' | 'skipped'

export interface WorkflowRun {
  id: string
  name: string
  seedType: WorkflowSeedType
  seedValue: string
  targetMarket: string
  status: WorkflowStatus
  currentStage: string
  progress: number
  leadCount: number
  createdAt: string
  updatedAt: string
}

export interface StoreLeadContact {
  type: OutreachChannel | 'website'
  value: string
  label?: string
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
  contacts: StoreLeadContact[]
  createdAt: string
}

export interface OutreachTask {
  id: string
  leadId: string
  channel: OutreachChannel
  status: OutreachStatus
  message: string
  nextFollowUpAt: string
  owner: string
  lead?: StoreLead
}

export interface AutoFlowDashboard {
  metrics: {
    activeWorkflows: number
    leadsDiscovered: number
    qualifiedLeads: number
    outreachReady: number
    replyRate: number
    pipelineValue: number
  }
  workflows: WorkflowRun[]
  topLeads: StoreLead[]
  outreachTasks: OutreachTask[]
}

export interface AutoFlowCrmStage {
  id: LeadStatus
  name: string
  leads: StoreLead[]
}

export interface AutoFlowCrmBoard {
  stages: AutoFlowCrmStage[]
}

export interface CreateWorkflowRunRequest {
  name: string
  seedType: WorkflowSeedType
  seedValue: string
  targetMarket: string
}

export interface AutoFlowMessageRequest {
  channel?: OutreachChannel
  tone?: string
}

export interface AutoFlowMessageResponse {
  message: string
  leadId: string
}
