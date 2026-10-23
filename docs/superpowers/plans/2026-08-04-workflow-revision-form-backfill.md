# Workflow Revision Form Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让工作流修订页直接加载详情并可靠回显原表单数据，不再被工作流列表请求失败阻断。

**Architecture:** 在现有 `WorkflowsView.vue` 内把修订详情加载提取为单一职责函数，并按路由用途分流初始化：修订页请求详情，列表页请求列表，创建页使用默认表单。通过真实挂载 Vue 页面组件的 Vitest 回归测试验证详情回填及失败提示，后端接口保持不变。

**Tech Stack:** Vue 3、TypeScript、Pinia、Vue Test Utils、Vitest、Vite

## Global Constraints

- 只修改工作流页面初始化逻辑及对应前端测试。
- 不修改后端接口、数据库结构、工作流业务规则或1688寻源流程。
- 不增加自动重试、新接口或新的全局状态。
- 保留现有表单赋值、状态校验和错误文案。
- 使用 UTF-8，并为新增加载函数和关键分支编写中文注释。

---

### Task 1: 修复修订页详情回显

**Files:**
- Create: `frontend/src/tests/workflow-revision-view.test.ts`
- Modify: `frontend/src/views/autoflow/WorkflowsView.vue:103-129`

**Interfaces:**
- Consumes: `useAutoFlowStore().getWorkflow(id: string): Promise<WorkflowRun>`、`useAutoFlowStore().fetchWorkflows(): Promise<void>`、现有 `canReviseWorkflow(status)`。
- Produces: `loadRevisionSource(reviseId: string): Promise<void>`；修订页详情请求与列表请求解耦。

- [ ] **Step 1: 写入修订页回显失败测试**

创建 `frontend/src/tests/workflow-revision-view.test.ts`，使用完整的 `WorkflowRun` 固定数据挂载真实 `WorkflowsView`。列表请求固定抛错，详情请求成功时仍应回显名称、关键词、加拿大市场和四个搜索选项；详情请求失败时应显示 `workflows.loadFailed`。

```ts
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

function mountRevisionView() {
  return mount(WorkflowsView, {
    props: { create: true, reviseId: workflowFixture.id },
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
})
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `npm.cmd run test --workspace=frontend -- src/tests/workflow-revision-view.test.ts`

Expected: 两个测试失败；当前实现先调用 `fetchWorkflows()`，因此 `getWorkflow()` 未执行，字段未回显且加载失败提示不存在。

- [ ] **Step 3: 实现最小加载分流**

在 `frontend/src/views/autoflow/WorkflowsView.vue` 中把现有修订详情逻辑提取为函数，并替换挂载初始化：

```ts
/**
 * 修订页只依赖指定工作流详情完成表单回显，避免列表接口失败阻断详情请求。
 */
async function loadRevisionSource(reviseId: string) {
  try {
    const source = await store.getWorkflow(reviseId)
    if (!canReviseWorkflow(source.status)) {
      actionMessage.value = t('workflows.revisionUnavailable')
      return
    }
    revisionSource.value = source
    form.name = source.name
    form.seedType = source.seedType
    form.seedValue = source.seedValue
    form.seedAssetPath = source.seedAssetPath || undefined
    form.seedAssetMimeType = source.seedAssetMimeType as WorkflowImageUpload['mimeType'] || undefined
    form.seedAssetSize = source.seedAssetSize ? Number(source.seedAssetSize) : undefined
    form.seedAssetSha256 = source.seedAssetSha256 || undefined
    seedValues[source.seedType] = source.seedValue
    form.targetMarket = source.targetMarket
    Object.assign(form.searchOptions, source.searchOptions)
  } catch {
    actionMessage.value = t('workflows.loadFailed')
  }
}

onMounted(async () => {
  // 不同页面只加载自身必需的数据，修订页不再等待工作流列表请求。
  if (props.reviseId) {
    await loadRevisionSource(props.reviseId)
    return
  }
  if (!props.create) await store.fetchWorkflows()
})
```

- [ ] **Step 4: 运行定向测试并确认通过**

Run: `npm.cmd run test --workspace=frontend -- src/tests/workflow-revision-view.test.ts`

Expected: `2 passed`，无未处理 Promise 拒绝。

- [ ] **Step 5: 运行前端完整验证**

Run: `npm.cmd run test --workspace=frontend`

Expected: 所有前端单元测试通过。

Run: `npm.cmd run lint --workspace=frontend`

Expected: ESLint 退出码为 0。

Run: `npm.cmd run build --workspace=frontend`

Expected: `vue-tsc -b` 与 Vite 构建退出码均为 0。

- [ ] **Step 6: 在本地修订页验证实际回显**

打开 `http://localhost:5173/workflows/ef9a0d3f-ae4b-4824-9466-f646dd45cfab/revise?returnTo=/workflows`，刷新后确认：

- 工作流名称为“美国宠物用品客户开发pet hair remover”（以数据库当前值为准）。
- 关键词为 `pet hair remover`。
- 页面显示原工作流修订提示。
- 浏览器控制台没有详情加载错误。

- [ ] **Step 7: 提交实现**

```bash
git add frontend/src/tests/workflow-revision-view.test.ts frontend/src/views/autoflow/WorkflowsView.vue
git commit -m "fix: restore workflow revision form data"
```
