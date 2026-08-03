# PipiAds 店铺候选补全设计

## 背景

搜客工作流 `02 / 美国宠物用品开发` 已完成广告发现，数据库中存在 20 条真实 PipiAds 广告证据，但店铺数和客户线索数均为 0。20 条广告均包含 `storeDomain` 和 `landingPageUrl`，其中 17 条落地页是商品详情页。

当前 `PipiAdsAdDiscoveryAdapter` 仅将店铺信息保存在 `rawPayload` 中；`DiscoveryService` 的店铺候选只来自独立的 `StoreDiscoveryAdapter`。因此，即使广告证据带有明确店铺域名，也不会进入店铺验证和线索生成链路。

## 目标

- 将真实 PipiAds 广告中的 Shopify 店铺信息转换为标准店铺候选。
- 与现有 SerpAPI/Google 店铺结果按标准化域名合并。
- 继续使用现有店铺访问安全检查、Shopify 标志验证和线索生成流程。
- 为本次缺陷增加自动化回归测试。

## 非目标

- 不重新执行现有工作流，不调用付费外部接口。
- 不修改或回填现有数据库业务数据。
- 不改变线索评分、客户建联、报价和 FOP 逻辑。
- 不重构现有发现适配器体系。

## 方案

### 1. 标准化广告字段

在 `NormalizedAdCreative` 中增加以下字段：

- `storeDomain: string | null`
- `landingPageUrl: string | null`
- `shopType: string | null`

PipiAds 适配器从已类型化的 `PipiAdsEvidence` 显式填充这些字段。其他广告适配器没有店铺证据时填充 `null`，避免业务代码读取供应商私有 `rawPayload`。

### 2. 生成广告来源店铺候选

`DiscoveryService` 在广告和独立店铺搜索均返回后，从广告中提取店铺候选。仅满足以下条件的数据可进入候选集合：

- `evidenceSource` 为 `pipiads_api`，不接受模拟数据。
- `shopType` 忽略大小写后为 `shopify`。
- `landingPageUrl` 是合法的 HTTPS URL，且不包含用户名或密码。
- 落地页标准化域名与 `storeDomain` 标准化结果一致。

候选店铺使用落地页站点根地址作为 `url`。当落地页路径符合 `/products/<slug>` 时写入 `productUrl`，其他 Shopify 落地页允许 `productUrl` 为 `null`。候选的 `detectionSource` 和 `discoverySources` 均标记为 `pipiads`，并保存广告标识、广告来源和落地页作为验证证据。

### 3. 合并和去重

广告来源候选与 `StoreDiscoveryAdapter` 返回结果按 `normalizedDomain` 合并：

- 同一域名只保留一个店铺候选。
- 独立店铺搜索结果优先作为基础记录，因为它包含搜索位置和搜索有效性评分。
- 合并双方的 `discoverySources`，不丢失 `pipiads` 证据。
- 当基础记录缺少 `productUrl` 或图片时，使用另一来源的非空值补全。
- 有效性分数和 Shopify 置信度取两者较高值，但不能绕过后续真实店铺验证。

### 4. 安全和失败处理

合并后的候选继续进入 `StorefrontEnrichmentService`：

- 现有 DNS 和私网地址校验保持不变。
- 现有 HTTPS、重定向限制、响应大小和超时控制保持不变。
- 只有 `verified`、`probable` 或显式开发模拟状态能进入持久化与线索候选；PipiAds 来源在启用店铺增强的正常环境中必须通过真实验证。
- 单条广告的 URL 或域名非法时跳过该候选，不使整个工作流失败。

## 数据流

```text
PipiAdsEvidence
  -> NormalizedAdCreative（显式店铺字段）
  -> PipiAds 店铺候选
  -> 与 SerpAPI 店铺按域名合并
  -> StorefrontEnrichmentService 验证
  -> ShopifyStoreEntity
  -> LeadCandidate
  -> LeadEntity / WorkflowLeadEntity
```

## 测试策略

新增或调整单元测试覆盖：

1. 真实 PipiAds Shopify 广告在独立店铺搜索为空时仍生成一个店铺候选。
2. `pipiads_mock`、非 Shopify、非 HTTPS、域名不一致的广告不生成店铺候选。
3. PipiAds 与独立搜索返回相同域名时只生成一个候选，并保留两个发现来源。
4. 现有广告和店铺去重、持久化及广告匹配测试继续通过。

完成实现后执行：

```powershell
npm.cmd --workspace backend test -- discovery.service.spec.ts --runInBand
npm.cmd --workspace backend run test
npm.cmd --workspace backend run lint
npm.cmd --workspace backend run build
```

## 验收标准

- 回归测试能在修复前稳定失败，并在修复后通过。
- 真实 PipiAds Shopify 店铺证据能够进入现有安全验证链路。
- 模拟、非法或域名不一致的数据不会生成客户线索。
- 同一店铺不会因多个来源重复生成。
- 后端完整单元测试、Lint 和构建通过。
- 不产生付费接口调用，不改变现有数据库数据。
