import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SourcingView from '@/views/autoflow/SourcingView.vue'
import type { SourcingSummary } from '@/utils/sourcing'

const apiMock = vi.hoisted(() => ({
  getWorkflowSourcing: vi.fn(),
  startWorkflowSourcing: vi.fn(),
  requestWorkflowSourcingPage: vi.fn(),
  extendWorkflowSourcingWindow: vi.fn(),
}))
const routerMock = vi.hoisted(() => ({ replace: vi.fn() }))
const routeMock = vi.hoisted(() => ({
  params: { id: 'workflow-1688' },
  query: {} as Record<string, string>,
}))

vi.mock('@/api/autoflow', () => ({
  autoflowApi: apiMock,
}))

vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => routerMock,
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
  workflowInput: {
    name: 'Pet brush prospecting',
    seedType: 'keyword',
    seedValue: 'pet brush',
    targetMarket: 'United States',
  },
  latestSearch: {
    id: 'search-1',
    status: 'completed',
    searchMode: 'keyword',
    query: 'pet brush',
  },
  pagination: {
    page: 1,
    pageSize: 20,
    totalRecords: 1,
    totalPages: 1,
    resultCount: 1,
    loaded: true,
    status: 'succeeded',
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
    routeMock.query = {}
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows not configured without a running label or pagination polling', async () => {
    vi.useFakeTimers()
    apiMock.getWorkflowSourcing.mockResolvedValue({
      workflowId: 'workflow-1688',
      providerConfigured: false,
      status: 'not_configured',
      pagination: {
        page: 1,
        pageSize: 20,
        totalRecords: null,
        totalPages: null,
        resultCount: 0,
        loaded: false,
        status: 'pending',
      },
      offers: [],
    } satisfies SourcingSummary)

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-test="provider-not-configured"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="sourcing-status"]').text())
      .toContain('sourcing.status_not_configured')
    expect(wrapper.get('[data-test="restart-sourcing"]').text())
      .toContain('sourcing.startAction')
    expect(wrapper.get('[data-test="restart-sourcing"]').text())
      .not.toContain('sourcing.runningAction')

    await vi.advanceTimersByTimeAsync(3_000)
    await flushPromises()
    expect(apiMock.getWorkflowSourcing).toHaveBeenCalledTimes(1)
    wrapper.unmount()
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
    expect(wrapper.get('[data-test="sourcing-match-context"]').text()).toContain('Pet brush prospecting')
    expect(wrapper.get('[data-test="sourcing-match-context"]').text()).toContain('pet brush')
  })

  it('loads an existing 10-item search without guessing a 20-item page size', async () => {
    apiMock.getWorkflowSourcing.mockImplementation(async (_workflowId, query) => {
      if (query?.pageSize !== undefined) throw new Error('pageSize mismatch')
      return {
        ...completedSummary,
        pagination: { ...completedSummary.pagination!, pageSize: 10 },
      } satisfies SourcingSummary
    })

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-test="sourcing-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="sourcing-offer"]')).toHaveLength(1)
    expect(wrapper.get<HTMLSelectElement>('[data-test="sourcing-page-size"]').element.value).toBe('10')
  })

  it('reloads after an initial failure without repeating a guessed page size', async () => {
    let attempt = 0
    apiMock.getWorkflowSourcing.mockImplementation(async (_workflowId, query) => {
      attempt += 1
      if (attempt === 1) throw new Error('temporary load failure')
      if (query?.pageSize !== undefined) throw new Error('pageSize mismatch')
      return {
        ...completedSummary,
        pagination: { ...completedSummary.pagination!, pageSize: 10 },
      } satisfies SourcingSummary
    })

    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-test="sourcing-error"] button').trigger('click')
    await flushPromises()

    expect(attempt).toBe(2)
    expect(wrapper.find('[data-test="sourcing-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="sourcing-offer"]')).toHaveLength(1)
  })

  it('shows the image matching input and a first-run action before a search exists', async () => {
    apiMock.getWorkflowSourcing.mockResolvedValue({
      workflowId: 'workflow-1688',
      provider: 'alibaba_1688',
      providerConfigured: true,
      status: 'idle',
      workflowInput: {
        name: 'Pet brush image sourcing',
        seedType: 'image',
        seedValue: 'https://cdn.example.com/pet-brush.png',
        targetMarket: 'Canada',
      },
      search: null,
      latestSearch: null,
      pagination: {
        page: 1,
        pageSize: 20,
        totalRecords: null,
        totalPages: null,
        resultCount: 0,
        loaded: false,
        status: 'pending',
      },
      items: [],
      offers: [],
    } satisfies SourcingSummary)

    const wrapper = mountView()
    await flushPromises()

    const context = wrapper.get('[data-test="sourcing-match-context"]')
    expect(context.text()).toContain('Pet brush image sourcing')
    expect(context.text()).toContain('https://cdn.example.com/pet-brush.png')
    expect(context.text()).toContain('Canada')
    expect(wrapper.get('[data-test="restart-sourcing"]').text()).toContain('sourcing.startAction')
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
        pagination: {
          ...completedSummary.pagination!,
          loaded: false,
          status: 'pending',
          resultCount: 0,
        },
        offers: [],
      } satisfies SourcingSummary)
    apiMock.startWorkflowSourcing.mockResolvedValue({
      searchId: 'search-2',
      status: 'pending',
      page: 1,
      pageSize: 20,
    })

    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-test="restart-sourcing"]').trigger('click')
    await flushPromises()

    expect(apiMock.startWorkflowSourcing).toHaveBeenCalledWith('workflow-1688', {
      force: true,
      pageSize: 20,
    })
    expect(apiMock.getWorkflowSourcing).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-test="sourcing-running"]').exists()).toBe(true)
    expect(wrapper.find<HTMLButtonElement>('[data-test="restart-sourcing"]').element.disabled).toBe(true)
    wrapper.unmount()
  })

  it('requests an unloaded next page, polls it, and keeps URL state in sync', async () => {
    vi.useFakeTimers()
    apiMock.getWorkflowSourcing
      .mockResolvedValueOnce({
        ...completedSummary,
        pagination: { ...completedSummary.pagination!, totalRecords: 25, totalPages: 2 },
      })
      .mockResolvedValueOnce({
        ...completedSummary,
        offers: [],
        pagination: {
          ...completedSummary.pagination!,
          page: 2,
          totalRecords: 25,
          totalPages: 2,
          loaded: false,
          status: 'pending',
          resultCount: 0,
        },
      })
      .mockResolvedValueOnce({
        ...completedSummary,
        pagination: {
          ...completedSummary.pagination!,
          page: 2,
          totalRecords: 25,
          totalPages: 2,
        },
      })
    apiMock.requestWorkflowSourcingPage.mockResolvedValue({
      searchId: 'search-1', status: 'pending', page: 2, pageSize: 20,
    })

    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-test="next-sourcing-page"]').trigger('click')
    await flushPromises()

    expect(apiMock.requestWorkflowSourcingPage).toHaveBeenCalledWith(
      'workflow-1688', 'search-1', 2,
    )
    await vi.advanceTimersByTimeAsync(1_500)
    await flushPromises()
    expect(apiMock.getWorkflowSourcing).toHaveBeenLastCalledWith('workflow-1688', {
      searchId: 'search-1', page: 2, pageSize: 20,
    })
    expect(routerMock.replace).toHaveBeenLastCalledWith(expect.objectContaining({
      query: expect.objectContaining({ searchId: 'search-1', page: '2', pageSize: '20' }),
    }))
    wrapper.unmount()
  })

  it('shows a loading state immediately and while an unloaded page is pending', async () => {
    let resolvePageRequest!: (value: {
      searchId: string
      status: 'pending'
      page: number
      pageSize: 20
    }) => void
    apiMock.getWorkflowSourcing
      .mockResolvedValueOnce({
        ...completedSummary,
        pagination: { ...completedSummary.pagination!, totalRecords: 25, totalPages: 2 },
      })
      .mockResolvedValueOnce({
        ...completedSummary,
        offers: [],
        pagination: {
          ...completedSummary.pagination!,
          page: 2,
          totalRecords: 25,
          totalPages: 2,
          loaded: false,
          status: 'pending',
          resultCount: 0,
        },
      })
    apiMock.requestWorkflowSourcingPage.mockImplementation(() => new Promise((resolve) => {
      resolvePageRequest = resolve
    }))

    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-test="next-sourcing-page"]').trigger('click')

    expect(wrapper.find('[data-test="sourcing-running"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="sourcing-offer"]').exists()).toBe(false)
    expect(wrapper.get<HTMLButtonElement>('[data-test="previous-sourcing-page"]').element.disabled)
      .toBe(true)
    expect(wrapper.get<HTMLSelectElement>('[data-test="sourcing-page-size"]').element.disabled)
      .toBe(true)

    resolvePageRequest({ searchId: 'search-1', status: 'pending', page: 2, pageSize: 20 })
    await flushPromises()

    expect(wrapper.find('[data-test="sourcing-running"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="sourcing-empty"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('restores the requested search page from the URL', async () => {
    routeMock.query = { searchId: 'search-route', page: '2', pageSize: '50' }
    apiMock.getWorkflowSourcing.mockResolvedValue({
      ...completedSummary,
      latestSearch: { ...completedSummary.latestSearch!, id: 'search-route' },
      pagination: {
        ...completedSummary.pagination!,
        page: 2,
        pageSize: 50,
        totalRecords: 75,
        totalPages: 2,
      },
    })

    const wrapper = mountView()
    await flushPromises()

    expect(apiMock.getWorkflowSourcing).toHaveBeenCalledWith('workflow-1688', {
      searchId: 'search-route', page: 2, pageSize: 50,
    })
    wrapper.unmount()
  })

  it('requeues a failed page without replacing the current search', async () => {
    apiMock.getWorkflowSourcing
      .mockResolvedValueOnce({
        ...completedSummary,
        pagination: {
          ...completedSummary.pagination!,
          loaded: false,
          status: 'failed',
        },
        offers: [],
      })
      .mockResolvedValueOnce({
        ...completedSummary,
        pagination: {
          ...completedSummary.pagination!,
          loaded: false,
          status: 'pending',
          resultCount: 0,
        },
        offers: [],
      })
    apiMock.requestWorkflowSourcingPage.mockResolvedValue({
      searchId: 'search-1', status: 'pending', page: 1, pageSize: 20,
    })

    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-test="retry-sourcing-page"]').trigger('click')
    await flushPromises()

    expect(apiMock.requestWorkflowSourcingPage).toHaveBeenCalledWith(
      'workflow-1688', 'search-1', 1,
    )
    expect(apiMock.startWorkflowSourcing).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('starts a new search when the page size changes', async () => {
    apiMock.getWorkflowSourcing
      .mockResolvedValueOnce(completedSummary)
      .mockResolvedValueOnce({
        ...completedSummary,
        latestSearch: { ...completedSummary.latestSearch!, id: 'search-50' },
        pagination: {
          ...completedSummary.pagination!,
          pageSize: 50,
        },
      })
    apiMock.startWorkflowSourcing.mockResolvedValue({
      searchId: 'search-50', status: 'pending', page: 1, pageSize: 50,
    })

    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-test="sourcing-page-size"]').setValue('50')
    await flushPromises()

    expect(apiMock.startWorkflowSourcing).toHaveBeenCalledWith('workflow-1688', {
      force: true, pageSize: 50,
    })
    expect(apiMock.getWorkflowSourcing).toHaveBeenLastCalledWith('workflow-1688', {
      searchId: 'search-50', page: 1, pageSize: 50,
    })
    wrapper.unmount()
  })

  it('extends the 100-item result window once and opens the first newly available page', async () => {
    routeMock.query = { searchId: 'search-1', page: '5', pageSize: '20' }
    let resolveWindow!: (value: {
      searchId: string
      totalRecords: number
      totalPages: number
      providerTotalRecords: number
      resultLimit: number
      canExpand: boolean
    }) => void
    apiMock.getWorkflowSourcing
      .mockResolvedValueOnce({
        ...completedSummary,
        pagination: {
          ...completedSummary.pagination!,
          page: 5,
          totalRecords: 100,
          totalPages: 5,
          providerTotalRecords: 574,
          resultLimit: 100,
          canExpand: true,
        },
      } satisfies SourcingSummary)
      .mockResolvedValueOnce({
        ...completedSummary,
        pagination: {
          ...completedSummary.pagination!,
          page: 6,
          totalRecords: 200,
          totalPages: 10,
          providerTotalRecords: 574,
          resultLimit: 200,
          canExpand: true,
        },
      } satisfies SourcingSummary)
    apiMock.extendWorkflowSourcingWindow.mockImplementation(() => new Promise((resolve) => {
      resolveWindow = resolve
    }))
    apiMock.requestWorkflowSourcingPage.mockResolvedValue({
      searchId: 'search-1', status: 'pending', page: 6, pageSize: 20,
    })

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('[data-test="sourcing-result-window"]').text()).toContain('100')
    expect(wrapper.get('[data-test="sourcing-result-window"]').text()).toContain('574')
    await wrapper.get('[data-test="extend-sourcing-results"]').trigger('click')
    expect(wrapper.get('[data-test="extend-sourcing-results"]').text())
      .toContain('sourcing.continuingResults')
    expect(wrapper.get<HTMLButtonElement>('[data-test="extend-sourcing-results"]').element.disabled)
      .toBe(true)

    resolveWindow({
      searchId: 'search-1',
      totalRecords: 200,
      totalPages: 10,
      providerTotalRecords: 574,
      resultLimit: 200,
      canExpand: true,
    })
    await flushPromises()

    expect(apiMock.extendWorkflowSourcingWindow).toHaveBeenCalledWith(
      'workflow-1688', 'search-1', 200,
    )
    expect(apiMock.requestWorkflowSourcingPage).toHaveBeenCalledWith(
      'workflow-1688', 'search-1', 6,
    )
    expect(wrapper.get('[data-test="sourcing-page-indicator"]').text()).toContain('6 / 10')
    expect(routerMock.replace).toHaveBeenLastCalledWith(expect.objectContaining({
      query: expect.objectContaining({ searchId: 'search-1', page: '6', pageSize: '20' }),
    }))
    wrapper.unmount()
  })

  it('does not offer another result window after all provider matches are accessible', async () => {
    routeMock.query = { searchId: 'search-1', page: '5', pageSize: '20' }
    apiMock.getWorkflowSourcing.mockResolvedValue({
      ...completedSummary,
      pagination: {
        ...completedSummary.pagination!,
        page: 5,
        totalRecords: 92,
        totalPages: 5,
        providerTotalRecords: 92,
        resultLimit: 100,
        canExpand: false,
      },
    } satisfies SourcingSummary)

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-test="extend-sourcing-results"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('stops polling after the view is unmounted', async () => {
    vi.useFakeTimers()
    apiMock.getWorkflowSourcing.mockResolvedValue({
      ...completedSummary,
      pagination: {
        ...completedSummary.pagination!,
        loaded: false,
        status: 'pending',
        resultCount: 0,
      },
      offers: [],
    })

    const wrapper = mountView()
    await flushPromises()
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(1_500)

    expect(apiMock.getWorkflowSourcing).toHaveBeenCalledTimes(1)
  })
})
