# 1688 Pagination, Deduplication, and Supplier Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 稳定单次 1688 搜索的分页总数，准确过滤同搜索内重复商品，为当前页全部商品补充供应商名称，并在未缓存分页加载期间显示正确寻源状态。

**Architecture:** `SourcingPageExecutorService` 继续作为分页搜索、详情补充和事务持久化边界；新增一个小型有限并发工具完成全页详情请求，并以搜索第一页建立分页快照。商品实体增加搜索内商品指纹用于补充去重。前端只增加分页切换状态，不改变寻源接口路径或工作流创建流程。

**Tech Stack:** NestJS 11、TypeORM 0.3、PostgreSQL、Jest、Vue 3、TypeScript、Vitest、1688 Param2 API。

## Global Constraints

- 当前页所有有效商品都查询详情并尽量显示供应商名称。
- 商品详情请求最大并发数固定为 5，不允许无界并发。
- 单个商品详情失败不能使整页失败。
- 分页总数以每次新搜索第一页为快照，历史搜索不修改。
- 不同供应商的相似商品必须保留；同一供应商的不同商品必须保留。
- 不新增供应商店铺地址、评分等页面功能，不修改客户联系信息或客户评分。
- 所有新增方法和关键分支添加 UTF-8 中文注释，不输出 1688 凭证或未脱敏响应。

---

### Task 1: 锁定分页快照与全页详情请求行为

**Files:**
- Modify: `backend/src/modules/sourcing/sourcing-page-executor.service.spec.ts`
- Modify: `backend/src/modules/sourcing/sourcing-page-executor.service.ts`

**Interfaces:**
- Consumes: `Alibaba1688Service.getProductDetail({ offerId, country })`。
- Produces: `mapWithConcurrency<T, R>(items, limit, mapper): Promise<PromiseSettledResult<R>[]>` 私有方法；当前页全部有效商品详情结果；第一页稳定分页快照。

- [ ] **Step 1: 写失败测试**

增加三个行为测试：6 个商品全部调用详情；最多 5 个详情请求同时执行；第 2 页返回新总数时仍保存已有总数和页数。并使用 6 个具备完整字段的固定 offer/detail fixture，使断言独立于生产映射实现。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd test --workspace=backend -- sourcing-page-executor.service.spec.ts --runInBand`

Expected: 全量详情调用次数和分页快照断言失败，证明旧代码仍只查询前 5 个并覆盖总数。

- [ ] **Step 3: 实现最小后端修改**

将搜索结果裁剪到 `page.pageSize` 后交给有限并发方法：

```ts
const offers = result.normalized.offers.slice(0, page.pageSize)
const detailResults = await this.mapWithConcurrency(
  offers,
  5,
  (offer) => this.alibaba1688Service.getProductDetail({
    offerId: offer.offerId!,
    country: search.languageCode,
  }),
)
```

所有成功结果标记 `succeeded`，失败标记 `failed`。详情响应单独保留为 `supplierDetail`；只有前 5 个同时作为现有产品增强 `detail`，第 6 个以后只读取供应商身份和公司名称。持久化分页总数时，仅第一页或原值为空时写入；后续差异日志包含旧值和新值。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd test --workspace=backend -- sourcing-page-executor.service.spec.ts --runInBand`

Expected: 新增和原有执行器测试全部通过。

### Task 2: 增加商品指纹补充去重

**Files:**
- Create: `backend/src/database/migrations/1784729000000-AddSourcingOfferProductFingerprint.ts`
- Modify: `backend/src/modules/sourcing/entities/sourcing-offer.entity.ts`
- Modify: `backend/src/modules/sourcing/entities/sourcing.entities.spec.ts`
- Modify: `backend/src/modules/sourcing/sourcing-page-executor.service.spec.ts`
- Modify: `backend/src/modules/sourcing/sourcing-page-executor.service.ts`

**Interfaces:**
- Produces: `SourcingOfferEntity.productFingerprint: string | null`；`buildProductFingerprint(...)` 私有方法。
- Database constraint: 同一 `search_id + provider + product_fingerprint` 的非空指纹唯一。

- [ ] **Step 1: 写实体、迁移和执行器失败测试**

断言实体包含 `productFingerprint`，迁移创建并可撤销字段和部分唯一索引；执行器对同供应商同核心信息只保存首次结果，对不同供应商的相同商品信息保存两条。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd test --workspace=backend -- sourcing.entities.spec.ts sourcing-page-executor.service.spec.ts --runInBand`

Expected: 缺少实体字段、迁移和指纹去重行为而失败。

- [ ] **Step 3: 实现实体、迁移和指纹**

指纹输入使用稳定供应商身份、标准化标题、去查询参数的主图 URL、分类、价格范围和 MOQ；任何关键输入不足时返回 `null`。使用 SHA-256 生成固定 64 字符值。持久化前除 `offerId` 查询外再查询非空指纹，重复时跳过。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd test --workspace=backend -- sourcing.entities.spec.ts sourcing-page-executor.service.spec.ts --runInBand`

Expected: 实体、迁移、去重及执行器测试全部通过。

### Task 3: 修复未缓存分页加载状态

**Files:**
- Modify: `frontend/src/tests/sourcing-view.test.ts`
- Modify: `frontend/src/views/autoflow/SourcingView.vue`

**Interfaces:**
- Produces: `pageChanging: Ref<boolean>`；`pageBusy: ComputedRef<boolean>`。

- [ ] **Step 1: 写前端失败测试**

构造未结束的分页请求，点击下一页后断言立即显示 `[data-test="sourcing-running"]`、隐藏 `[data-test="sourcing-empty"]`，并禁用分页按钮；解析为成功摘要后断言商品恢复展示。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd test --workspace=frontend -- sourcing-view.test.ts`

Expected: 旧页面在整体搜索已完成时显示空状态，或分页按钮未禁用。

- [ ] **Step 3: 实现最小加载态**

在 `changePage` 请求前设置 `pageChanging=true`。展示条件改用 `pageBusy && !offers.length`，其中 `pageBusy` 同时包含本地切换状态和当前分页 `pending/running`。仅当摘要已经进入分页 `pending/running` 后解除本地切换状态；分页成功或失败后由摘要状态结束加载。加载期间禁用分页控件。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm.cmd test --workspace=frontend -- sourcing-view.test.ts`

Expected: 前端寻源页面测试全部通过。

### Task 4: 全量验证并合并到 dev_01

**Files:**
- Verify all changed files; no unrelated production edits.

**Interfaces:**
- Produces: 可合并的、经过测试和构建验证的功能分支。

- [ ] **Step 1: 运行差异与相关测试**

Run:

```text
git diff --check
npm.cmd test --workspace=backend -- sourcing-page-executor.service.spec.ts sourcing.entities.spec.ts --runInBand
npm.cmd test --workspace=frontend -- sourcing-view.test.ts
```

Expected: 退出码均为 0。

- [ ] **Step 2: 运行 lint 和构建**

Run:

```text
npm.cmd run lint
npm.cmd run build
```

Expected: 退出码均为 0。

- [ ] **Step 3: 检查变更范围并提交**

只提交本计划列出的文件，提交信息使用：

```text
fix: stabilize 1688 sourcing pagination and suppliers
```

- [ ] **Step 4: 合并到 dev_01 并复验**

确认主工作区 `dev_01` 无用户新增改动后执行 fast-forward 合并。合并后重新运行相关后端和前端测试；除非用户另行要求，不推送远端。
