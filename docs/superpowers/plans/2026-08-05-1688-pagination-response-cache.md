# 1688 Pagination Response Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 1688 寻源增加 6 小时分页结果复用和 24 小时供应商名称复用，减少后续翻页等待时间及重复接口调用。

**Architecture:** 保留现有异步分页 Worker 和按搜索持久化模型。`SourcingService` 在创建未加载分页前调用独立分页缓存服务，将近期同条件成功页的规范化数据复制到当前搜索；缓存未命中才创建 Worker 任务。`SourcingPageExecutorService` 在真实分页搜索后批量查询历史供应商名称，仅对前 5 条商品增强或名称仍缺失的商品调用详情接口。

**Tech Stack:** NestJS 11、TypeORM 0.3、PostgreSQL、Jest、Vue 3、TypeScript、Vitest、1688 Param2 API。

## Global Constraints

- 分页结果缓存固定 6 小时，供应商名称缓存固定 24 小时。
- 缓存必须显式按 `ownerUserId` 隔离，不允许跨用户复用。
- “重新寻源”创建新搜索并真实查询第 1 页；第 2 页以后允许命中 6 小时分页缓存。
- 不预取全部页或下一页，不引入 Redis，不改变 HTTP 接口路径和前端商品卡片字段。
- 图片寻源继续使用上传字节后返回的 `imageId`，不得把图片 URL 直接传给 1688 图片搜索。
- 第 1 页确定的总条数和总页数保持稳定，缓存页不覆盖它们。
- 前 5 条商品保持现有详情增强；第 6 条以后只为缺失的供应商名称请求详情。
- 商品详情最大并发数固定为 5；单条详情失败不得导致整页失败。
- 缓存只复制规范化业务字段，`rawSnapshot` 不复制第三方原始响应或凭据。
- 新增方法和关键分支使用 UTF-8 中文注释；数据库查询必须批量执行并具备索引，不引入 N+1。

---

### Task 1: 增加缓存元数据和稳定缓存指纹

**Files:**
- Create: `backend/src/database/migrations/1784730000000-AddSourcingResponseCacheMetadata.ts`
- Modify: `backend/src/modules/sourcing/entities/sourcing-search.entity.ts`
- Modify: `backend/src/modules/sourcing/entities/sourcing-search-page.entity.ts`
- Modify: `backend/src/modules/sourcing/entities/sourcing-offer.entity.ts`
- Modify: `backend/src/modules/sourcing/entities/sourcing-supplier.entity.ts`
- Modify: `backend/src/modules/sourcing/entities/sourcing.entities.spec.ts`
- Modify: `backend/src/modules/sourcing/sourcing.service.ts`
- Modify: `backend/src/modules/sourcing/sourcing.service.spec.ts`

**Interfaces:**
- Produces: `SourcingSearchEntity.cacheFingerprint: string | null`。
- Produces: `SourcingSearchPageEntity.cacheHit: boolean` 和 `cacheSourcePageId: string | null`。
- Produces: `buildCacheFingerprint(ownerUserId, workflow, options, languageCode): string` 私有方法。
- Database indexes: 搜索缓存候选、分页完成时间、近期 offerId、近期 supplier openId 批量查询索引。

- [ ] **Step 1: 写实体、迁移和搜索创建失败测试**

在 `sourcing.entities.spec.ts` 中断言新字段和迁移 SQL：

```ts
const searchColumns = storage.columns
  .filter((metadata) => metadata.target === SourcingSearchEntity)
  .map((metadata) => metadata.propertyName)
const pageColumns = storage.columns
  .filter((metadata) => metadata.target === SourcingSearchPageEntity)
  .map((metadata) => metadata.propertyName)
expect(searchColumns).toContain('cacheFingerprint')
expect(pageColumns).toEqual(expect.arrayContaining(['cacheHit', 'cacheSourcePageId']))
expect(upSql).toContain('ADD COLUMN "cache_fingerprint" varchar(64)')
expect(upSql).toContain('ADD COLUMN "cache_hit" boolean NOT NULL DEFAULT false')
expect(upSql).toContain('ADD COLUMN "cache_source_page_id" uuid')
expect(upSql).toContain('idx_sourcing_searches_cache_lookup')
expect(downSql).toContain('DROP COLUMN IF EXISTS "cache_fingerprint"')
```

在 `sourcing.service.spec.ts` 的创建搜索测试中增加：

```ts
expect(searches.save).toHaveBeenCalledWith(expect.objectContaining({
  queryFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
  cacheFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
  requestPayload: expect.objectContaining({ forceRefresh: false }),
}))
```

强制重新寻源测试断言 `requestPayload.forceRefresh === true`。再构造两个不同 `workflowRunId`、但用户、模式、seed、目标市场、页大小和价格筛选相同的工作流，断言 `queryFingerprint` 不同而 `cacheFingerprint` 相同。

- [ ] **Step 2: 运行测试确认失败**

Run:

```text
npm.cmd test --workspace=backend -- sourcing.entities.spec.ts sourcing.service.spec.ts --runInBand
```

Expected: 因实体字段、迁移类和 `cacheFingerprint` 尚不存在而失败。

- [ ] **Step 3: 实现迁移、实体和缓存指纹**

实体字段使用以下定义：

```ts
// SourcingSearchEntity
@Column({ name: 'cache_fingerprint', type: 'varchar', length: 64, nullable: true })
cacheFingerprint: string | null

// SourcingSearchPageEntity
@Column({ name: 'cache_hit', type: 'boolean', default: false })
cacheHit: boolean

@Column({ name: 'cache_source_page_id', type: 'uuid', nullable: true })
cacheSourcePageId: string | null
```

迁移必须添加上述字段，并建立：

```sql
CREATE INDEX "idx_sourcing_searches_cache_lookup"
ON "sourcing_searches" ("owner_user_id", "provider", "cache_fingerprint", "created_at" DESC)
WHERE "cache_fingerprint" IS NOT NULL;

CREATE INDEX "idx_sourcing_pages_cache_lookup"
ON "sourcing_search_pages" ("page_number", "page_size", "status", "completed_at" DESC);

CREATE INDEX "idx_sourcing_offers_owner_provider_offer_recent"
ON "sourcing_offers" ("owner_user_id", "provider", "offer_id", "retrieved_at" DESC);

CREATE INDEX "idx_sourcing_suppliers_owner_provider_open_recent"
ON "sourcing_suppliers" ("owner_user_id", "provider", "open_id", "updated_at" DESC)
WHERE "open_id" IS NOT NULL;
```

缓存指纹不得包含 `workflowRunId`，实现为：

```ts
private buildCacheFingerprint(
  ownerUserId: string,
  workflow: WorkflowRunEntity,
  options: StartSourcingDto,
  languageCode: string,
): string {
  return createHash('sha256').update(JSON.stringify({
    ownerUserId,
    provider: SOURCING_PROVIDER,
    searchMode: workflow.seedType,
    seed: workflow.seedValue.trim().toLocaleLowerCase(),
    targetMarket: workflow.targetMarket,
    languageCode,
    pageSize: options.pageSize || 20,
    priceMin: options.priceMin || null,
    priceMax: options.priceMax || null,
  })).digest('hex')
}
```

`startSearch` 保存 `cacheFingerprint`，并在 `requestPayload` 中保存 `forceRefresh: options.force === true`。保留现有 `queryFingerprint` 实现和当前工作流搜索复用条件。

- [ ] **Step 4: 运行测试确认通过**

Run:

```text
npm.cmd test --workspace=backend -- sourcing.entities.spec.ts sourcing.service.spec.ts --runInBand
```

Expected: 新旧实体、迁移和搜索服务测试全部通过。

- [ ] **Step 5: 提交缓存元数据**

```text
git add backend/src/database/migrations/1784730000000-AddSourcingResponseCacheMetadata.ts backend/src/modules/sourcing/entities backend/src/modules/sourcing/sourcing.service.ts backend/src/modules/sourcing/sourcing.service.spec.ts
git commit -m "feat: add 1688 sourcing cache metadata"
```

### Task 2: 复用 6 小时内的成功分页

**Files:**
- Create: `backend/src/modules/sourcing/sourcing-page-cache.service.ts`
- Create: `backend/src/modules/sourcing/sourcing-page-cache.service.spec.ts`
- Modify: `backend/src/modules/sourcing/sourcing.module.ts`
- Modify: `backend/src/modules/sourcing/sourcing.service.ts`
- Modify: `backend/src/modules/sourcing/sourcing.service.spec.ts`

**Interfaces:**
- Consumes: `SourcingSearchEntity.cacheFingerprint`、现有 supplier/offer 规范化实体和商品指纹唯一索引。
- Produces: `SourcingPageCacheService.restore(ownerUserId, search, pageNumber): Promise<SourcingSearchPageEntity | null>`。
- Produces: 缓存命中时已完成的当前搜索分页；未命中返回 `null`，由调用方继续创建 `pending` 分页。

- [ ] **Step 1: 写分页缓存服务失败测试**

在新测试中使用仓储和事务 mock 覆盖：

```ts
it('copies a recent tenant-scoped page without mutating its source', async () => {
  sourcePage.completedAt = new Date(Date.now() - 60 * 60 * 1000)
  sourcePage.status = 'succeeded'
  sourceSearch.cacheFingerprint = currentSearch.cacheFingerprint

  await expect(cache.restore(ownerUserId, currentSearch, 2))
    .resolves.toMatchObject({
      searchId: currentSearch.id,
      pageNumber: 2,
      status: 'succeeded',
      cacheHit: true,
      cacheSourcePageId: sourcePage.id,
    })
  expect(savedOffers).toHaveLength(2)
  expect(savedOffers[0].rawSnapshot).toEqual({
    cacheSourcePageId: sourcePage.id,
    cacheSourceOfferId: sourceOffers[0].id,
  })
  expect(sourceOfferRepository.save).not.toHaveBeenCalledWith(sourceOffers[0])
})
```

分别断言过期 6 小时、其他用户、指纹不同、页大小不同、来源状态不是 `succeeded`、来源商品存在空供应商名称时返回 `null`。增加去重测试：来源页与当前搜索已有 `offerId` 或非空 `productFingerprint` 重复时只复制一次，并以实际复制数量写入 `resultCount`。

- [ ] **Step 2: 运行缓存服务测试确认失败**

Run:

```text
npm.cmd test --workspace=backend -- sourcing-page-cache.service.spec.ts --runInBand
```

Expected: 因 `SourcingPageCacheService` 不存在而失败。

- [ ] **Step 3: 实现分页缓存服务**

公开接口固定为：

```ts
const SOURCING_PAGE_CACHE_TTL_MS = 6 * 60 * 60 * 1000

async restore(
  ownerUserId: string,
  currentSearch: SourcingSearchEntity,
  pageNumber: number,
): Promise<SourcingSearchPageEntity | null>
```

实现必须先以 `ownerUserId + provider + cacheFingerprint + pageNumber + pageSize + succeeded + completedAt >= cutoff` 查询最新来源页，再一次性加载该页 offers 及 supplier 关系。任一来源商品没有 `companyName` 和 `shopName` 时视为缓存不完整并返回 `null`。

命中后在单一事务中：

1. 批量读取当前搜索已经存在的 `offerId`、非空 `productFingerprint` 和 `supplierKey`。
2. 按 `supplierKey` 复用或批量创建目标 supplier；仅复制 `memberId`、`openId`、名称、店铺 URL、评分、年限和 capabilities 等规范化字段。
3. 按 rank 顺序批量创建非重复 offer；复制业务展示、价格、销量、评分、标签和详情状态字段，但将 `rawSnapshot` 改为内部缓存来源标识。
4. 创建 `status='succeeded'`、`cacheHit=true` 的目标 page，并以实际 offer 数写入 `resultCount`。
5. 统计当前搜索成功/失败页，更新 `loadedPageCount` 和 `status`，但不得修改 `totalRecords`、`totalPages` 和来源搜索。

所有读取必须包含 `ownerUserId`。捕获缓存查询或复制异常后记录脱敏 warn 并返回 `null`，让调用方走真实分页路径。

- [ ] **Step 4: 把缓存恢复接入分页请求**

在 `sourcing.module.ts` 注册 `SourcingPageCacheService`，并注入 `SourcingService`。`requestPage` 在确认目标页不存在后执行：

```ts
const cachedPage = await this.pageCache.restore(ownerUserId, search, pageNumber)
if (cachedPage) {
  return {
    searchId,
    status: 'succeeded',
    page: pageNumber,
    pageSize: search.pageSize as 10 | 20 | 50,
  }
}
```

未命中才保留现有 `pending` page 创建逻辑。第 1 页始终由 `startSearch` 创建任务，因此重新寻源不会使用分页缓存。缓存恢复返回 `null` 后再次读取目标页；保存 pending 页遇到唯一约束冲突时读取并返回已经由并发请求创建的页，避免重复点击产生 500。

在 `sourcing.service.spec.ts` 注入缓存 mock，新增“缓存命中不保存 pending 页”和“缓存未命中继续保存 pending 页”测试。

- [ ] **Step 5: 运行分页缓存与服务测试确认通过**

Run:

```text
npm.cmd test --workspace=backend -- sourcing-page-cache.service.spec.ts sourcing.service.spec.ts --runInBand
```

Expected: 缓存服务和分页请求测试全部通过。

- [ ] **Step 6: 提交分页复用功能**

```text
git add backend/src/modules/sourcing/sourcing-page-cache.service.ts backend/src/modules/sourcing/sourcing-page-cache.service.spec.ts backend/src/modules/sourcing/sourcing.module.ts backend/src/modules/sourcing/sourcing.service.ts backend/src/modules/sourcing/sourcing.service.spec.ts
git commit -m "feat: reuse recent 1688 sourcing pages"
```

### Task 3: 批量复用 24 小时供应商名称

**Files:**
- Create: `backend/src/modules/sourcing/sourcing-supplier-name-cache.service.ts`
- Create: `backend/src/modules/sourcing/sourcing-supplier-name-cache.service.spec.ts`
- Modify: `backend/src/modules/alibaba1688/index.ts`
- Modify: `backend/src/modules/sourcing/sourcing.module.ts`
- Modify: `backend/src/modules/sourcing/sourcing-page-executor.service.ts`
- Modify: `backend/src/modules/sourcing/sourcing-page-executor.service.spec.ts`

**Interfaces:**
- Exports: `Alibaba1688StableSeller` from `modules/alibaba1688/index.ts`。
- Produces: `CachedSupplierIdentity { openId: string | null; companyName: string; shopUrl: string | null }`。
- Produces: `SourcingSupplierNameCacheService.findRecent(ownerUserId, offers): Promise<Map<string, CachedSupplierIdentity>>`，Map 同时支持 `offer:<offerId>` 和 `open:<openId>` 键。

- [ ] **Step 1: 写供应商缓存和详情调用失败测试**

供应商缓存服务测试使用 24 小时边界：

```ts
it('returns only recent names owned by the current user', async () => {
  const result = await cache.findRecent(ownerUserId, [stableOffer(6)])
  expect(result.get('offer:offer-6')).toEqual({
    openId: 'supplier-6',
    companyName: 'Cached Supplier',
    shopUrl: null,
  })
  expect(offerRepository.find).toHaveBeenCalledWith(expect.objectContaining({
    relations: { supplier: true },
  }))
})
```

断言 24 小时前、其他用户和空名称记录不进入 Map，并断言 offerId/openId 使用一次批量查询而不是逐商品调用。

执行器测试将现有 6 条 fixture 扩展为：

- 第 6 条搜索响应已有名称时，`getProductDetail` 只调用前 5 次。
- 第 6 条搜索响应无名称但 24 小时缓存命中时，仍只调用前 5 次，保存缓存名称。
- 第 6 条缓存未命中时调用第 6 次详情。
- 前 5 条仍使用详情增强标题，第 6 条只补名称且保留搜索标题。

- [ ] **Step 2: 运行测试确认失败**

Run:

```text
npm.cmd test --workspace=backend -- sourcing-supplier-name-cache.service.spec.ts sourcing-page-executor.service.spec.ts --runInBand
```

Expected: 因缓存服务不存在且执行器仍为所有商品调用详情而失败。

- [ ] **Step 3: 实现供应商名称批量缓存查询**

服务使用固定 TTL：

```ts
const SUPPLIER_NAME_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface CachedSupplierIdentity {
  openId: string | null
  companyName: string
  shopUrl: string | null
}
```

`findRecent` 收集有效 offerId 和 seller.openId，分别使用 `In(...)` 与 `MoreThanOrEqual(cutoff)` 批量查询当前用户历史 offers/suppliers。按 `updatedAt/retrievedAt` 从新到旧构建 Map，已有键不得被旧记录覆盖；空白名称不写入缓存。任何数据库缓存读取异常只记录 warn 并返回空 Map，不阻断真实详情请求。

- [ ] **Step 4: 让执行器只请求必要详情**

`HydratedOffer` 增加独立的 `supplierIdentity: Alibaba1688StableSeller`。执行顺序固定为：

```ts
const cachedSuppliers = await this.supplierNameCache.findRecent(
  page.ownerUserId,
  pageOffers,
)
const detailTargets = pageOffers
  .map((offer, index) => ({ offer, index }))
  .filter(({ offer, index }) => index < 5 || !this.resolveSupplierName(offer, cachedSuppliers))
```

只对 `detailTargets` 调用现有 `settleWithConcurrency(..., 5, ...)`，再按原 index 合并结果。供应商身份优先级为“详情 seller > 当前搜索 seller > 24 小时缓存”；第 6 条以后缓存命中时 `detailStatus='not_requested'`。

商品指纹继续使用供应商、标题、主图、价格和 MOQ。为了让未请求详情的第 6 条以后仍可去重，`categoryId` 作为可选输入参与哈希但不再是返回 `null` 的必要条件；供应商身份、标题、主图、最低价和 MOQ 仍必须存在。

- [ ] **Step 5: 运行供应商缓存与执行器测试确认通过**

Run:

```text
npm.cmd test --workspace=backend -- sourcing-supplier-name-cache.service.spec.ts sourcing-page-executor.service.spec.ts --runInBand
```

Expected: 供应商名称缓存、详情调用次数、并发上限、标题边界、失败隔离和商品去重测试全部通过。

- [ ] **Step 6: 提交供应商名称复用**

```text
git add backend/src/modules/alibaba1688/index.ts backend/src/modules/sourcing/sourcing-supplier-name-cache.service.ts backend/src/modules/sourcing/sourcing-supplier-name-cache.service.spec.ts backend/src/modules/sourcing/sourcing.module.ts backend/src/modules/sourcing/sourcing-page-executor.service.ts backend/src/modules/sourcing/sourcing-page-executor.service.spec.ts
git commit -m "feat: cache 1688 supplier names"
```

### Task 4: 回归验证、迁移和合并

**Files:**
- Verify: all files listed in Tasks 1-3。
- Verify unchanged behavior: `frontend/src/views/autoflow/SourcingView.vue` and `frontend/src/tests/sourcing-view.test.ts`。

**Interfaces:**
- Produces: 可迁移、可回滚、测试和构建通过的 `dev_01` 本地提交。

- [ ] **Step 1: 运行缓存相关测试**

Run:

```text
git diff --check
npm.cmd test --workspace=backend -- sourcing.entities.spec.ts sourcing.service.spec.ts sourcing-page-cache.service.spec.ts sourcing-supplier-name-cache.service.spec.ts sourcing-page-executor.service.spec.ts --runInBand
npm.cmd test --workspace=frontend -- sourcing-view.test.ts
```

Expected: 所有命令退出码为 0；测试日志不得出现真实凭据或第三方原始响应。

- [ ] **Step 2: 运行完整测试、lint 和构建**

Run:

```text
npm.cmd run test
npm.cmd run lint
npm.cmd run build
```

Expected: 前后端完整测试、lint、Vue/Nest 构建和前端打包全部通过。

- [ ] **Step 3: 复核迁移状态并执行迁移**

Run:

```text
npm.cmd run db:migration:show
npm.cmd run db:migrate
npm.cmd run db:migration:show
```

Expected: 执行前新迁移为待执行，执行后 `AddSourcingResponseCacheMetadata1784730000000` 显示 `[X]`。迁移必须在事务内完成；不得回滚用户已有迁移。

- [ ] **Step 4: 执行差异和安全边界复核**

检查：

```text
git status --short
git diff dev_01...HEAD --stat
git diff dev_01...HEAD -- backend/src/modules/sourcing backend/src/database/migrations backend/src/modules/alibaba1688/index.ts
```

Expected: 仅包含本计划文件；所有缓存查询均有 `ownerUserId`；日志和 `rawSnapshot` 不含 AppKey、AppSecret、AccessToken、图片 Base64 或第三方原始响应。

- [ ] **Step 5: 提交遗漏的验证修正并合并**

如验证产生必要的小修正，提交：

```text
git add backend/src/database/migrations/1784730000000-AddSourcingResponseCacheMetadata.ts backend/src/modules/alibaba1688/index.ts backend/src/modules/sourcing
git commit -m "test: verify 1688 sourcing response cache"
```

确认主工作区 `dev_01` 没有用户新增未提交修改后，使用 fast-forward 合并功能分支。合并后重新运行缓存相关后端测试、前端 sourcing 页面测试及健康检查。除非用户另行要求，不推送远端。
