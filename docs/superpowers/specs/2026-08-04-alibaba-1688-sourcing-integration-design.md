# AutoFlow 1688 货源直连与分页设计

日期：2026-08-04

状态：已批准

实施项目：AutoFlow `note-app`

参考项目：`D:\JavaDemo\demo`（仅用于验证接口契约和生成测试样例，不作为运行依赖）

## 1. 目标

在 AutoFlow 现有寻源模块中直接接入 1688 跨境供货正式 API，为关键词工作流和图片工作流提供真实货源搜索、商品详情补全、独立采购评分、数据库持久化和服务端分页。

完成后应满足：

- AutoFlow 使用 NestJS 直接调用 `gw.open.1688.com`，JavaDemo 关闭后功能不受影响。
- 支持关键词搜索、本地图片搜索、外部 HTTPS 图片 URL 搜索和多语言商品详情。
- 图片搜索严格执行“获取图片字节 → 上传1688 → 获得 `imageId` → 使用 `imageId` 图搜”。
- 首次搜索和后续分页均通过数据库任务执行，HTTP 请求不等待第三方调用完成。
- 搜索结果、供应商、商品、分页状态、评分原因和脱敏响应能够追踪。
- 1688 寻源结果不参与联系方式置信度、`contactScore` 或客户综合评分。

## 2. 非目标

本次不实现：

- 把 JavaDemo 部署为生产微服务或通过 AutoFlow 调用 JavaDemo HTTP 接口。
- 1688 下单、支付、物流下单、库存同步或订单回传。
- 将1688供应商写入销售线索、联系人或外联任务。
- 对全部搜索结果逐条拉取详情；每个远端分页只补全前5条详情。
- 重构与寻源无关的工作流、广告发现、店铺发现或销售线索模块。

## 3. 已验证的正式 API 契约

Ocean SDK 与 JavaDemo 真实联调已验证以下接口：

| 功能 | Namespace | Method | Version |
| --- | --- | --- | --- |
| 关键词搜索 | `com.alibaba.fenxiao.crossborder` | `product.search.keywordQuery` | `1` |
| 图片上传 | `com.alibaba.fenxiao.crossborder` | `product.image.upload` | `1` |
| 图片搜索 | `com.alibaba.fenxiao.crossborder` | `product.search.imageQuery` | `1` |
| 商品详情 | `com.alibaba.fenxiao.crossborder` | `product.search.queryProductDetail` | `1` |

AutoFlow 使用 Param2 地址：

```text
https://gw.open.1688.com/openapi/param2/1/{namespace}/{method}/{appKey}
```

认证信息仅从服务端环境变量读取。请求体、日志、审计事件和数据库均不得保存 AppSecret、AccessToken、RefreshToken、请求签名或图片 Base64。

## 4. 总体架构

### 4.1 模块职责

#### `Alibaba1688Service`

- 生成 Param2 路径、签名和表单参数。
- 实现关键词搜索、图片上传、图片搜索和商品详情四种操作。
- 将真实1688响应转换为稳定的内部 DTO。
- 统一识别认证、权限、限流、超时、服务不可用和响应契约错误。
- 不负责数据库写入、业务评分或任务重试。

#### `SourcingImageResolverService`

- 根据工作流图片来源读取本地文件或安全下载外部 HTTPS 图片。
- 校验文件大小、内容类型和二进制文件签名。
- 将 WebP 转换为符合1688要求的 JPEG。
- 输出图片字节、规范化 MIME 类型、文件大小和内容哈希。
- 不保存第三方认证信息，不直接写寻源业务表。

#### `SourcingService`

- 校验用户、工作流和搜索归属关系。
- 创建搜索与分页任务，执行查询指纹幂等判断。
- 编排图片上传、商品搜索、详情补全、评分和事务落库。
- 构建前端分页响应。
- 不在 Controller 请求生命周期内等待第三方搜索完成。

#### `SourcingWorkerService`

- 使用数据库行锁和租约领取待处理分页。
- 驱动分页状态、重试次数和下一次可执行时间。
- 应用重启后回收租约超时任务。
- 保证同一搜索页不会被两个 Worker 同时处理。

#### Vue 寻源页面

- 创建搜索、请求未加载页面并轮询任务状态。
- 展示当前页商品、总记录数、分页器和局部错误。
- 不在浏览器中接触1688密钥或自行调用1688网关。

### 4.2 关键词执行流程

```text
创建搜索和第一页任务
→ Worker 领取第一页
→ product.search.keywordQuery-1
→ 归一化最多 pageSize 条商品
→ 并发补全本页前5条商品详情
→ 计算采购评分
→ 同一事务写入供应商、商品和分页结果
→ 更新分页及搜索状态
```

详情并发上限为5，不允许逐条串行形成不必要的延迟，也不允许无限并发触发1688限流。

### 4.3 图片执行流程

```text
创建图片搜索和第一页任务
→ 解析本地图片或安全下载外部图片
→ 校验并规范化图片
→ product.image.upload-1
→ 保存 imageId 和脱敏请求标识
→ product.search.imageQuery-1
→ 补全本页前5条详情
→ 评分并事务落库
```

同一次搜索后续翻页复用已经取得的 `imageId`，不得重复上传同一张图片。强制重新寻源创建新的搜索记录，可以重新上传并获得新的 `imageId`。

## 5. API 设计

### 5.1 创建搜索

```http
POST /api/autoflow/workflows/{workflowId}/sourcing/search
```

请求：

```json
{
  "pageSize": 20,
  "force": true,
  "priceMin": null,
  "priceMax": null
}
```

行为：

- 校验当前用户拥有该工作流。
- `pageSize` 只允许 `10`、`20`、`50`，默认 `20`。
- 创建 `sourcing_searches` 和第一页 `sourcing_search_pages`。
- 非强制请求如果命中相同查询指纹且存在可用搜索，则复用原搜索。
- 强制请求始终创建新搜索并保留旧历史。
- 返回 HTTP 202，不同步调用1688。

响应：

```json
{
  "searchId": "uuid",
  "status": "pending",
  "page": 1,
  "pageSize": 20
}
```

### 5.2 请求指定页

```http
POST /api/autoflow/workflows/{workflowId}/sourcing/searches/{searchId}/pages/{pageNumber}
```

行为：

- 校验 `owner_user_id + workflow_run_id + search_id`。
- 已成功页面直接返回现有状态，不重新调用1688。
- 已排队或运行页面返回原任务，不创建重复任务。
- 最终失败页面允许显式重试，并重置为 `pending`。
- 页码不能超过已知 `total_pages`；总页数未知时仅允许从第一页开始请求。

### 5.3 读取分页结果

```http
GET /api/autoflow/workflows/{workflowId}/sourcing?searchId={searchId}&page={page}&pageSize={pageSize}
```

响应：

```json
{
  "search": {
    "id": "uuid",
    "status": "succeeded",
    "searchMode": "keyword",
    "requestedAt": "2026-08-04T00:00:00.000Z"
  },
  "pagination": {
    "page": 2,
    "pageSize": 20,
    "totalRecords": 2000,
    "totalPages": 100,
    "resultCount": 20,
    "loaded": true,
    "status": "succeeded"
  },
  "items": []
}
```

GET 只读取数据库，不隐式触发第三方调用。

## 6. 数据库设计

### 6.1 `sourcing_searches`

保留现有字段并增加：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `language_code` | varchar(32) | 默认 `en` |
| `image_id` | varchar(255), nullable | 1688图片上传结果 |
| `image_upload_request_id` | varchar(128), nullable | 脱敏上传请求标识 |
| `image_upload_trace_id` | varchar(128), nullable | 脱敏上传追踪标识 |
| `total_records` | bigint, nullable | 远端总记录数 |
| `total_pages` | integer, nullable | 按固定 pageSize 计算的总页数 |
| `page_size` | integer | 一次搜索固定分页大小 |
| `loaded_page_count` | integer | 已成功落库页数 |
| `query_fingerprint` | varchar(128) | 查询幂等指纹 |

查询指纹由当前用户、工作流、搜索模式、规范化关键词或图片来源标识、语言、pageSize和价格筛选条件生成。指纹不包含密钥、签名、图片字节或图片Base64。

`loaded_page_count` 在分页任务完成事务中根据成功分页数量重新计算，不能简单自增，避免并发分页造成计数丢失。

搜索状态扩展为：

```text
pending, running, succeeded, partial, failed, cancelled
```

状态含义：

- `pending`：第一页等待处理。
- `running`：第一页正在处理且尚无可展示数据。
- `succeeded`：第一页成功且当前没有最终失败页。
- `partial`：至少一页成功，同时存在最终失败页。
- `failed`：第一页最终失败且没有可展示结果。
- `cancelled`：任务被显式取消。

### 6.2 `workflow_runs` 图片资产字段

为避免服务端根据公共 URL 反推本地文件路径，图片工作流增加以下可空字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `seed_asset_path` | varchar(1000), nullable | 工作流上传目录内的受控相对路径 |
| `seed_asset_mime_type` | varchar(64), nullable | 已校验的原始MIME类型 |
| `seed_asset_size` | bigint, nullable | 原始图片字节数 |
| `seed_asset_sha256` | varchar(64), nullable | 原始图片内容哈希 |

本地上传图片必须保存这些字段；外部 URL 图片保持这些字段为空并继续使用 `seedValue`。读取本地资产时同时校验当前用户、工作流记录和受控上传目录。

### 6.3 新增 `sourcing_search_pages`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `search_id` | uuid | 所属搜索 |
| `owner_user_id` | uuid | 数据隔离 |
| `page_number` | integer | 1688页码，从1开始 |
| `page_size` | integer | 与搜索固定值一致 |
| `status` | varchar(24) | pending/running/succeeded/failed |
| `attempts` | integer | 已执行次数 |
| `max_attempts` | integer | 固定为3 |
| `available_at` | timestamptz | 下次可领取时间 |
| `lease_owner` | varchar(255), nullable | 当前Worker实例标识 |
| `lease_expires_at` | timestamptz, nullable | Worker租约 |
| `heartbeat_at` | timestamptz, nullable | 最近一次租约续期时间 |
| `provider_request_id` | varchar(128), nullable | 远端请求标识 |
| `provider_trace_id` | varchar(128), nullable | 远端追踪标识 |
| `result_count` | integer | 本页实际结果数 |
| `error_code` | varchar(80), nullable | 归一化错误码 |
| `error_message` | text, nullable | 已脱敏错误信息 |
| `started_at` | timestamptz, nullable | 开始时间 |
| `completed_at` | timestamptz, nullable | 完成时间 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

约束和索引：

```text
UNIQUE(search_id, page_number)
INDEX(status, available_at)
INDEX(search_id, page_number)
INDEX(owner_user_id, search_id)
INDEX(lease_expires_at)
CHECK(page_number >= 1)
CHECK(page_size IN (10, 20, 50))
CHECK(attempts >= 0 AND attempts <= max_attempts)
```

### 6.4 `sourcing_offers`

增加：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `page_number` | integer | 首次出现页码 |
| `rank_in_page` | integer | 页内顺序 |
| `absolute_rank` | integer | `(page-1)*pageSize+rank` |
| `detail_status` | varchar(24) | not_requested/succeeded/failed |
| `detail_retrieved_at` | timestamptz, nullable | 详情更新时间 |
| `score_version` | varchar(32) | 评分算法版本 |
| `score_dimensions` | jsonb | 各评分维度与中性缺失处理结果 |

分页查询必须显式包含：

```sql
WHERE owner_user_id = :ownerUserId
  AND workflow_run_id = :workflowRunId
  AND search_id = :searchId
  AND page_number = :pageNumber
ORDER BY rank_in_page ASC
LIMIT :limit
OFFSET :offset
```

同一搜索内继续使用 `(search_id, provider, offer_id)` 防重。商品若在不同远端页重复出现，保留首次排名，不重复生成商品记录。

### 6.5 金额与比率

- `price_min`、`price_max`、MOQ和价格阶梯全程使用十进制字符串及 Decimal 库计算。
- 禁止将金额先转换成 JavaScript `number` 再写回 decimal。
- `repurchase_rate` 和 `supplier_rating` 从浮点类型迁移为定点 decimal。
- 数据库迁移必须验证现有值能够无损转换，并提供可执行的 `down` 回滚。

### 6.6 原始快照

`raw_snapshot` 保存每个商品对应的脱敏搜索商品和脱敏详情，而不是只保存内部归一化 DTO。必须移除：

- AppSecret、AccessToken、RefreshToken和签名。
- 图片Base64和完整上传请求。
- 临时请求令牌、URL认证参数及不需要持久化的追踪参数。

页面级表只保存分页元数据，不重复保存整页商品 JSON。

## 7. 图片安全设计

### 7.1 本地图片

- 通过明确的工作流图片资产路径读取，不根据用户输入拼接任意文件系统路径。
- 解析后的绝对路径必须位于 AutoFlow 工作流上传目录内。
- 校验文件存在、归属当前用户且大小不超过5MB。

工作流需要持久化图片资产相对路径和必要元数据，不能仅保存可能指向 localhost 的公共 URL。现有 `seedValue` 继续用于页面预览和兼容，服务端上传1688时使用受控资产路径。

### 7.2 外部 URL

- 仅接受 HTTPS。
- 禁止 URL 用户名、密码和非标准端口。
- DNS解析后拒绝 loopback、链路本地、私网、保留地址和组播地址。
- 最多重定向3次，每次跳转重新执行协议、主机、端口和DNS校验。
- 连接和读取总超时10秒。
- 流式读取并在超过5MB时立即中止。
- 同时校验响应 Content-Type 和二进制文件签名，不能只信任扩展名。
- 日志只记录规范化主机，不记录可能包含查询凭据的完整URL。

### 7.3 格式规范化

- 1688上传只发送 JPEG 或 PNG。
- WebP在服务端转换为JPEG，转换后仍需检查5MB上限。
- 不把转换后的Base64写入磁盘、日志或数据库。
- 计算 SHA-256 内容哈希用于本次搜索内诊断和幂等，不将哈希当作用户身份信息。

## 8. 状态、幂等与事务

- Controller 创建任务的事务只负责搜索和第一页任务，不调用第三方。
- Worker 通过 `FOR UPDATE SKIP LOCKED` 原子领取一个可执行页面并设置租约。
- Worker 完成、续租和失败更新必须同时匹配分页ID、`running`状态和 `lease_owner`，防止旧Worker覆盖已被重新领取的任务。
- 同一页重复点击由唯一约束和状态判断返回现有任务。
- 页面写入事务包含供应商、商品、分页成功状态和搜索汇总字段。
- 页面只有全部目标记录写入成功后才能标记 `succeeded`。
- 事务失败时不保留半页结果；重试前按 `search_id + page_number` 清理未完成数据。
- 已成功页面不因另一页失败而被删除。
- 应用重启后，`lease_expires_at < now()` 的运行任务可以重新领取。

## 9. 重试与错误处理

单页最多执行3次。建议退避为约1秒、3秒并加入少量随机抖动；HTTP 429 如果提供合理的 `Retry-After`，优先遵循但等待不超过60秒。

允许重试：

- 网络连接失败或连接重置。
- 请求超时。
- HTTP 429。
- HTTP 5xx。
- 1688明确返回临时服务不可用。

禁止重试：

- AccessToken失效。
- 权限包不足。
- AppKey、签名或API名称错误。
- 请求参数非法。
- 图片格式、大小或来源非法。
- 响应结构与已验证契约不匹配。

统一错误码：

```text
NOT_CONFIGURED
AUTHENTICATION_FAILED
PERMISSION_DENIED
RATE_LIMITED
PROVIDER_TIMEOUT
PROVIDER_UNAVAILABLE
INVALID_IMAGE
INVALID_REQUEST
INVALID_RESPONSE
```

错误日志仅包含操作名、归一化错误码、HTTP状态、脱敏 requestId、耗时和当前尝试次数。

## 10. 采购评分

保留现有独立采购评分模型，评分因素包括：

- 商品标题与关键词相关性。
- 目标价格匹配度。
- 最低起订量。
- 供应商交易和服务评分。
- 复购率。
- 一件代发能力。
- 发货与物流能力。
- 定制能力和供货标签。

要求：

- 金额比较使用 Decimal。
- 缺失维度采用中性处理并记录原因，不能直接判定供应商能力差。
- 保存 `sourcing_score`、`sourcing_score_reasons`、`score_dimensions` 和 `score_version`。
- 相同输入和相同评分版本必须产生相同结果。
- 1688采购评分不得回写客户联系方式置信度、`contactScore` 或客户综合评分。

## 11. 前端交互

- 点击“重新寻源”后立即展示 `pending` 状态，不阻塞按钮直到第三方请求结束。
- 每1.5秒轮询当前搜索页，进入成功或最终失败状态后停止。
- 页面离开或搜索切换时取消旧轮询。
- 展示“第1–20条，共2000条”以及上一页、下一页和页码。
- 支持每页10、20、50条；修改 pageSize 创建新搜索并回到第一页。
- 已加载页立即显示数据库结果。
- 未加载页先创建页面任务，并只在商品区域显示局部加载状态。
- 单页失败显示“重新加载本页”，不清空其他已加载页面。
- Token或权限错误显示真实配置提示，不返回模拟商品。
- `searchId`、页码和 pageSize 同步到URL查询参数，刷新后恢复当前位置。

## 12. 配置与可观测性

继续使用服务端环境变量：

```text
ALIBABA_1688_ENABLED
ALIBABA_1688_APP_KEY
ALIBABA_1688_APP_SECRET
ALIBABA_1688_ACCESS_TOKEN
ALIBABA_1688_GATEWAY_URL
ALIBABA_1688_PROTOCOL_VERSION
ALIBABA_1688_REQUEST_TIMEOUT_MS
```

增加非敏感运行参数时应提供有界默认值，例如 Worker 轮询间隔、租约时长和详情并发数。密钥不得通过前端API返回。

建议记录以下指标或结构化日志字段：

- operation、searchId、pageNumber。
- providerRequestId、providerTraceId（脱敏后）。
- durationMs、attempt、resultCount。
- normalizedErrorCode、httpStatus。
- imageSourceType、imageByteSize，不记录图片内容和完整外部URL。

## 13. 测试策略

### 13.1 单元测试

- 四个正式API的请求参数、Param2路径和响应归一化。
- Param2签名固定向量。
- JavaDemo真实响应脱敏后形成固定测试夹具。
- JPG、PNG、WebP、伪造MIME、超大图片及转换失败。
- 外部URL的内网IP、DNS解析、重定向、非标准端口、超时和大小限制。
- Decimal价格、MOQ、价格区间和评分稳定性。
- 错误分类、重试判断和敏感值清理。

### 13.2 服务与数据库测试

- 相同页面重复创建只能得到一条分页任务。
- 两个Worker并发时只能有一个领取同一页。
- 租约超时任务能够恢复。
- 第三次可重试失败后进入最终失败状态。
- 不可重试错误只执行一次。
- 页面事务失败不留下半页商品。
- 页1成功、页2失败时搜索状态为 `partial`，页1仍可读取。
- 强制重新寻源保留旧搜索历史。
- 所有查询显式验证用户和工作流隔离。
- migration `up/down` 以及现有浮点数据向 decimal 的转换。

### 13.3 前端测试

- 创建任务后轮询并展示成功结果。
- 翻页时已加载页走缓存，未加载页创建任务。
- 修改 pageSize 创建新搜索并回到第一页。
- 单页错误不清空其他页。
- 离开页面后停止轮询。
- URL参数能够恢复搜索和页码。

### 13.4 真实联调

仅使用 AutoFlow 直连正式1688环境验证：

1. 关键词搜索成功。
2. 商品详情成功并补全前5条。
3. 本地图片上传获得 `imageId`。
4. 外部HTTPS图片下载、上传和图搜成功。
5. 第1页和第2页成功落库，返回第1页时不重复调用1688。
6. 强制重新寻源产生新搜索并保留旧搜索。
7. JavaDemo停止运行后所有功能仍正常。
8. 日志和数据库不存在AppSecret、AccessToken、签名或图片Base64。

## 14. 验收标准

- 1688未配置时页面显示明确配置错误，不出现模拟商品。
- 创建搜索接口在本地数据库正常时快速返回202，不受1688响应时间影响。
- 关键词和图片工作流均能获得真实货源。
- 图片搜索只使用1688返回的 `imageId`，不再把本地URL直接传给图搜API。
- 分页结果按页稳定排序，已加载页面不重复请求1688。
- 同一搜索页的并发请求不会产生重复分页任务或重复商品。
- 价格和MOQ不存在经过JavaScript浮点计算造成的精度变化。
- 外部图片URL无法访问本机、内网或保留地址。
- 临时错误按规则重试，不可重试错误立即失败。
- 应用重启后未完成分页任务可以恢复。
- 采购评分与客户联系评分保持完全隔离。
- 自动测试通过，真实联调四条API和至少两页分页通过。

## 15. 实施边界与顺序

实施计划应按以下依赖顺序展开：

1. 固化真实响应夹具与适配器契约测试。
2. 完成图片上传和图片安全解析组件。
3. 创建数据库迁移、分页实体和状态模型。
4. 将搜索执行改为数据库任务与Worker。
5. 完成分页接口、事务落库和Decimal改造。
6. 更新Vue分页、轮询和错误状态。
7. 执行后端、前端、迁移及真实联调验证。

每一步坚持最小改动，不删除现有寻源评分或工作流旁路逻辑；发现现有行为与本设计冲突时，应先以测试固化预期，再做局部调整。
