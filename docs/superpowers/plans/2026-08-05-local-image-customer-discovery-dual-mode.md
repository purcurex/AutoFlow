# Local Image Customer Discovery Dual Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让本机上传图片跳过需要公网 URL 的客户发现而继续1688图片寻源，并在 API 与页面明确展示“客户发现待配置”。

**Architecture:** `DiscoveryService` 返回可判别的完成/跳过结果，`WorkflowExecutionService` 在同一编排中独立启动1688寻源并把客户发现步骤标记为 `skipped`。客户发现状态从现有步骤状态计算，工作流列表和1688寻源汇总接口复用同一纯函数，不新增数据库字段。

**Tech Stack:** TypeScript 5.9、NestJS 11、TypeORM、Jest 30、Vue 3、Vitest 4、Vue I18n。

## Global Constraints

- 不新增数据库字段或迁移，不引入新依赖。
- 不把1688商品标题转换成客户搜索关键词。
- 1688图片搜索继续使用图片字节上传后返回的 `imageId`。
- 本机图片缺少公开基址时不得调用 PipiAds、Google Lens，且不得把工作流标记为失败。
- 非法或越权的 `seedAssetPath` 仍必须失败，不能降级为跳过。
- 所有新增方法、核心分支和状态映射使用 UTF-8 中文注释。

---

### Task 1: 客户发现服务返回显式跳过结果

**Files:**
- Modify: `backend/src/modules/discovery/discovery.types.ts`
- Modify: `backend/src/modules/discovery/discovery.service.ts`
- Test: `backend/src/modules/discovery/discovery.service.spec.ts`

**Interfaces:**
- Produces: `CustomerDiscoveryResult`，其 `status` 为 `completed | skipped`；跳过原因码固定为 `public_image_not_configured`。
- Consumes: `WorkflowRunEntity.seedAssetPath`、`PUBLIC_ASSET_BASE_URL`、现有 `isPublicProviderUrl()`。

- [ ] **Step 1: 写入失败测试**

将原“缺少公网基址时抛异常”测试改为以下业务断言，并增加非法资产路径用例：

```ts
const result = await service.discoverEvidence('owner-1', 'workflow-image')
expect(result).toMatchObject({
  status: 'skipped',
  reasonCode: 'public_image_not_configured',
  evidence: { workflowRunId: 'workflow-image', ads: [], stores: [], candidates: [] },
})
expect(adAdapter.discover).not.toHaveBeenCalled()
expect(storeAdapter.discover).not.toHaveBeenCalled()
```

公开基址用例断言 `status: 'completed'` 且适配器收到拼接后的公网 URL；非法 `seedAssetPath` 用例必须拒绝并且不调用适配器。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm.cmd run test --workspace=backend -- discovery.service.spec.ts --runInBand`

Expected: FAIL，现有实现仍抛出 `PUBLIC_ASSET_BASE_URL` 异常且返回值没有 `status/evidence`。

- [ ] **Step 3: 最小实现判别结果**

新增：

```ts
export type CustomerDiscoveryResult =
  | { status: 'completed'; evidence: DiscoveryEvidenceResult }
  | {
      status: 'skipped'
      reasonCode: 'public_image_not_configured'
      reason: string
      evidence: DiscoveryEvidenceResult
    }
```

`DiscoveryService` 先校验本机资产路径归属，再判断公网基址；只有公网基址缺失或不可公开访问时返回 `skipped`，其他路径继续执行现有适配器、去重、补全与持久化，并返回 `completed`。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm.cmd run test --workspace=backend -- discovery.service.spec.ts --runInBand`

Expected: PASS。

- [ ] **Step 5: 提交任务**

```bash
git add backend/src/modules/discovery/discovery.types.ts backend/src/modules/discovery/discovery.service.ts backend/src/modules/discovery/discovery.service.spec.ts
git commit -m "fix: classify local image customer discovery as skipped"
```

---

### Task 2: 工作流独立启动1688寻源并持久化跳过状态

**Files:**
- Create: `backend/src/modules/discovery/workflow-execution.service.spec.ts`
- Modify: `backend/src/modules/discovery/workflow-execution.service.ts`

**Interfaces:**
- Consumes: Task 1 的 `CustomerDiscoveryResult`。
- Produces: `workflow_steps.output.reasonCode = 'public_image_not_configured'`，主工作流最终 `completed`。

- [ ] **Step 1: 写入失败测试**

创建隔离的编排单测，模拟 `discoverEvidence()` 返回 `skipped`，断言：

```ts
await service.executeQueuedDiscovery('owner-1', 'workflow-image')
expect(sourcingService.runForWorkflow).toHaveBeenCalledWith('owner-1', 'workflow-image')
expect(stepRepository.update).toHaveBeenCalledWith(
  expect.objectContaining({
    workflowRunId: 'workflow-image',
    stage: expect.anything(),
  }),
  expect.objectContaining({
    status: 'skipped',
    output: expect.objectContaining({ reasonCode: 'public_image_not_configured' }),
  }),
)
expect(workflowRepository.update).toHaveBeenLastCalledWith(
  { id: 'workflow-image', ownerUserId: 'owner-1' },
  expect.objectContaining({ status: 'completed', progress: 100, leadCount: 0 }),
)
```

同时断言线索事务没有执行，证明未把空结果伪装成正常客户搜索。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm.cmd run test --workspace=backend -- workflow-execution.service.spec.ts --runInBand`

Expected: FAIL，现有编排不认识 `skipped` 结果且寻源调用位于客户发现之后。

- [ ] **Step 3: 最小实现双模式编排**

在读取并校验工作流后先调用 `sourcingService.runForWorkflow()`。客户发现返回 `skipped` 时，使用私有小方法一次性把 `ad_discovery`、`store_detection`、`lead_cleaning`、`lead_scoring` 更新为 `skipped`，保存原因码和原因，随后把工作流更新为 `completed/100%/0 leads` 并立即返回。

`completed` 分支继续使用 `result.evidence` 执行现有线索清洗与评分逻辑。

- [ ] **Step 4: 运行测试确认 GREEN 并回归工作队列**

Run: `npm.cmd run test --workspace=backend -- workflow-execution.service.spec.ts workflow-job-worker.service.spec.ts --runInBand`

Expected: PASS。

- [ ] **Step 5: 提交任务**

```bash
git add backend/src/modules/discovery/workflow-execution.service.ts backend/src/modules/discovery/workflow-execution.service.spec.ts
git commit -m "fix: keep local image sourcing independent from discovery"
```

---

### Task 3: API 返回可复用的客户发现状态并修正历史失败来源

**Files:**
- Create: `backend/src/modules/autoflow/customer-discovery-status.ts`
- Create: `backend/src/modules/autoflow/customer-discovery-status.spec.ts`
- Modify: `backend/src/modules/autoflow/autoflow.types.ts`
- Modify: `backend/src/modules/autoflow/autoflow.service.ts`
- Modify: `backend/src/modules/autoflow/autoflow.service.spec.ts`
- Modify: `backend/src/modules/sourcing/sourcing-response.types.ts`
- Modify: `backend/src/modules/sourcing/sourcing.service.ts`
- Modify: `backend/src/modules/sourcing/sourcing.service.spec.ts`

**Interfaces:**
- Produces: `CustomerDiscoveryStatus = 'not_started' | 'running' | 'completed' | 'pending_public_image' | 'failed'`。
- Produces: `WorkflowRun.customerDiscoveryStatus` 与 `SourcingSummaryResponse.customerDiscoveryStatus`。
- Extends: `failureProvider` 增加 `customer_discovery`。

- [ ] **Step 1: 写入状态纯函数、列表批量查询和寻源汇总失败测试**

纯函数使用手工步骤夹具断言：

```ts
expect(deriveCustomerDiscoveryStatus('completed', [{
  stage: 'ad_discovery',
  status: 'skipped',
  output: { reasonCode: 'public_image_not_configured' },
}])).toBe('pending_public_image')
```

`AutoflowService` 测试断言当前页仅调用一次 `steps.find()`，返回待配置状态；历史 `Workflow product image is only available locally...` 错误返回 `failureProvider: 'customer_discovery'`。

`SourcingService.getSummary()` 测试用带步骤关系的工作流夹具断言 `customerDiscoveryStatus: 'pending_public_image'`。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm.cmd run test --workspace=backend -- customer-discovery-status.spec.ts autoflow.service.spec.ts sourcing.service.spec.ts --runInBand`

Expected: FAIL，类型、映射函数和响应字段尚不存在。

- [ ] **Step 3: 实现状态推导与批量读取**

实现 `deriveCustomerDiscoveryStatus(workflowStatus, steps)`：优先识别带固定原因码的 `skipped`，其次识别失败、完成、运行和未开始。

`AutoflowService.getWorkflows()` 对当前页 ID 使用一次 `In([...])` 查询广告发现/店铺识别步骤，按 `workflowRunId` 分组后映射；`getWorkflow()` 同样读取当前工作流步骤。历史本机图片配置错误映射为 `customer_discovery`，PipiAds自身报错仍保持 `pipiads`。

`SourcingService.getSummary()` 读取工作流步骤关系并返回同一计算结果。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm.cmd run test --workspace=backend -- customer-discovery-status.spec.ts autoflow.service.spec.ts sourcing.service.spec.ts --runInBand`

Expected: PASS。

- [ ] **Step 5: 提交任务**

```bash
git add backend/src/modules/autoflow backend/src/modules/sourcing
git commit -m "feat: expose customer discovery execution status"
```

---

### Task 4: 前端显示双模式状态与明确失败来源

**Files:**
- Modify: `frontend/src/api/autoflow.ts`
- Modify: `frontend/src/views/autoflow/WorkflowsView.vue`
- Modify: `frontend/src/views/autoflow/SourcingView.vue`
- Modify: `frontend/src/i18n/index.ts`
- Modify: `frontend/src/tests/workflow-revision-view.test.ts`
- Modify: `frontend/src/tests/sourcing-view.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `customerDiscoveryStatus` 与 `failureProvider: 'customer_discovery'`。
- Produces: `data-test="customer-discovery-pending"` 与 `data-test="workflow-customer-discovery-pending"`。

- [ ] **Step 1: 写入失败组件测试**

工作流列表夹具使用 `status: 'completed'`、`customerDiscoveryStatus: 'pending_public_image'`，断言存在非失败提示且不存在失败详情按钮。

寻源页添加完成、运行、失败三个夹具，断言组合提示分别包含：

```ts
expect(wrapper.get('[data-test="customer-discovery-pending"]').text())
  .toContain('sourcing.customerDiscoveryPending_completed')
```

历史失败夹具断言来源使用 `workflows.failureProvider_customer_discovery`，不包含 `common.unknown`。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm.cmd run test --workspace=frontend -- src/tests/workflow-revision-view.test.ts src/tests/sourcing-view.test.ts`

Expected: FAIL，新状态字段和页面提示尚未渲染。

- [ ] **Step 3: 最小实现前端展示**

同步 API 类型；工作流名称下方增加琥珀色“客户发现待配置公网图片”提示；失败来源通过国际化函数映射。

寻源页根据真实 `sourcingStatus()` 映射 `completed/running/failed/partial/not_configured/idle` 文案，仅在 `pending_public_image` 时显示双模式提示。中英文文案同时增加。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm.cmd run test --workspace=frontend -- src/tests/workflow-revision-view.test.ts src/tests/sourcing-view.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交任务**

```bash
git add frontend/src/api/autoflow.ts frontend/src/views/autoflow/WorkflowsView.vue frontend/src/views/autoflow/SourcingView.vue frontend/src/i18n/index.ts frontend/src/tests
git commit -m "feat: display local image dual mode status"
```

---

### Task 5: 全量验证与开发分支交付

**Files:**
- Verify only; no unrelated source changes.

- [ ] **Step 1: 执行格式和静态检查**

Run: `npm.cmd run lint`

Expected: exit 0，无 ESLint error。

- [ ] **Step 2: 执行全量单元测试**

Run: `npm.cmd test`

Expected: exit 0，前后端全部测试通过。

- [ ] **Step 3: 执行后端 E2E**

Run: `npm.cmd run test:e2e`

Expected: exit 0；如本机数据库配置缺失，仅报告真实环境阻塞，不伪造通过。

- [ ] **Step 4: 执行生产构建**

Run: `npm.cmd run build`

Expected: exit 0，Vue TypeScript 与 Nest TypeScript 均编译成功。

- [ ] **Step 5: 核对范围并按已批准交付方式合并**

```bash
git status --short
git diff dev_01...HEAD --stat
git log --oneline dev_01..HEAD
```

只合并本计划相关提交；不得提交 `.planning/`、上传图片、密钥或环境文件。
