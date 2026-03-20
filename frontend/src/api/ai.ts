import api from './index'
import type { AIRequest, AIResponse } from '@/types'

export const aiApi = {
  async generate(request: AIRequest): Promise<AIResponse> {
    return api.post('/ai/generate', request)
  },

  async *generateStream(request: AIRequest): AsyncGenerator<string> {
    const response = await fetch('/api/ai/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
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
  }
}
