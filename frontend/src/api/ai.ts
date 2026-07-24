import api from './index'
import type { AIRequest, AIResponse } from '@/types'
import type {
  OutreachChannel,
  OutreachQuoteMode,
  OutreachTemplateOptions,
} from './autoflow'

export type AiPromptModuleKey =
  | 'outreach_base' | 'channel_whatsapp' | 'channel_email' | 'channel_instagram' | 'channel_facebook' | 'channel_other'
  | 'quote_none' | 'quote_product' | 'quote_logistics' | 'quote_combined'
  | 'product_visual' | 'supplier_strength' | 'logistics_strength'

export interface AiPromptTemplate {
  id: string
  moduleKey: AiPromptModuleKey
  name: string
  content: string
  isSystem: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AiPromptModule {
  moduleKey: AiPromptModuleKey
  activeTemplateId: string
  systemDefaultTemplateId: string
  templates: AiPromptTemplate[]
}

export interface AiPromptCatalog {
  variables: string[]
  modules: AiPromptModule[]
}

export interface OutreachConversationOptions extends OutreachTemplateOptions {
  channel: OutreachChannel
  manualTarget?: string | null
  offer: string
  responseLanguage: 'zh-CN' | 'en'
}

export interface OutreachConversationMessage {
  id: string
  role: 'user' | 'assistant'
  sequence: number
  content: string
  createdAt: string
}

export interface BilingualOutreachDraft {
  id: string
  conversationId: string
  version: number
  status: 'draft' | 'accepted' | 'superseded'
  outreachTaskId: string | null
  englishSubject: string
  englishMessage: string
  chineseSubject: string
  chineseMessage: string
  factsUsed: string[]
  missingFacts: string[]
  warnings: string[]
  createdAt: string
  updatedAt: string
}

export interface OutreachConversation {
  id: string
  leadId: string
  title: string
  status: 'active' | 'drafted' | 'accepted' | 'archived'
  options: OutreachConversationOptions
  contextSnapshot: Record<string, unknown>
  summary: string | null
  lastDraftVersion: number
  messages: OutreachConversationMessage[]
  drafts: BilingualOutreachDraft[]
  createdAt: string
  updatedAt: string
}

export interface CreateOutreachConversationRequest {
  leadId: string
  channel: OutreachChannel
  manualTarget?: string
  quoteMode: OutreachQuoteMode
  includeProductVisual: boolean
  emphasizeSupplier: boolean
  emphasizeLogistics: boolean
  productImageUrl?: string
  verifiedQuoteContext?: string
  offer?: string
  responseLanguage?: 'zh-CN' | 'en'
}

export interface UpdateOutreachDraftRequest {
  englishSubject?: string
  englishMessage?: string
  chineseSubject?: string
  chineseMessage?: string
}

export const aiApi = {
  async generate(request: AIRequest): Promise<AIResponse> {
    return api.post('/ai/generate', request)
  },

  async *generateStream(request: AIRequest): AsyncGenerator<string> {
    const response = await fetch('/api/ai/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify(request)
    })

    if (!response.ok) {
      throw new Error('AI request failed')
    }

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()

    if (!reader) {
      throw new Error('No response body')
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      yield decoder.decode(value)
    }
  },

  askQuestion(question: string, noteIds?: string[]): Promise<AIResponse> {
    return api.post('/ai/ask', { question, noteIds })
  },

  suggestTags(content: string): Promise<{ tags: string[] }> {
    return api.post('/ai/suggest-tags', { content })
  },

  getPromptModules(): Promise<AiPromptCatalog> {
    return api.get('/ai/prompt-modules')
  },

  createPromptTemplate(data: { moduleKey: AiPromptModuleKey; name: string; content: string }): Promise<AiPromptTemplate> {
    return api.post('/ai/prompt-templates', data)
  },

  updatePromptTemplate(id: string, data: { name: string; content: string }): Promise<AiPromptTemplate> {
    return api.patch(`/ai/prompt-templates/${id}`, data)
  },

  deletePromptTemplate(id: string): Promise<void> {
    return api.delete(`/ai/prompt-templates/${id}`)
  },

  activatePromptTemplate(moduleKey: AiPromptModuleKey, templateId: string): Promise<void> {
    return api.put(`/ai/prompt-modules/${moduleKey}/active`, { templateId })
  },

  listOutreachConversations(leadId: string): Promise<OutreachConversation[]> {
    return api.get('/ai/outreach-conversations', { params: { leadId } })
  },

  createOutreachConversation(data: CreateOutreachConversationRequest): Promise<OutreachConversation> {
    return api.post('/ai/outreach-conversations', data)
  },

  getOutreachConversation(id: string): Promise<OutreachConversation> {
    return api.get(`/ai/outreach-conversations/${id}`)
  },

  sendOutreachConversationMessage(
    id: string,
    content: string,
  ): Promise<{ userMessage: OutreachConversationMessage; assistantMessage: OutreachConversationMessage }> {
    return api.post(`/ai/outreach-conversations/${id}/messages`, { content })
  },

  generateOutreachDraft(id: string): Promise<BilingualOutreachDraft> {
    return api.post(`/ai/outreach-conversations/${id}/drafts`)
  },

  updateOutreachDraft(id: string, data: UpdateOutreachDraftRequest): Promise<BilingualOutreachDraft> {
    return api.patch(`/ai/outreach-drafts/${id}`, data)
  },

  acceptOutreachDraft(id: string): Promise<{ draft: BilingualOutreachDraft; outreachTaskId: string }> {
    return api.post(`/ai/outreach-drafts/${id}/accept`)
  },
}
