// 用户相关类型
export interface User {
  id: string
  email: string
  username: string
  avatarUrl?: string
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
