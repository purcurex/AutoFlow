# 履约工作台跟进规则 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. 用户已要求直接执行，不再增加审批停顿。

**Goal:** 以未完成业务结果划分待办，采购准备不受物流门槛限制，配货与仓库责任清晰且正常中间状态不遗漏。

**Architecture:** 保留现有九个队列、统一服务端鉴权和看板并集统计。新增采购进度只用于解释，不参与隐藏订单；仓库接收已审核配货单，前端待办仅跟进，业务操作留在 FOP。

**Tech Stack:** Vue 3 / TypeScript / NestJS / Vitest / Jest / OpenAPI 3.1。

**Spec:** 本次用户确认的三条流程、物流只限制实际推1688、配货只关注齐套与审核结果；背景见 `agent.md`、需求9.13，本次更新至9.14。

## Global Constraints

- FOP `/Library/VSCode/dtr5b` 只读核验；不改变生产业务逻辑。
- 先权限后筛选、统计、分页与导出；维持部门/业务员查询、50条默认和收款日期顺排。
- 不区分自动/人工配货，不新增自动建单失败或付款单队列。
- 物流订单号不是 Shopify 同步状态；最终推1688校验仍由 FOP 执行。

## Review Focus

- 没物流单号也能准备采购申请/采购订单，未知新字段不误判为已满足。
- 供应商发货但采购款未付仍保留采购任务，部分采购不提前退出。
- 已齐套未审核即使发运未审核仍留配货；人工释放回未齐套。
- 配货审核后进入仓库，无需以WMS单创建作额外可见门槛；部分出库保留。
- 旧warehouseStage链接不重新引入未审核数据；导出、卡片与列表一致。

### Task 1: 队列与采购事实

**Files:** `backend/src/modules/fop-data/{fop-data.service,fop-data.types,fop-demo.provider,fop-order-export}.ts`; `frontend/src/api/fop-orders.ts`; `backend/test/fop-data-access.e2e-spec.ts`; `frontend/src/tests/fopOrders.test.ts`。

**Interfaces:** ProcurementProgress新增可选purchaseApplication、alibabaOrder、logisticsGate；旧适配器归一unknown。shipping仅ready+approved+pending/partial，pending_review兼容查询为空。

- [x] 更新状态转移及权限矩阵测试并观察失败。
- [x] 同步前后端队列、字段白名单、Demo及导出；验证物流门槛不参与采购队列谓词。
- [x] 运行聚焦单元测试与FOP数据访问集成测试。

### Task 2: 简洁跟进界面

**Files:** `frontend/src/views/autoflow/{FopOrdersView,WorkbenchView,FopDashboardView}.vue`; `frontend/src/components/autoflow/ProcurementStatus.vue`; `frontend/src/utils/workbench.ts`; 对应前端测试。

**Interfaces:** 复用Task1字段；保留选择导出、刷新、复制、旺旺催办，移除清单业务审核入口和失效仓库筛选；配货页签为未齐套/已齐套未审核，默认后者。

- [x] 更新界面测试，覆盖无审核入口仍可导出、物流等待说明和旧仓库链接。
- [x] 实现文案、采购进度及只读入口调整。
- [x] 运行前端测试、lint和build，浏览器验证。

### Task 3: 交付契约与验证

**Files:** `agent.md`; `README.md`; `docs/analytics/*`; `docs/openapi/hyperzone-analytics.openapi.json`。

**Interfaces:** 更新9.14为当前规则；将原审核接口明确为保留兼容能力、不在工作台暴露；更新字段语义/待办/人工确认清单。

- [x] 核对FOP推1688、自动建配货单和齐套审核门槛源码并记录证据。
- [x] 同步需求、接口、交付清单；遵循共享HTML规范重新生成MD/HTML。
- [x] 全量测试、FOP集成测试、lint、build；审查改动及正常状态覆盖。用户本次未要求推送，保留可审阅工作区。


## 实施结果

- 已按用户直接执行；未创建额外工作树、未改FOP源码、未推送Git。
- 复核修正：alibabaOrder明确未推完属于未完成采购任务，即使付款事实unknown/not_required/paid仍保留待采购并排除待发货；logisticsGate始终仅提示。已观察回归失败后修复，更新需求9.14/OpenAPI。
- 前端328、后端519、FOP访问集成143项通过；lint/build和OpenAPI423示例通过；浏览器核对采购、配货与仓库。
- 已完成独立代码复核，发现项已修正；证据与生产待办见VERIFICATION.md及T37/H39/D40。
