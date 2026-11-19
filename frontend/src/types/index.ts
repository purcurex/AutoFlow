// 用户相关类型
export type UserRole = 'admin' | 'user'

export interface User {
  id: string
  displayId: string
  email: string
  username: string
  avatarUrl?: string
  role: UserRole
  dataDisplayScope?: 'department' | 'self'
  businessRole?: import('@/api/workbench-access').BusinessScope['role']
  workbenchRoles?: import('@/utils/workbench').WorkbenchRole[]
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
  user: User
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
