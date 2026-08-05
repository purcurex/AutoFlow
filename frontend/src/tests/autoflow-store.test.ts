import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { autoflowApi, type AutoFlowDashboard, type WorkflowRun } from '@/api/autoflow'
import { useAutoFlowStore } from '@/stores'

vi.mock('@/api/autoflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/autoflow')>()
  return {
    ...actual,
    autoflowApi: {
      ...actual.autoflowApi,
      getDashboard: vi.fn(),
      getWorkflows: vi.fn(),
    },
  }
})

const workflowFixture: WorkflowRun = {
  id: 'ef9a0d3f-ae4b-4824-9466-f646dd45cfab',
  displayId: '17',
  parentWorkflowRunId: null,
  rootWorkflowRunId: null,
  revisionNo: 1,
  name: '宠物用品',
  seedType: 'image',
  seedValue: 'http://localhost:3000/uploads/workflow-seeds/product.jpg',
  seedAssetPath: '/uploads/workflow-seeds/owner/product.jpg',
  seedAssetMimeType: 'image/jpeg',
  seedAssetSize: '1024',
  seedAssetSha256: 'a'.repeat(64),
  targetMarket: 'United States',
  searchOptions: {
    exactPhrase: true,
    titleMatch: false,
    excludeMarketplaces: true,
    findOwnerFacebook: true,
  },
  status: 'running',
  currentStage: 'ad_discovery',
  progress: 10,
  leadCount: 0,
  customerDiscoveryStatus: 'running',
  failureReason: null,
  failureCode: null,
  failureProvider: null,
  failureRetryable: false,
  archivedAt: null,
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
}

const dashboardFixture: AutoFlowDashboard = {
  metrics: {
    activeWorkflows: 1,
    newLeads: 7,
    readyOutreach: 2,
    replies: 3,
    opportunities: 4,
  },
  funnel: [],
  recentWorkflows: [workflowFixture],
  topLeads: [],
  nextTasks: [],
}

function createDashboardFixture(): AutoFlowDashboard {
  return {
    ...dashboardFixture,
    metrics: { ...dashboardFixture.metrics },
    recentWorkflows: dashboardFixture.recentWorkflows.map((workflow) => ({ ...workflow })),
  }
}

describe('autoflow workflow state synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('synchronizes refreshed workflows into dashboard activity without replacing metrics', async () => {
    vi.mocked(autoflowApi.getDashboard).mockResolvedValue(createDashboardFixture())
    vi.mocked(autoflowApi.getWorkflows).mockResolvedValue({
      items: [{
        ...workflowFixture,
        currentStage: 'lead_cleaning',
        progress: 55,
        updatedAt: '2026-08-05T00:01:00.000Z',
      }],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const store = useAutoFlowStore()

    await store.fetchDashboard()
    await store.fetchWorkflows()

    expect(store.workflows[0]).toMatchObject({ progress: 55, currentStage: 'lead_cleaning' })
    expect(store.dashboard?.recentWorkflows[0]).toMatchObject({
      progress: 55,
      currentStage: 'lead_cleaning',
    })
    expect(store.dashboard?.metrics).toEqual(dashboardFixture.metrics)
  })

  it('keeps the newer workflow list when an older dashboard response arrives last', async () => {
    let resolveDashboard!: (dashboard: AutoFlowDashboard) => void
    vi.mocked(autoflowApi.getDashboard).mockReturnValue(new Promise((resolve) => {
      resolveDashboard = resolve
    }))
    vi.mocked(autoflowApi.getWorkflows).mockResolvedValue({
      items: [{
        ...workflowFixture,
        currentStage: 'lead_scoring',
        progress: 75,
        updatedAt: '2026-08-05T00:02:00.000Z',
      }],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const store = useAutoFlowStore()

    const dashboardRequest = store.fetchDashboard()
    await store.fetchWorkflows()
    resolveDashboard(createDashboardFixture())
    await dashboardRequest

    expect(store.workflows[0]).toMatchObject({ progress: 75, currentStage: 'lead_scoring' })
    expect(store.dashboard?.recentWorkflows[0]).toMatchObject({
      progress: 75,
      currentStage: 'lead_scoring',
    })
  })

  it('clears stale dashboard activity when the refreshed workflow list is empty', async () => {
    vi.mocked(autoflowApi.getDashboard).mockResolvedValue(createDashboardFixture())
    vi.mocked(autoflowApi.getWorkflows).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    const store = useAutoFlowStore()

    await store.fetchDashboard()
    await store.fetchWorkflows()

    expect(store.workflows).toEqual([])
    expect(store.dashboard?.recentWorkflows).toEqual([])
  })
})
