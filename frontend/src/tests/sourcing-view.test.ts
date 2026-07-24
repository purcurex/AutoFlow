import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SourcingView from '@/views/autoflow/SourcingView.vue'
import type { SourcingSummary } from '@/utils/sourcing'

const apiMock = vi.hoisted(() => ({
  getWorkflowSourcing: vi.fn(),
  startWorkflowSourcing: vi.fn(),
}))

vi.mock('@/api/autoflow', () => ({
  autoflowApi: apiMock,
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'workflow-1688' } }),
}))

vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => key,
    }),
  }
})

const completedSummary: SourcingSummary = {
  workflowId: 'workflow-1688',
  provider: 'alibaba_1688',
  providerConfigured: true,
  latestSearch: {
    id: 'search-1',
    status: 'completed',
    searchMode: 'keyword',
    query: 'pet brush',
  },
  offers: [
    {
      id: 'offer-1',
      providerOfferId: '16880001',
      sourcingScore: 91,
      imageUrl: 'https://cbu01.alicdn.com/img/offer.jpg',
      chineseTitle: 'Pet Slicker Brush',
      foreignTitle: 'Professional Pet Grooming Brush',
      offerUrl: 'https://detail.1688.com/offer/16880001.html',
      currency: 'CNY',
      priceMin: 6.8,
      priceMax: 9.9,
      moq: 2,
      unit: 'piece',
      salesVolume: 1580,
      repurchaseRate: 37.5,
      supplier: {
        companyName: 'Hangzhou Pet Supplies',
        shopUrl: 'https://pet-supplier.1688.com',
        score: 4.8,
        identities: ['Verified Factory'],
      },
      recommendationReasons: ['Strong visual match', 'Low MOQ'],
    },
  ],
}

function mountView() {
  return mount(SourcingView, {
    global: {
      stubs: {
        AppLayout: { template: '<main><slot /></main>' },
        PageHeader: {
          template: '<header><slot name="actions" /></header>',
        },
        ReturnButton: {
          template: '<button data-test="detail-return">Back</button>',
        },
      },
    },
  })
}

describe('1688 sourcing view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the provider-not-configured state without starting a search', async () => {
    apiMock.getWorkflowSourcing.mockResolvedValue({
      workflowId: 'workflow-1688',
      providerConfigured: false,
      status: 'not_configured',
      offers: [],
    } satisfies SourcingSummary)

    const wrapper = mountView()
    await flushPromises()

    expect(apiMock.getWorkflowSourcing).toHaveBeenCalledWith('workflow-1688')
    expect(wrapper.find('[data-test="provider-not-configured"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="sourcing-status"]').text()).toContain('sourcing.status_not_configured')
    expect(wrapper.find<HTMLButtonElement>('[data-test="restart-sourcing"]').element.disabled).toBe(true)
  })

  it('renders sourcing offers and keeps sourcing score separate', async () => {
    apiMock.getWorkflowSourcing.mockResolvedValue(completedSummary)

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.findAll('[data-test="sourcing-offer"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="source-tag"]').text()).toContain('sourcing.sourceTag')
    expect(wrapper.text()).toContain('91')
    expect(wrapper.text()).toContain('Pet Slicker Brush')
    expect(wrapper.text()).toContain('Professional Pet Grooming Brush')
    expect(wrapper.text()).toContain('Hangzhou Pet Supplies')
    expect(wrapper.text()).toContain('Verified Factory')
    expect(wrapper.text()).toContain('Strong visual match')
    expect(wrapper.text()).toContain('sourcing.boundaryDescription')
  })

  it('opens 1688 product and shop links in secure new tabs', async () => {
    apiMock.getWorkflowSourcing.mockResolvedValue(completedSummary)

    const wrapper = mountView()
    await flushPromises()

    const offerLink = wrapper.get<HTMLAnchorElement>('[data-test="offer-link"]')
    const shopLink = wrapper.get<HTMLAnchorElement>('[data-test="shop-link"]')
    for (const link of [offerLink, shopLink]) {
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toContain('noopener')
      expect(link.attributes('rel')).toContain('noreferrer')
      expect(link.attributes('href')).toMatch(/^https:\/\//)
    }
  })

  it('forces a new sourcing search and reloads the latest state', async () => {
    apiMock.getWorkflowSourcing
      .mockResolvedValueOnce(completedSummary)
      .mockResolvedValueOnce({
        ...completedSummary,
        latestSearch: { id: 'search-2', status: 'running' },
        offers: [],
      } satisfies SourcingSummary)
    apiMock.startWorkflowSourcing.mockResolvedValue({
      id: 'search-2',
      status: 'running',
    })

    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-test="restart-sourcing"]').trigger('click')
    await flushPromises()

    expect(apiMock.startWorkflowSourcing).toHaveBeenCalledWith('workflow-1688', { force: true })
    expect(apiMock.getWorkflowSourcing).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-test="sourcing-running"]').exists()).toBe(true)
    expect(wrapper.find<HTMLButtonElement>('[data-test="restart-sourcing"]').element.disabled).toBe(true)
  })
})
