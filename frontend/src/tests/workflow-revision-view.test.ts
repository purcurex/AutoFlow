import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  customerDiscoveryStatus: 'completed',
  failureReason: null,
  failureCode: null,
  failureProvider: null,
  failureRetryable: false,
  archivedAt: null,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
}

const imageWorkflowFixture: WorkflowRun = {
  ...workflowFixture,
  seedType: 'image',
  seedValue: 'https://assets.example.test/products/pet-brush.jpg',
  seedAssetPath: '/uploads/workflow-seeds/11111111-1111-4111-8111-111111111111/pet-brush.jpg',
  seedAssetMimeType: 'image/jpeg',
  seedAssetSize: '209829',
  seedAssetSha256: 'a'.repeat(64),
}

function mountWorkflowView(props: { create?: boolean; reviseId?: string }) {
  return mount(WorkflowsView, {
    props,
    global: {
      mocks: {
        $te: () => true,
        $t: (key: string) => key,
      },
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

  it('shows the persisted product image when revising an image workflow', async () => {
    storeMock.getWorkflow.mockResolvedValue(imageWorkflowFixture)
    const wrapper = mountWorkflowView({ create: true, reviseId: imageWorkflowFixture.id })
    await flushPromises()

    expect(wrapper.get<HTMLImageElement>('img[alt="workflows.imagePreview"]').attributes('src'))
      .toBe(imageWorkflowFixture.seedAssetPath)
    expect(wrapper.get<HTMLInputElement>('input[placeholder="workflows.imagePastePlaceholder"]').element.value)
      .toBe(imageWorkflowFixture.seedValue)
  })

  it('drops stale uploaded-asset metadata when a revision switches to a public image URL', async () => {
    storeMock.getWorkflow.mockResolvedValue(imageWorkflowFixture)
    storeMock.reviseWorkflow.mockResolvedValue({
      ...imageWorkflowFixture,
      id: 'revision-image-workflow',
    })
    storeMock.startDiscovery.mockResolvedValue(undefined)
    const wrapper = mountWorkflowView({ create: true, reviseId: imageWorkflowFixture.id })
    await flushPromises()

    const replacementUrl = 'https://cdn.example.test/products/replacement.webp'
    await wrapper.get<HTMLInputElement>('input[placeholder="workflows.imagePastePlaceholder"]')
      .setValue(replacementUrl)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(storeMock.reviseWorkflow).toHaveBeenCalledWith(
      imageWorkflowFixture.id,
      expect.objectContaining({
        seedValue: replacementUrl,
        seedAssetPath: undefined,
        seedAssetMimeType: undefined,
        seedAssetSize: undefined,
        seedAssetSha256: undefined,
      }),
    )
  })

  it('previews a public image URL while creating an image workflow', async () => {
    const wrapper = mountWorkflowView({ create: true })
    await flushPromises()
    await wrapper.get<HTMLInputElement>('input[type="radio"][value="image"]').setValue()
    const imageUrl = 'https://cdn.example.test/products/storage-box.webp'
    await wrapper.get<HTMLInputElement>('input[placeholder="workflows.imagePastePlaceholder"]').setValue(imageUrl)
    await flushPromises()

    expect(wrapper.get<HTMLImageElement>('img[alt="workflows.imagePreview"]').attributes('src'))
      .toBe(imageUrl)
  })
})

describe('workflow dual-mode status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeMock.workflows = []
    storeMock.fetchWorkflows.mockResolvedValue(undefined)
  })

  it('shows a non-failure pending-public-image notice for a completed workflow', async () => {
    storeMock.workflows = [{
      ...imageWorkflowFixture,
      status: 'completed',
      customerDiscoveryStatus: 'pending_public_image',
    }]

    const wrapper = mountWorkflowView({})
    await flushPromises()

    expect(wrapper.get('[data-test="workflow-customer-discovery-pending"]').text())
      .toContain('workflows.customerDiscoveryPendingPublicImage')
    expect(wrapper.find('[data-test="workflow-failure-details"]').exists()).toBe(false)
  })

  it('labels a historical local-image failure as customer discovery instead of unknown', async () => {
    storeMock.workflows = [{
      ...imageWorkflowFixture,
      status: 'failed',
      customerDiscoveryStatus: 'failed',
      failureReason: 'Workflow product image is only available locally.',
      failureCode: 'image_unreachable',
      failureProvider: 'customer_discovery',
    }]

    const wrapper = mountWorkflowView({})
    await flushPromises()
    const failureButton = wrapper.findAll('button').find((button) => (
      button.text().includes('workflows.failure_image_unreachable')
    ))
    expect(failureButton).toBeDefined()
    await failureButton!.trigger('click')

    expect(wrapper.get('[data-test="workflow-failure-provider"]').text())
      .toContain('workflows.failureProvider_customer_discovery')
    expect(wrapper.get('[data-test="workflow-failure-provider"]').text())
      .not.toContain('common.unknown')
  })
})

describe('workflow running progress refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    storeMock.workflows = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps refreshing an already-running workflow and stops after it completes', async () => {
    let refreshCount = 0
    storeMock.fetchWorkflows.mockImplementation(async () => {
      refreshCount += 1
      storeMock.workflows = [{
        ...workflowFixture,
        status: refreshCount === 1 ? 'running' : 'completed',
        progress: refreshCount === 1 ? 55 : 100,
        customerDiscoveryStatus: refreshCount === 1 ? 'running' : 'completed',
      }]
    })
    const wrapper = mountWorkflowView({})
    await flushPromises()

    expect(storeMock.fetchWorkflows).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    await flushPromises()
    expect(storeMock.fetchWorkflows).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(3_000)
    await flushPromises()
    expect(storeMock.fetchWorkflows).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('cancels the running-workflow refresh when leaving the page', async () => {
    storeMock.fetchWorkflows.mockImplementation(async () => {
      storeMock.workflows = [{
        ...workflowFixture,
        status: 'running',
        progress: 55,
        customerDiscoveryStatus: 'running',
      }]
    })
    const wrapper = mountWorkflowView({})
    await flushPromises()
    expect(storeMock.fetchWorkflows).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(3_000)
    await flushPromises()

    expect(storeMock.fetchWorkflows).toHaveBeenCalledTimes(1)
  })
})
