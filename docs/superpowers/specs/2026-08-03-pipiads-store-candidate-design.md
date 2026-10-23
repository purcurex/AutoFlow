# 店铺验证限流状态修复设计

## 背景

搜客工作流 `02 / 美国宠物用品开发` 已完成广告发现，数据库中存在 20 条真实 PipiAds 广告证据，但店铺数和客户线索数均为 0。

进一步代码核对确认：`PipiAdsStoreDiscoveryAdapter` 已经实现并绑定到 `STORE_DISCOVERY_ADAPTER`。它会从 PipiAds 的 `storeDomain`、`shopType` 和商品落地页生成店铺候选。因此，问题不在广告到店铺候选的转换。

使用数据库中的广告证据进行了一次无付费、无写库验证。20 个站点的结果为：

- 16 个站点返回 HTTP 429。
- 3 个站点存在 TLS 证书过期错误。
- 1 个站点可访问，但页面没有足够的 Shopify 标志。

当前 `StorefrontEnrichmentService` 将所有访问异常统一标记为 `failed`。HTTP 429 只表示站点限制自动访问，不能证明店铺无效；但 `DiscoveryService` 会过滤 `failed` 和 `unverified` 店铺，最终没有任何候选进入线索生成。

## 目标

- 将 HTTP 429 明确识别为“验证受限”，而不是“店铺验证失败”。
- 对已有可靠外部证据且原状态为 `probable` 的店铺保留 `probable` 状态。
- 在验证证据中记录 HTTP 状态和阻断原因，供后续人工核验和审计。
- 保持证书错误、私网地址、非法 URL 和缺少 Shopify 标志时的现有拒绝策略。
- 为本次缺陷增加自动化回归测试。

## 非目标

- 不重新执行现有工作流，不调用 PipiAds 或 SerpAPI 等付费接口。
- 不修改或回填现有数据库业务数据。
- 不通过更换 User-Agent、代理或其他方式绕过目标站点的限流策略。
- 不把所有访问异常都降级为可接受状态。
- 不改变线索评分、客户建联、报价和 FOP 逻辑。

## 方案比较

### 方案一：保留受限候选的原始可信状态（采用）

当店铺请求明确返回 HTTP 429，且进入验证前的状态为 `probable` 时，保留 `probable`，同时写入结构化验证受限证据。优点是准确表达“未完成在线验证，但已有 PipiAds/搜索证据”，并复用当前允许 `probable` 进入候选的业务规则。

### 方案二：对 HTTP 429 自动重试

429 通常由目标站点的限流或 WAF 策略产生，立即重试很可能继续失败，还会增加目标站点压力和工作流耗时。本次不采用。

### 方案三：允许全部 `failed` 或 `unverified` 店铺生成线索

该方案会把证书错误、私网目标、非法 URL 和缺少 Shopify 证据的站点一起放行，风险过高。本次不采用。

## 详细设计

### 1. 精确识别 HTTP 429

在 `StorefrontEnrichmentService` 中使用 Axios 的结构化错误信息读取 `error.response.status`，不依赖错误消息字符串。当状态码等于 429 时进入验证受限分支；其他异常继续沿用当前失败处理。

### 2. 状态规则

HTTP 429 时按输入候选状态处理：

- 输入状态为 `probable`：保持 `probable`。
- 输入状态为 `verified`：保持 `verified`，不能因一次限流丢失已有验证结果。
- 输入状态为 `unverified` 或 `failed`：保持原状态，不提升可信度。
- `mock` 在现有逻辑中不会发起网络验证，行为不变。

该规则不会凭借 HTTP 429 提升任何候选，只防止限流覆盖已有证据等级。

### 3. 验证证据

HTTP 429 分支在 `verificationEvidence` 中合并以下字段：

- `verificationBlocked: true`
- `verificationHttpStatus: 429`
- `verificationError`: 脱敏后的错误摘要

`verifiedAt` 记录本次验证尝试时间。店铺置信度、有效性评分、联系人和原始证据保持不变。

### 4. 其他错误保持失败

以下场景继续标记为 `failed` 或 `unverified`，不会生成客户线索：

- TLS 证书错误。
- DNS 解析失败或解析到私网地址。
- 非 HTTPS、带凭据或非法店铺 URL。
- 重定向超限或不安全重定向。
- 页面访问成功但没有足够的 Shopify 标志。
- HTTP 429 以外的网络和 HTTP 错误。

## 数据流

```text
PipiAds 商品落地页
  -> PipiAdsStoreDiscoveryAdapter（probable）
  -> StorefrontEnrichmentService
       -> Shopify 标志充分：verified
       -> HTTP 429：保留 probable + 记录验证受限
       -> 证书/安全/其他错误：failed
       -> 可访问但证据不足：unverified
  -> DiscoveryService 仅接收 verified / probable / mock
  -> 客户线索
```

## 测试策略

在 `storefront-enrichment.service.spec.ts` 中采用 TDD 增加：

1. `probable` 店铺收到结构化 Axios HTTP 429 时保持 `probable`，并记录验证受限证据。
2. HTTP 429 不会把 `unverified` 店铺提升为 `probable`。
3. 非 429 错误仍将候选标记为 `failed`。

保留并运行现有测试，确保：

- Shopify HTML 验证和联系人提取不受影响。
- 私网地址仍在发起 HTTP 请求前被拒绝。
- PipiAds 店铺候选生成、合并和 Google Lens 降级行为不受影响。

完成实现后执行：

```powershell
npm.cmd --workspace backend test -- storefront-enrichment.service.spec.ts --runInBand
npm.cmd --workspace backend test -- discovery.adapters.spec.ts discovery.service.spec.ts --runInBand
npm.cmd --workspace backend run test
npm.cmd --workspace backend run lint
npm.cmd --workspace backend run build
```

## 验收标准

- 回归测试能在修复前因 HTTP 429 被标记为 `failed` 而失败。
- 修复后，已有 `probable` 证据的候选在 HTTP 429 时仍为 `probable`。
- HTTP 429 不提升低可信候选。
- 证书、安全校验和其他错误仍不会生成客户线索。
- 后端完整单元测试、Lint 和构建通过。
- 不产生付费接口调用，不改变现有数据库数据。
