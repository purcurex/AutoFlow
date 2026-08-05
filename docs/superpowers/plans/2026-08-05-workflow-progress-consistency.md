# Workflow Progress Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一搜客首页与列表的实时进度，并在客户发现待配置时显示明确状态而不是100%。

**Architecture:** Pinia `workflows` 成为最新工作流集合，列表刷新同步 dashboard 副本；页面使用纯函数生成进度文案和宽度。工作流列表根据 running 状态维护单一定时刷新器，1688寻源状态保持独立。

**Tech Stack:** Vue 3、Pinia、TypeScript、Vitest、Vue Test Utils。

## Global Constraints

- 不修改后端、数据库结构或历史数据。
- 不把1688寻源状态纳入 `workflow.progress`。
- `pending_public_image` 显示“待配置”，不显示100%。
- 运行中刷新不得产生并发重复请求，组件卸载必须停止。
- 所有新增方法和关键分支使用UTF-8中文注释。

---

### Task 1: 统一工作流状态源与进度展示模型

**Files:**
- Create: `frontend/src/utils/workflowProgress.ts`
- Create: `frontend/src/tests/workflow-progress.test.ts`
- Create: `frontend/src/tests/autoflow-store.test.ts`
- Modify: `frontend/src/stores/autoflow.ts`
- Modify: `frontend/src/views/autoflow/DashboardView.vue`
- Modify: `frontend/src/views/autoflow/WorkflowsView.vue`
- Modify: `frontend/src/i18n/index.ts`

**Interfaces:**
- Produces: `workflowProgressDisplay(workflow: Pick<WorkflowRun, 'progress' | 'customerDiscoveryStatus'>): { percent: number; labelKey: string; labelParams?: { progress: number } }`。
- Produces: `fetchWorkflows()` 更新 `workflows` 并按ID同步 `dashboard.recentWorkflows`。

- [ ] **Step 1: 编写失败测试**

纯函数断言待配置返回0宽度和 `workflows.progressPendingConfiguration`；普通完成返回100。Pinia测试模拟 dashboard 中10%的工作流、列表接口返回55%，断言刷新后两处均为55%，其他 dashboard 指标保持不变。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm.cmd run test --workspace=frontend -- src/tests/workflow-progress.test.ts src/tests/autoflow-store.test.ts`

Expected: FAIL，进度工具不存在且 store 尚未同步 dashboard。

- [ ] **Step 3: 最小实现**

实现纯函数并在两个页面统一使用其 `percent` 与国际化标签。`fetchWorkflows()` 使用列表结果替换 `workflows` 后，根据ID合并 `dashboard.recentWorkflows`，不修改 dashboard 统计字段。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm.cmd run test --workspace=frontend -- src/tests/workflow-progress.test.ts src/tests/autoflow-store.test.ts`

Expected: PASS。

---

### Task 2: 运行中工作流持续刷新

**Files:**
- Modify: `frontend/src/views/autoflow/WorkflowsView.vue`
- Modify: `frontend/src/tests/workflow-revision-view.test.ts`

**Interfaces:**
- Consumes: `store.fetchWorkflows()` 和 `store.workflows`。
- Produces: 仅在存在 running 工作流时保持的单一定时器，组件卸载时停止。

- [ ] **Step 1: 编写失败测试**

使用 fake timers：初次列表返回 running，推进一秒后断言再次刷新；随后改为 completed，再推进时间断言调用次数不再增加；卸载组件后同样不得继续刷新。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm.cmd run test --workspace=frontend -- src/tests/workflow-revision-view.test.ts`

Expected: FAIL，当前页面只在手工启动后的30秒循环内刷新。

- [ ] **Step 3: 最小实现**

用 `scheduleWorkflowRefresh()` 和 `stopWorkflowRefresh()` 管理一个一秒定时器；首次加载、手工启动和每次刷新后按 running 状态重新调度。移除60次上限循环，增加请求中的布尔锁避免并发。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm.cmd run test --workspace=frontend -- src/tests/workflow-revision-view.test.ts`

Expected: PASS。

---

### Task 3: 全量验证与提交

**Files:**
- Verify all changed files.

- [ ] **Step 1: 运行静态检查**

Run: `npm.cmd run lint`

Expected: exit 0。

- [ ] **Step 2: 运行全量测试**

Run: `npm.cmd test`

Expected: 前后端测试全部通过。

- [ ] **Step 3: 运行生产构建**

Run: `npm.cmd run build`

Expected: Vue和Nest编译成功。

- [ ] **Step 4: 核对并提交**

Run: `git diff --check`、`git status --short`。

只提交计划范围内的源码、测试和设计文档，不提交 `.planning/`、上传图片或环境文件。
