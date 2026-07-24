import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutreachConversation } from '@/api/ai'
import type { StoreLead } from '@/api/autoflow'
import OutreachConversationPanel from '@/components/ai/OutreachConversationPanel.vue'
import { i18n, setLocale } from '@/i18n'

const aiApiMock = vi.hoisted(() => ({
  listOutreachConversations: vi.fn(),
  createOutreachConversation: vi.fn(),
  sendOutreachConversationMessage: vi.fn(),
  generateOutreachDraft: vi.fn(),
  updateOutreachDraft: vi.fn(),
  acceptOutreachDraft: vi.fn(),
}))

vi.mock('@/api/ai', () => ({ aiApi: aiApiMock }))

const lead: StoreLead = {
  id: '7c16db3d-458b-49cb-9a3a-70b44f833f3d',
  workflowRunId: null,
  brandName: 'PawSpark',
  domain: 'pawspark.co',
  storeUrl: 'https://pawspark.co',
  productUrl: 'https://pawspark.co/products/pet-brush',
  ownerFacebookUrl: null,
  discoverySources: ['pipiads'],
  source: 'PipiAds',
  country: 'US',
  language: 'English',
  category: 'Pet Supplies',
  shopifyConfidence: 90,
  adActivityScore: 80,
  trafficScore: 70,
  contactScore: 60,
  totalScore: 78,
  status: 'qualified',
  discoveryStatus: 'first_seen',
  discoveryCount: 1,
  recommendedAngle: 'Low-MOQ pet accessory sourcing',
  contacts: [],
  adEvidence: [],
  createdAt: '2026-07-23T00:00:00.000Z',
}

const resumedEmailConversation: OutreachConversation = {
  id: '1970605e-a600-44de-b5a7-b521815c12d7',
  leadId: lead.id,
  title: 'PawSpark / email',
  status: 'drafted',
  options: {
    channel: 'email',
    quoteMode: 'none',
    includeProductVisual: false,
    emphasizeSupplier: true,
    emphasizeLogistics: false,
    productImageUrl: null,
    verifiedQuoteContext: null,
    offer: 'low-MOQ sourcing',
    responseLanguage: 'zh-CN',
  },
  contextSnapshot: { brandName: 'PawSpark' },
  summary: null,
  lastDraftVersion: 1,
  messages: [
    {
      id: '7c620265-b510-4812-aede-ddcb0fc53ea5',
      role: 'assistant',
      sequence: 1,
      content: '已载入客户信息，请补充沟通重点。',
      createdAt: '2026-07-23T00:00:00.000Z',
    },
  ],
  drafts: [
    {
      id: '4f17c724-a8c9-4830-a397-c65e114403aa',
      conversationId: '1970605e-a600-44de-b5a7-b521815c12d7',
      version: 1,
      status: 'draft',
      outreachTaskId: null,
      englishSubject: 'A low-MOQ sourcing option',
      englishMessage: 'Hi, may I share a sourcing option for your review?',
      chineseSubject: '低起订量采购方案',
      chineseMessage: '您好，可以向您介绍一份采购方案供评估吗？',
      factsUsed: ['Lead brand: PawSpark'],
      missingFacts: [],
      warnings: ['Human review required'],
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    },
  ],
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
}

describe('AI outreach conversation workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setLocale('zh-CN')
    aiApiMock.listOutreachConversations.mockResolvedValue([resumedEmailConversation])
  })

  it('restores the saved channel and presents English and Chinese drafts together', async () => {
    const wrapper = mount(OutreachConversationPanel, {
      props: { lead },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    const subjectInputs = wrapper.findAll('input[placeholder="邮件主题"]')
    const messageInputs = wrapper.findAll('textarea')
    expect(subjectInputs).toHaveLength(2)
    expect(messageInputs).toHaveLength(3)
    expect((subjectInputs[0].element as HTMLInputElement).value).toBe('A low-MOQ sourcing option')
    expect((subjectInputs[1].element as HTMLInputElement).value).toBe('低起订量采购方案')
    expect((messageInputs[1].element as HTMLTextAreaElement).value)
      .toBe('Hi, may I share a sourcing option for your review?')
    expect((messageInputs[2].element as HTMLTextAreaElement).value)
      .toBe('您好，可以向您介绍一份采购方案供评估吗？')
    expect(wrapper.text()).toContain('人工确认')
  })

  it('uses Facebook as the default channel and supports a manual target for other channels', async () => {
    aiApiMock.listOutreachConversations.mockResolvedValue([])
    const wrapper = mount(OutreachConversationPanel, {
      props: { lead },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    const channelSelect = wrapper.get('select')
    expect((channelSelect.element as HTMLSelectElement).value).toBe('facebook')

    await channelSelect.setValue('other')
    expect(wrapper.find('input[placeholder*="URL"]').exists()).toBe(true)
  })
})
