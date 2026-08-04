import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkflowsView from '@/views/autoflow/WorkflowsView.vue'
import type { WorkflowRun } from '@/api/autoflow'

const storeMock = vi.hoisted(() => ({
  workflows: [] as WorkflowRun[],
  isLoading: false,
  fetchWorkflows: vi.fn(),
  getWorkflow: vi.fn(),
  createWorkflow: vi.fn(),
  reviseWorkflow: vi.fn(),
  startDiscovery: vi.fn(),
  deleteWorkflow: vi.fn(),
  archiveWorkflow: vi.fn(),
}))
const routerMock = vi.hoisted(() => ({ push: vi.fn() }))
const routeMock = vi.hoisted(() => ({ fullPath: '/workflows' }))

vi.mock('@/stores', () => ({ useAutoFlowStore: () => storeMock }))
vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => routerMock,
}))
vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-i18n')>()
  return { ...actual, useI18n: () => ({ t: (key: string) => key }) }
})

const workflowFixture: WorkflowRun = {
  id: 'ef9a0d3f-ae4b-4824-9466-f646dd45cfab',
  displayId: '01',
  parentWorkflowRunId: null,
  rootWorkflowRunId: null,
  revisionNo: 1,
  name: '美国宠物用品客户开发',
  seedType: 'keyword',
  seedValue: 'pet hair remover',
  seedAssetPath: null,
  seedAssetMimeType: null,
  seedAssetSize: null,
  seedAssetSha256: null,
  targetMarket: 'Canada',
  searchOptions: {
    exactPhrase: false,
    titleMatch: true,
    excludeMarketplaces: false,
    findOwnerFacebook: true,
  },
  status: 'completed',
  currentStage: 'crm',
  progress: 100,
  leadCount: 0,
  failureReason: null,
  failureCode: null,
  failureProvider: null,
  failureRetryable: false,
  archivedAt: null,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
}

function mountWorkflowView(props: { create?: boolean; reviseId?: string }) {
  return mount(WorkflowsView, {
    props,
    global: {
      stubs: {
        AppLayout: { template: '<main><slot /></main>' },
        PageHeader: { template: '<header><slot name="actions" /></header>' },
        ReturnButton: { template: '<button>back</button>' },
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  })
}

function mountRevisionView() {
  return mountWorkflowView({ create: true, reviseId: workflowFixture.id })
}

describe('workflow revision form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeMock.fetchWorkflows.mockRejectedValue(new Error('workflow list unavailable'))
  })

  it('backfills revision fields without depending on the workflow list request', async () => {
    storeMock.getWorkflow.mockResolvedValue(workflowFixture)
    const wrapper = mountRevisionView()
    await flushPromises()

    expect(wrapper.get<HTMLInputElement>('input[placeholder="workflows.namePlaceholder"]').element.value)
      .toBe('美国宠物用品客户开发')
    expect(wrapper.get<HTMLInputElement>('input[placeholder="workflows.seedPlaceholder"]').element.value)
      .toBe('pet hair remover')
    expect(wrapper.get<HTMLInputElement>('input[name="target-market"][value="Canada"]').element.checked)
      .toBe(true)
    expect(wrapper.findAll<HTMLInputElement>('input[type="checkbox"]').map((input) => input.element.checked))
      .toEqual([false, true, false, true])
    expect(storeMock.fetchWorkflows).not.toHaveBeenCalled()
  })

  it('shows the existing load error when the revision detail request fails', async () => {
    storeMock.getWorkflow.mockRejectedValue(new Error('workflow detail unavailable'))
    const wrapper = mountRevisionView()
    await flushPromises()

    expect(wrapper.text()).toContain('workflows.loadFailed')
    expect(storeMock.fetchWorkflows).not.toHaveBeenCalled()
  })

  it('loads revision fields when Vue Router reuses the create-page component', async () => {
    storeMock.getWorkflow.mockResolvedValue(workflowFixture)
    const wrapper = mountWorkflowView({ create: true })
    await flushPromises()

    await wrapper.setProps({ create: true, reviseId: workflowFixture.id })
    await flushPromises()

    expect(storeMock.getWorkflow).toHaveBeenCalledWith(workflowFixture.id)
    expect(wrapper.get<HTMLInputElement>('input[placeholder="workflows.namePlaceholder"]').element.value)
      .toBe('美国宠物用品客户开发')
    expect(wrapper.get<HTMLInputElement>('input[placeholder="workflows.seedPlaceholder"]').element.value)
      .toBe('pet hair remover')
    expect(wrapper.get<HTMLInputElement>('input[name="target-market"][value="Canada"]').element.checked)
      .toBe(true)
  })

  it('clears revision fields when the reused component returns to the create page', async () => {
    storeMock.getWorkflow.mockResolvedValue(workflowFixture)
    const wrapper = mountRevisionView()
    await flushPromises()

    await wrapper.setProps({ create: true, reviseId: undefined })
    await flushPromises()

    expect(wrapper.get<HTMLInputElement>('input[placeholder="workflows.namePlaceholder"]').element.value)
      .toBe('')
    expect(wrapper.get<HTMLInputElement>('input[placeholder="workflows.seedPlaceholder"]').element.value)
      .toBe('')
    expect(wrapper.get<HTMLInputElement>('input[name="target-market"][value="United States"]').element.checked)
      .toBe(true)
  })
})
