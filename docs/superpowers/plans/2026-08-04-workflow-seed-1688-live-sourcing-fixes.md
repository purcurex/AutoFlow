# Workflow Seed 1688 Live Sourcing Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复同组件路由切换时的工作流修订回显，并让创建/修订工作流按关键词或图片种子自动排队真实 1688 寻源，同时在结果页显示匹配上下文和真实执行状态。

**Architecture:** 前端用响应式页面模式监听器处理列表、新建、修订三种状态，避免依赖一次性的挂载钩子。后端在工作流事务提交后调用现有异步寻源编排，只排队数据库分页任务，网络调用继续由 Worker 执行。寻源摘要返回经过所有者隔离的工作流输入上下文，前端只展示持久化结果，不引入模拟数据。

**Tech Stack:** Vue 3、Vue Router、Pinia、Vitest、NestJS、TypeORM、PostgreSQL、Jest、Axios、1688 Param2。

## Global Constraints

- 只修改工作流回显、工作流到 1688 寻源排队、字段映射可见性和相关测试。
- 关键词检索必须使用显式 `seedType=keyword` 与 `seedValue.trim()`；图片检索必须先取得 `imageId` 再搜索。
- 工作流创建 HTTP 请求不得等待 1688 网络调用。
- 1688 失败不得阻断工作流保存，也不得返回模拟商品。
- 1688 数据不得进入客户联系方式、`contactScore` 或客户综合评分。
- 所有工作流和寻源查询继续使用 `ownerUserId + workflowRunId` 隔离。
- 不输出或提交 AppSecret、AccessToken、签名、图片 Base64 和未脱敏原始响应。
- 中文方法注释说明需求、关键分支和异步边界；不做无关重构。

---

### Task 1: 修复路由复用下的修订表单回显

**Files:**
- Modify: `frontend/src/views/autoflow/WorkflowsView.vue:1-130`
- Test: `frontend/src/tests/workflow-revision-view.test.ts`

**Interfaces:**
- Consumes: `props.create?: boolean`、`props.reviseId?: string`、`store.getWorkflow(id)`、`store.fetchWorkflows()`。
- Produces: `viewMode` 与响应式页面初始化逻辑；进入修订页调用 `loadRevisionSource(id)`，进入新建页执行 `resetWorkflowForm()`，进入列表页刷新列表。

- [ ] **Step 1: 写路由复用失败测试**

在测试中先以 `{ create: true }` 挂载新建页，再执行：

```ts
await wrapper.setProps({ create: true, reviseId: workflowFixture.id })
await flushPromises()

expect(storeMock.getWorkflow).toHaveBeenCalledWith(workflowFixture.id)
expect(wrapper.get<HTMLInputElement>('input[placeholder="workflows.namePlaceholder"]').element.value)
  .toBe(workflowFixture.name)
```

另加从修订页切回 `{ create: true, reviseId: undefined }` 后名称、种子值和市场恢复默认值的断言。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd run test --workspace=frontend -- --run src/tests/workflow-revision-view.test.ts`

Expected: 新增路由切换测试失败，`store.getWorkflow` 未调用或表单仍为空。

- [ ] **Step 3: 实现响应式页面模式初始化**

在 `WorkflowsView.vue` 中定义：

```ts
const viewMode = computed(() => props.reviseId
  ? `revise:${props.reviseId}`
  : props.create ? 'create' : 'list')

watch(viewMode, async (mode) => {
  if (mode.startsWith('revise:') && props.reviseId) {
    await loadRevisionSource(props.reviseId)
    return
  }
  resetWorkflowForm()
  if (mode === 'list') await store.fetchWorkflows()
}, { immediate: true })
```

`loadRevisionSource` 使用递增请求序号，只允许最新请求回填；`resetWorkflowForm` 清空修订来源、图片预览/元数据、两个种子缓存，并恢复默认市场和 Google 选项。移除只负责这些初始化动作的 `onMounted`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd run test --workspace=frontend -- --run src/tests/workflow-revision-view.test.ts`

Expected: 所有修订表单测试通过。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/views/autoflow/WorkflowsView.vue frontend/src/tests/workflow-revision-view.test.ts
git commit -m "fix: reload workflow revision on route changes"
```

### Task 2: 工作流保存后自动排队 1688 寻源

**Files:**
- Modify: `backend/src/modules/autoflow/autoflow.module.ts`
- Modify: `backend/src/modules/autoflow/autoflow.controller.ts:41-86`
- Create: `backend/src/modules/autoflow/autoflow.controller.spec.ts`

**Interfaces:**
- Consumes: `SourcingService.runForWorkflow(ownerUserId: string, workflowRunId: string): Promise<void>`。
- Produces: `createWorkflow` 和 `createWorkflowRevision` 在工作流持久化完成后排队寻源并返回原工作流响应。

- [ ] **Step 1: 写控制器失败测试**

创建控制器测试，使用最小 mock：

```ts
const workflow = { id: 'workflow-1' }
autoflowService.createWorkflow.mockResolvedValue(workflow)

await expect(controller.createWorkflow(request, body)).resolves.toBe(workflow)
expect(sourcingService.runForWorkflow).toHaveBeenCalledWith('owner-1', 'workflow-1')
```

对 `createWorkflowRevision` 做同样断言，并验证先保存、后排队。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd run test --workspace=backend -- --runInBand src/modules/autoflow/autoflow.controller.spec.ts`

Expected: 控制器构造参数或 `runForWorkflow` 调用断言失败。

- [ ] **Step 3: 实现保存后排队**

`AutoflowModule` 直接导入 `SourcingModule`，`AutoflowController` 注入 `SourcingService`。将两个保存方法改为 `async`：

```ts
const workflow = await this.autoflowService.createWorkflow(request.user!.userId, body)
await this.sourcingService.runForWorkflow(request.user!.userId, workflow.id)
return workflow
```

修订接口使用相同顺序。`runForWorkflow` 已捕获未配置或排队错误，因此工作流保存结果不会被 1688 配置阻断。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd run test --workspace=backend -- --runInBand src/modules/autoflow/autoflow.controller.spec.ts`

Expected: 控制器测试通过。

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/autoflow/autoflow.module.ts backend/src/modules/autoflow/autoflow.controller.ts backend/src/modules/autoflow/autoflow.controller.spec.ts
git commit -m "feat: queue 1688 sourcing when workflows are saved"
```

### Task 3: 固化关键词与图片字段映射测试

**Files:**
- Modify: `backend/src/modules/sourcing/sourcing.service.spec.ts`
- Modify: `backend/src/modules/sourcing/sourcing.service.ts:135-238`

**Interfaces:**
- Consumes: `WorkflowRunEntity.seedType`、`seedValue`、`name`、`targetMarket`。
- Produces: `SourcingSearchEntity` 中互斥的 `keyword` / `imageUrl`、正确 `providerMethod`，以及只用于追踪的 `workflowName` / `targetMarket` 请求上下文。

- [ ] **Step 1: 扩充失败测试**

关键词断言：

```ts
expect(searches.save).toHaveBeenCalledWith(expect.objectContaining({
  searchMode: 'keyword',
  providerMethod: 'product.search.keywordQuery',
  keyword: 'pet brush',
  imageUrl: null,
  requestPayload: expect.objectContaining({
    workflowName: 'Pet brush prospecting',
    targetMarket: 'United States',
  }),
}))
```

图片测试将工作流改为 `seedType: 'image'` 和公开 URL，断言 `keyword: null`、`imageUrl` 原样保存、方法为 `product.search.imageQuery`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd run test --workspace=backend -- --runInBand src/modules/sourcing/sourcing.service.spec.ts`

Expected: 新增上下文字段断言失败。

- [ ] **Step 3: 实现最小映射补充**

创建搜索记录时保持现有显式类型分支，只在 `requestPayload` 增加：

```ts
workflowName: workflow.name,
targetMarket: workflow.targetMarket,
```

不把 Google 高级搜索配置传入 1688 请求。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd run test --workspace=backend -- --runInBand src/modules/sourcing/sourcing.service.spec.ts src/modules/sourcing/sourcing-page-executor.service.spec.ts`

Expected: 关键词、图片上传、`imageId` 复用和分页映射测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/sourcing/sourcing.service.ts backend/src/modules/sourcing/sourcing.service.spec.ts
git commit -m "test: lock workflow seed sourcing mappings"
```

### Task 4: 在寻源摘要和页面回显匹配上下文

**Files:**
- Modify: `backend/src/modules/sourcing/sourcing-response.types.ts`
- Modify: `backend/src/modules/sourcing/sourcing.service.ts:50-132`
- Modify: `backend/src/modules/sourcing/sourcing.service.spec.ts`
- Modify: `frontend/src/api/autoflow.ts:270-330`
- Modify: `frontend/src/views/autoflow/SourcingView.vue`
- Modify: `frontend/src/tests/sourcing-view.test.ts`
- Modify: `frontend/src/i18n/index.ts`

**Interfaces:**
- Produces backend response field:

```ts
workflowInput: {
  name: string
  seedType: 'keyword' | 'image'
  seedValue: string
  targetMarket: string
}
```

- Frontend consumes `summary.workflowInput` and `summary.latestSearch`。

- [ ] **Step 1: 写后端摘要失败测试**

调用 `getSummary` 后断言：

```ts
expect(result.workflowInput).toEqual({
  name: 'Pet brush prospecting',
  seedType: 'keyword',
  seedValue: 'pet brush',
  targetMarket: 'United States',
})
```

同时验证 `requireWorkflow` 的所有者过滤仍存在。

- [ ] **Step 2: 写前端失败测试**

给 `completedSummary` 和 idle 摘要添加 `workflowInput`，断言页面包含工作流名称、`sourcing.matchType_keyword`、种子值和目标市场。idle 摘要断言按钮文本为 `sourcing.startAction`，已有搜索时为 `sourcing.restartAction`。

- [ ] **Step 3: 运行新增测试确认失败**

Run:

```text
npm.cmd run test --workspace=backend -- --runInBand src/modules/sourcing/sourcing.service.spec.ts
npm.cmd run test --workspace=frontend -- --run src/tests/sourcing-view.test.ts
```

Expected: `workflowInput` 和 `startAction` 相关断言失败。

- [ ] **Step 4: 实现后端上下文响应**

`getSummary` 保留 `requireWorkflow` 返回值，并在有无搜索两种响应中都返回 `workflowInput`。只返回当前所有者可访问工作流的已有字段，不返回图片文件系统路径或凭证。

- [ ] **Step 5: 实现前端上下文展示**

扩展 TypeScript 类型和中英文文案。在结果卡片头部下方添加紧凑的匹配上下文区域；图片 URL 使用可换行文本，不作为自动加载的新图片。按钮文本使用：

```vue
{{ starting || running
  ? t('sourcing.runningAction')
  : search ? t('sourcing.restartAction') : t('sourcing.startAction') }}
```

- [ ] **Step 6: 运行新增测试确认通过**

Run:

```text
npm.cmd run test --workspace=backend -- --runInBand src/modules/sourcing/sourcing.service.spec.ts
npm.cmd run test --workspace=frontend -- --run src/tests/sourcing-view.test.ts
```

Expected: 两组测试全部通过。

- [ ] **Step 7: 提交**

```bash
git add backend/src/modules/sourcing frontend/src/api/autoflow.ts frontend/src/views/autoflow/SourcingView.vue frontend/src/tests/sourcing-view.test.ts frontend/src/i18n/index.ts
git commit -m "feat: show workflow input in 1688 sourcing"
```

### Task 5: 全量验证、真实寻源自测与合并

**Files:**
- Verify only; no planned production edits.

**Interfaces:**
- Consumes: 本地 `backend/.env.alibaba1688.local`，不得输出密钥值。
- Produces: 测试、构建、运行态数据库和 UI 证据。

- [ ] **Step 1: 运行格式与差异检查**

Run: `git diff --check && npm.cmd run lint`

Expected: 退出码 0，无 lint error。

- [ ] **Step 2: 运行全量测试**

Run: `npm.cmd run test`

Expected: 前端和后端测试全部通过，0 failed。

- [ ] **Step 3: 运行构建**

Run: `npm.cmd run build`

Expected: Vue TypeScript、Vite、NestJS 和前端打包全部退出码 0。

- [ ] **Step 4: 对真实工作流执行关键词寻源**

通过 Nest 应用上下文对当前用户已有关键词工作流调用：

```ts
await sourcingService.startSearch(ownerUserId, workflowRunId, {
  force: true,
  pageSize: 10,
})
```

轮询第一页，直到 `pagination.status` 为 `succeeded` 或明确失败。输出只包含搜索 ID、状态、总记录数、总页数、商品数、供应商数和提供方错误码，不输出凭证与原始响应。

- [ ] **Step 5: 核对数据库与页面**

只读查询确认该搜索存在真实 `sourcing_offers` 和 `sourcing_suppliers`；重新加载寻源页，确认上下文、商品卡片、分页和控制台错误状态。

- [ ] **Step 6: 执行完成前验证并提交剩余改动**

运行 `superpowers:verification-before-completion` 要求的最新命令；如果工作区还有计划内改动，提交：

```bash
git add -A
git commit -m "fix: complete workflow 1688 sourcing flow"
```

- [ ] **Step 7: 自动合并到 `dev_01`**

在主工作区确认 `dev_01` 干净，执行 `git pull --ff-only`，再用 `git merge --ff-only <feature-branch>`。对合并结果重新运行前后端测试，随后删除本次功能分支和工作树。除非用户另行要求，不推送远端。
