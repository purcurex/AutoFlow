# AutoFlow 1688 Sourcing Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AutoFlow 中直接完成1688关键词寻源、图片上传图搜、商品详情补全、数据库任务重试和服务端分页，JavaDemo仅作为已验证契约参考。

**Architecture:** 保留现有 `Alibaba1688Service`、`SourcingService` 和三张寻源表，在其边界内增加图片上传、受控图片解析、分页任务实体、页面执行器和租约Worker。Controller只创建或读取数据库任务，Worker异步调用1688并在事务中写入分页商品，Vue按 `searchId/page/pageSize` 轮询和翻页。

**Tech Stack:** NestJS 11、TypeScript 5.9、TypeORM 0.3、PostgreSQL、Axios、Decimal.js、Sharp、Vue 3、Vue Router、Vitest、Jest。

## Global Constraints

- JavaDemo不得成为运行时依赖，AutoFlow必须直接调用 `https://gw.open.1688.com/openapi`。
- 正式API固定为 `product.search.keywordQuery-1`、`product.image.upload-1`、`product.search.imageQuery-1`、`product.search.queryProductDetail-1`。
- 图片搜索必须先上传图片获得 `imageId`，不得把本地URL直接传给图搜API。
- 外部图片只允许HTTPS，禁止内网、回环、保留地址、URL凭据和非443端口；最多3次重定向、10秒总超时、5MB上限。
- AppSecret、AccessToken、RefreshToken、签名、图片Base64不得写入日志、数据库或前端响应。
- 金额、MOQ、比率使用十进制字符串和 Decimal.js，禁止先转为 JavaScript `number` 参与金额计算。
- 分页大小只允许10、20、50；同一搜索的pageSize固定。
- 所有业务查询显式包含当前用户、工作流和搜索归属条件。
- 每页只补全前5个商品详情，详情并发上限为5。
- 1688采购评分不得写入 `contactScore`、客户综合评分或销售线索。
- 代码和测试使用UTF-8，保持现有NestJS/Vue风格并执行最小范围改动。

---

## File Structure

### 新增后端文件

- `backend/src/modules/sourcing/entities/sourcing-search-page.entity.ts`：分页任务、租约、重试和远端请求元数据。
- `backend/src/modules/sourcing/sourcing-image-resolver.service.ts`：本地图片读取、远程HTTPS安全下载、格式校验和WebP转换。
- `backend/src/modules/sourcing/sourcing-image-resolver.service.spec.ts`：图片边界和SSRF测试。
- `backend/src/modules/sourcing/sourcing-snapshot.ts`：递归清理真实1688响应中的敏感字段。
- `backend/src/modules/sourcing/sourcing-snapshot.spec.ts`：快照脱敏测试。
- `backend/src/modules/sourcing/sourcing-decimal.ts`：价格、MOQ、百分比的Decimal转换和极值计算。
- `backend/src/modules/sourcing/sourcing-decimal.spec.ts`：高精度测试。
- `backend/src/modules/sourcing/sourcing-page-executor.service.ts`：执行单页1688调用并事务落库。
- `backend/src/modules/sourcing/sourcing-page-executor.service.spec.ts`：关键词、图片、详情和回滚测试。
- `backend/src/modules/sourcing/sourcing-worker.service.ts`：领取、续租、重试和恢复分页任务。
- `backend/src/modules/sourcing/sourcing-worker.service.spec.ts`：并发领取、退避和租约恢复测试。
- `backend/src/modules/sourcing/sourcing-error-policy.ts`：把Provider和图片异常归一化为重试决策。
- `backend/src/modules/sourcing/sourcing-error-policy.spec.ts`：认证、权限、限流、超时和非法图片分类测试。
- `backend/src/modules/sourcing/dto/list-sourcing.dto.ts`：读取分页查询参数。
- `backend/src/modules/sourcing/dto/list-sourcing.dto.spec.ts`：页码和pageSize验证。
- `backend/src/database/migrations/1784728000000-AddAlibaba1688SourcingPagination.ts`：工作流图片元数据、分页表和寻源字段迁移。

### 新增脚本

- `scripts/alibaba1688-sourcing-smoke.mjs`：通过AutoFlow HTTP接口执行关键词、图片和第二页真实联调，不直接调用JavaDemo。

### 主要修改文件

- `backend/package.json`、`package-lock.json`：增加 `decimal.js` 和 `sharp`。
- `backend/src/modules/alibaba1688/alibaba1688.constants.ts`：增加图片上传正式方法。
- `backend/src/modules/alibaba1688/alibaba1688.types.ts`：增加图片上传和原始响应类型。
- `backend/src/modules/alibaba1688/dto/alibaba1688.dto.ts`：增加图片上传内部DTO并收紧图搜为 `imageId`。
- `backend/src/modules/alibaba1688/alibaba1688.service.ts`：实现 `uploadImage()`，删除生产图搜的 `imageAddress` 参数路径。
- `backend/src/modules/alibaba1688/alibaba1688.service.spec.ts`：使用已验证响应覆盖四条API。
- `backend/src/modules/autoflow/entities/workflow-run.entity.ts`：增加受控图片资产元数据。
- `backend/src/modules/autoflow/dto/autoflow.dto.ts`：接收图片资产引用。
- `backend/src/modules/autoflow/workflow-seed-asset.service.ts`：返回MIME、SHA-256并验证资产归属。
- `backend/src/modules/autoflow/autoflow.service.ts`：保存和映射图片资产字段。
- `backend/src/modules/sourcing/entities/*.ts`：分页、Decimal、评分版本和关系。
- `backend/src/modules/sourcing/sourcing.types.ts`：增加 `partial`、分页状态和错误类型。
- `backend/src/modules/sourcing/sourcing-response.types.ts`：增加分页响应和异步启动响应。
- `backend/src/modules/sourcing/dto/start-sourcing.dto.ts`：固定pageSize集合并使用价格字符串。
- `backend/src/modules/sourcing/sourcing.controller.ts`：增加分页查询和请求指定页接口。
- `backend/src/modules/sourcing/sourcing.service.ts`：改为任务创建、分页查询和查询指纹编排。
- `backend/src/modules/sourcing/sourcing.module.ts`：注册分页实体、图片解析器、执行器和Worker。
- `backend/src/modules/sourcing/sourcing-scoring.ts`：金额匹配改为Decimal输入。
- `backend/src/database/tests/autoflow.migrations.spec.ts`：验证新迁移SQL。
- `frontend/src/api/autoflow.ts`：增加分页类型、查询参数和页面任务方法。
- `frontend/src/views/autoflow/WorkflowsView.vue`：创建图片工作流时提交资产元数据。
- `frontend/src/views/autoflow/SourcingView.vue`：轮询、分页、局部失败和URL同步。
- `frontend/src/utils/sourcing.ts`：支持 `pending/partial` 状态。
- `frontend/src/i18n/index.ts`：分页、状态和错误文案。
- `frontend/src/tests/workflow-image.test.ts`、`frontend/src/tests/sourcing-view.test.ts`：前端行为测试。

---

### Task 1: 固化四条正式1688适配器契约

**Files:**
- Modify: `backend/src/modules/alibaba1688/alibaba1688.constants.ts`
- Modify: `backend/src/modules/alibaba1688/alibaba1688.types.ts`
- Modify: `backend/src/modules/alibaba1688/dto/alibaba1688.dto.ts`
- Modify: `backend/src/modules/alibaba1688/alibaba1688.service.ts`
- Modify: `backend/src/modules/alibaba1688/__fixtures__/provider-responses.ts`
- Modify: `backend/src/modules/alibaba1688/alibaba1688.service.spec.ts`

**Interfaces:**
- Consumes: 现有 `invoke()`、Param2签名和 `Alibaba1688CallResult`。
- Produces: `uploadImage(input: Alibaba1688ImageUploadDto): Promise<Alibaba1688CallResult<Alibaba1688ImageUploadProviderResponse, Alibaba1688StableImageUploadResult>>`；`searchByImage()` 只接受 `imageId`。

- [ ] **Step 1: 写图片上传和正式图搜失败测试**

```ts
it('uploads a normalized image through product.image.upload-1', async () => {
  axiosPost.mockResolvedValue({
    status: 200,
    data: { result: { success: true, code: '200', result: { imageId: 'image-1688-1' } } },
  })

  const result = await service.uploadImage({
    imageBase64: Buffer.from('verified-image').toString('base64'),
  })

  expect(result.normalized.imageId).toBe('image-1688-1')
  expect(axiosPost.mock.calls[0][0]).toContain(
    '/param2/1/com.alibaba.fenxiao.crossborder/product.image.upload/',
  )
})

it('requires imageId for product.search.imageQuery-1', async () => {
  await expect(service.searchByImage({ imageId: '' })).rejects.toMatchObject({
    normalized: { code: 'INVALID_REQUEST' },
  })
})
```

- [ ] **Step 2: 运行测试确认当前缺少上传方法且图搜仍接受URL**

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/alibaba1688/alibaba1688.service.spec.ts`

Expected: FAIL，提示 `uploadImage is not a function` 或图搜DTO仍允许 `imageAddress`。

- [ ] **Step 3: 增加正式上传常量、类型和DTO**

```ts
uploadMethod: 'product.image.upload',

export interface Alibaba1688ImageUploadDto {
  imageBase64: string
  outMemberId?: string
}

export interface Alibaba1688StableImageUploadResult {
  provider: typeof ALIBABA_1688_PROVIDER
  imageId: string
}
```

删除 `Alibaba1688ImageSearchDto.imageAddress`，保留 `imageId`、`country`、`beginPage`、`pageSize` 和可选 `outMemberId`。给 `Alibaba1688CallMetadata` 增加 `traceId: string | null`，按 `traceId/trace_id` 提取并执行与requestId相同的字符白名单和长度限制。

- [ ] **Step 4: 实现 `uploadImage()` 并收紧 `searchByImage()`**

```ts
async uploadImage(input: Alibaba1688ImageUploadDto) {
  const config = this.requireReady()
  const imageBase64 = this.requiredText(input.imageBase64, 'imageBase64')
  const provider = await this.invoke(
    'image_upload',
    this.endpoint('upload'),
    { uploadImageParam: { imageBase64, appKey: Number(config.appKey), outMemberId: input.outMemberId } },
    config,
  )
  return this.callResult('image_upload', provider, {
    provider: ALIBABA_1688_PROVIDER,
    imageId: this.requiredText(provider.result?.result?.imageId, 'imageId'),
  })
}
```

扩展 `endpoint()` 的联合类型为 `'keyword' | 'image' | 'detail' | 'upload'`，并为上传使用同一Param2签名流程。不要在异常消息中包含 `imageBase64`。

- [ ] **Step 5: 用JavaDemo脱敏真实响应扩充fixture并验证四条契约**

fixture必须包含关键词分页、商品详情、图片上传 `imageId` 和图片搜索分页，但 `requestId`、`traceId` 使用固定测试值，不能复制正式Token或签名。

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/alibaba1688/alibaba1688.service.spec.ts src/modules/alibaba1688/param2-signer.spec.ts`

Expected: PASS。

- [ ] **Step 6: 提交适配器契约**

```bash
git add backend/src/modules/alibaba1688
git commit -m "feat: add verified 1688 image upload contract"
```

---

### Task 2: 保存可审计且脱敏的真实响应快照

**Files:**
- Create: `backend/src/modules/sourcing/sourcing-snapshot.ts`
- Create: `backend/src/modules/sourcing/sourcing-snapshot.spec.ts`
- Modify: `backend/src/modules/sourcing/sourcing.types.ts`

**Interfaces:**
- Consumes: `unknown` 类型的1688搜索商品和详情对象。
- Produces: `sanitizeSourcingSnapshot(value: unknown): Record<string, unknown>`；输出不包含认证字段、图片Base64、临时token或URL查询凭据。

- [ ] **Step 1: 写递归脱敏失败测试**

```ts
it('removes secrets, image payloads, temporary tokens, and URL query credentials', () => {
  expect(sanitizeSourcingSnapshot({
    access_token: 'secret-token',
    imageBase64: 'base64-data',
    token: 'temporary-product-token',
    traceInfo: { token: 'trace-token' },
    promotionURL: 'https://detail.1688.com/offer/1.html?token=secret&spm=value',
    offerId: 1,
  })).toEqual({
    promotionURL: 'https://detail.1688.com/offer/1.html',
    offerId: 1,
  })
})
```

- [ ] **Step 2: 运行测试确认模块不存在**

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/sourcing/sourcing-snapshot.spec.ts`

Expected: FAIL，提示无法解析 `./sourcing-snapshot`。

- [ ] **Step 3: 实现不可变递归清理**

```ts
const BLOCKED_KEYS = /^(?:access_?token|refresh_?token|appsecret|_aop_signature|imagebase64|token|traceinfo)$/i

export function sanitizeSourcingSnapshot(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(value)
  return isPlainRecord(sanitized) ? sanitized : {}
}
```

数组逐项清理；对象创建新对象；HTTP(S) URL删除用户名、密码和全部查询参数；超过64KB的单个字符串截断并添加 `...[truncated]`。不得修改传入对象。

- [ ] **Step 4: 验证嵌套数组、循环引用和输入不可变**

循环引用输出字符串 `"[circular]"`，不能导致栈溢出。

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/sourcing/sourcing-snapshot.spec.ts`

Expected: PASS。

- [ ] **Step 5: 提交快照清理器**

```bash
git add backend/src/modules/sourcing/sourcing-snapshot.ts backend/src/modules/sourcing/sourcing-snapshot.spec.ts backend/src/modules/sourcing/sourcing.types.ts
git commit -m "feat: sanitize 1688 sourcing snapshots"
```

---

### Task 3: 持久化受控工作流图片资产引用

**Files:**
- Modify: `backend/src/modules/autoflow/workflow-seed-asset.service.ts`
- Modify: `backend/src/modules/autoflow/workflow-seed-asset.service.spec.ts`
- Modify: `backend/src/modules/autoflow/entities/workflow-run.entity.ts`
- Modify: `backend/src/modules/autoflow/dto/autoflow.dto.ts`
- Modify: `backend/src/modules/autoflow/dto/autoflow.dto.spec.ts`
- Modify: `backend/src/modules/autoflow/autoflow.service.ts`
- Modify: `backend/src/modules/autoflow/autoflow.service.spec.ts`
- Modify: `backend/src/modules/autoflow/autoflow.types.ts`
- Modify: `frontend/src/api/autoflow.ts`
- Modify: `frontend/src/views/autoflow/WorkflowsView.vue`
- Modify: `frontend/src/tests/workflow-image.test.ts`

**Interfaces:**
- Consumes: `WorkflowSeedAsset` 上传响应。
- Produces: `seedAssetPath`、`seedAssetMimeType`、`seedAssetSize`、`seedAssetSha256`；`WorkflowSeedAssetService.assertOwnedAsset(ownerUserId, assetPath)`。

- [ ] **Step 1: 写资产元数据和越权路径失败测试**

```ts
expect(await service.save(userId, imageFile(png), request())).toMatchObject({
  assetPath: expect.stringContaining(`/workflow-seeds/${userId}/`),
  mimeType: 'image/png',
  sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
})

await expect(
  service.assertOwnedAsset(userId, '/uploads/workflow-seeds/another-user/image.png'),
).rejects.toBeInstanceOf(BadRequestException)
```

DTO测试必须拒绝关键词工作流携带资产字段，并拒绝不以 `/uploads/workflow-seeds/` 开头的路径。

- [ ] **Step 2: 运行后端和前端相关测试确认失败**

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/autoflow/workflow-seed-asset.service.spec.ts src/modules/autoflow/dto/autoflow.dto.spec.ts src/modules/autoflow/autoflow.service.spec.ts`

Run: `npm test --workspace=frontend -- --run src/tests/workflow-image.test.ts`

Expected: FAIL，现有上传响应没有MIME和SHA-256，创建工作流请求没有资产字段。

- [ ] **Step 3: 扩展上传响应并验证受控路径**

```ts
export interface WorkflowSeedAsset {
  assetPath: string
  publicUrl: string
  providerReady: boolean
  originalName: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  size: number
  sha256: string
}
```

使用 `createHash('sha256').update(file.buffer).digest('hex')`。`assertOwnedAsset()` 使用 `resolve()` 后验证目标位于 `resolve(process.cwd(), 'uploads', 'workflow-seeds', ownerUserId)` 内，并通过 `stat()` 确认是普通文件；禁止字符串前缀拼接判断。

- [ ] **Step 4: 保存、映射并由前端提交资产元数据**

```ts
imageUpload.value = result
form.seedValue = result.publicUrl
form.seedAssetPath = result.assetPath
form.seedAssetMimeType = result.mimeType
form.seedAssetSize = result.size
form.seedAssetSha256 = result.sha256
```

`AutoflowService.createWorkflowRecord()` 在图片资产路径存在时调用 `assertOwnedAsset()`，并把四个字段写入工作流。外部URL图片四个字段必须为 `null`。

- [ ] **Step 5: 运行工作流测试和构建**

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/autoflow/workflow-seed-asset.service.spec.ts src/modules/autoflow/dto/autoflow.dto.spec.ts src/modules/autoflow/autoflow.service.spec.ts`

Run: `npm test --workspace=frontend -- --run src/tests/workflow-image.test.ts src/tests/workflow-lifecycle.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交工作流资产引用**

```bash
git add backend/src/modules/autoflow frontend/src/api/autoflow.ts frontend/src/views/autoflow/WorkflowsView.vue frontend/src/tests/workflow-image.test.ts
git commit -m "feat: persist controlled workflow image assets"
```

---

### Task 4: 实现本地图片解析和外部URL安全下载

**Files:**
- Modify: `backend/package.json`
- Modify: `package-lock.json`
- Create: `backend/src/modules/sourcing/sourcing-image-resolver.service.ts`
- Create: `backend/src/modules/sourcing/sourcing-image-resolver.service.spec.ts`
- Modify: `backend/src/modules/sourcing/sourcing.module.ts`

**Interfaces:**
- Consumes: `WorkflowRunEntity` 的本地资产字段或外部HTTPS `seedValue`。
- Produces: `resolve(workflow: WorkflowRunEntity): Promise<ResolvedSourcingImage>`。

```ts
export interface ResolvedSourcingImage {
  bytes: Buffer
  mimeType: 'image/jpeg' | 'image/png'
  byteLength: number
  sha256: string
  sourceType: 'local' | 'remote'
  sourceHost: string | null
}

export class SourcingImageException extends Error {
  constructor(
    readonly code: 'INVALID_IMAGE' | 'INVALID_REQUEST' | 'PROVIDER_TIMEOUT' | 'PROVIDER_UNAVAILABLE',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}
```

- [ ] **Step 1: 安装Sharp并写安全边界测试**

Run: `npm install --workspace=backend sharp`

测试覆盖：本地目录逃逸、HTTP协议、URL凭据、非443端口、127.0.0.1、`::1`、10/8、172.16/12、192.168/16、链路本地、保留地址、重定向到内网、第四次重定向、超过5MB、错误图片签名和WebP转换。非法来源和格式抛出不可重试 `SourcingImageException`；远程连接超时和临时5xx分别抛出可重试 `PROVIDER_TIMEOUT`、`PROVIDER_UNAVAILABLE`。

```ts
await expect(resolver.resolve(remoteWorkflow('https://127.0.0.1/image.png')))
  .rejects.toMatchObject({ code: 'INVALID_REQUEST', retryable: false })
```

- [ ] **Step 2: 运行测试确认解析器不存在**

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/sourcing/sourcing-image-resolver.service.spec.ts`

Expected: FAIL，提示无法解析服务文件。

- [ ] **Step 3: 实现地址分类和DNS固定**

对每次URL请求先调用 `dns.promises.lookup(hostname, { all: true, verbatim: true })`，所有解析地址必须是公网地址。为Axios创建 `https.Agent` 并覆写 `lookup`，固定使用已经校验的地址，避免校验后再次DNS解析。

```ts
const agent = new https.Agent({
  lookup: (_hostname, _options, callback) => {
    callback(null, selected.address, selected.family)
  },
})
```

Axios设置 `maxRedirects: 0`、`responseType: 'arraybuffer'`、`timeout: remainingTimeoutMs`、`maxContentLength: 5 * 1024 * 1024`、`maxBodyLength: 5 * 1024 * 1024`。3xx响应手动解析 `Location` 并重新验证。

- [ ] **Step 4: 实现图片签名校验和WebP转换**

使用Sharp读取元数据；JPEG和PNG保留原格式，WebP执行：

```ts
const converted = await sharp(inputBytes)
  .rotate()
  .jpeg({ quality: 90, mozjpeg: true })
  .toBuffer()
```

转换后再次检查5MB限制并计算SHA-256。日志不得包含完整外部URL。

- [ ] **Step 5: 运行安全测试和依赖审计**

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/sourcing/sourcing-image-resolver.service.spec.ts`

Run: `npm audit --workspace=backend --omit=dev --audit-level=high`

Expected: 测试PASS；没有由新增生产依赖引入的高危漏洞。

- [ ] **Step 6: 提交图片解析器**

```bash
git add backend/package.json package-lock.json backend/src/modules/sourcing/sourcing-image-resolver.service.ts backend/src/modules/sourcing/sourcing-image-resolver.service.spec.ts backend/src/modules/sourcing/sourcing.module.ts
git commit -m "feat: securely resolve 1688 sourcing images"
```

---

### Task 5: 创建分页任务和精度字段数据库迁移

**Files:**
- Create: `backend/src/database/migrations/1784728000000-AddAlibaba1688SourcingPagination.ts`
- Create: `backend/src/modules/sourcing/entities/sourcing-search-page.entity.ts`
- Modify: `backend/src/modules/sourcing/entities/index.ts`
- Modify: `backend/src/modules/sourcing/entities/sourcing-search.entity.ts`
- Modify: `backend/src/modules/sourcing/entities/sourcing-offer.entity.ts`
- Modify: `backend/src/modules/sourcing/entities/sourcing-supplier.entity.ts`
- Modify: `backend/src/modules/autoflow/entities/workflow-run.entity.ts`
- Modify: `backend/src/modules/sourcing/entities/sourcing.entities.spec.ts`
- Modify: `backend/src/database/tests/autoflow.migrations.spec.ts`

**Interfaces:**
- Consumes: Task 3定义的工作流资产字段。
- Produces: `SourcingSearchPageEntity` 和所有规格字段；后续Worker依赖 `leaseOwner`、`leaseExpiresAt`、`heartbeatAt`。

- [ ] **Step 1: 写实体元数据和迁移SQL失败测试**

```ts
expect(pageColumns).toEqual(expect.arrayContaining([
  'searchId', 'ownerUserId', 'pageNumber', 'pageSize', 'status',
  'attempts', 'maxAttempts', 'availableAt', 'leaseOwner',
  'leaseExpiresAt', 'heartbeatAt', 'providerRequestId',
  'providerTraceId', 'resultCount', 'errorCode', 'errorMessage',
]))
expect(upSql).toContain('CREATE TABLE "sourcing_search_pages"')
expect(upSql).toContain('UNIQUE ("search_id", "page_number")')
```

- [ ] **Step 2: 运行实体和迁移测试确认失败**

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/sourcing/entities/sourcing.entities.spec.ts src/database/tests/autoflow.migrations.spec.ts`

Expected: FAIL，缺少分页实体和迁移类。

- [ ] **Step 3: 实现迁移 `up()`**

迁移必须：

1. 给 `workflow_runs` 添加 `seed_asset_path`、`seed_asset_mime_type`、`seed_asset_size`、`seed_asset_sha256`。
2. 给 `sourcing_searches` 添加 `language_code`、`image_id`、上传请求/追踪ID、总记录/总页数、pageSize、loadedPageCount和queryFingerprint。
   同时创建 `idx_sourcing_searches_owner_workflow_fingerprint`，列顺序为 `owner_user_id, workflow_run_id, query_fingerprint, created_at DESC`，确保非强制搜索复用不扫描工作流全部历史。
3. 删除并重建搜索状态CHECK，加入 `partial`。
4. 创建 `sourcing_search_pages`，包含唯一约束、外键、租约字段、CHECK和四个索引。
5. 给 `sourcing_offers` 添加页码、排名、详情状态、详情时间、scoreVersion、scoreDimensions。
6. 使用 `USING ROUND(column::numeric, 4)` 将 `repurchase_rate`、`supplier_rating` 转为 `numeric(9,4)`。

`down()` 按依赖反序删除分页表和字段，并使用 `USING column::double precision` 恢复旧类型。恢复旧状态CHECK前，执行 `UPDATE sourcing_searches SET status = CASE WHEN loaded_page_count > 0 THEN 'succeeded' ELSE 'failed' END WHERE status = 'partial'`，确保已有partial数据不会导致回滚失败。

- [ ] **Step 4: 实现TypeORM实体和关系**

```ts
@Entity('sourcing_search_pages')
@Unique('uq_sourcing_search_pages_search_page', ['searchId', 'pageNumber'])
export class SourcingSearchPageEntity {
  @PrimaryGeneratedColumn('uuid') id: string
  @Column({ name: 'search_id', type: 'uuid' }) searchId: string
  @Column({ name: 'owner_user_id', type: 'uuid' }) ownerUserId: string
  @Column({ name: 'page_number', type: 'integer' }) pageNumber: number
  @Column({ name: 'page_size', type: 'integer' }) pageSize: number
  @Column({ type: 'varchar', length: 24, default: 'pending' }) status: SourcingPageStatus
  @Column({ type: 'integer', default: 0 }) attempts: number
  @Column({ name: 'max_attempts', type: 'integer', default: 3 }) maxAttempts: number
  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' }) availableAt: Date
  @Column({ name: 'lease_owner', type: 'varchar', length: 255, nullable: true }) leaseOwner: string | null
  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true }) leaseExpiresAt: Date | null
  @Column({ name: 'heartbeat_at', type: 'timestamptz', nullable: true }) heartbeatAt: Date | null
  @Column({ name: 'provider_request_id', type: 'varchar', length: 128, nullable: true }) providerRequestId: string | null
  @Column({ name: 'provider_trace_id', type: 'varchar', length: 128, nullable: true }) providerTraceId: string | null
  @Column({ name: 'result_count', type: 'integer', default: 0 }) resultCount: number
  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true }) errorCode: string | null
  @Column({ name: 'error_message', type: 'text', nullable: true }) errorMessage: string | null
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true }) startedAt: Date | null
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt: Date | null
  @ManyToOne(() => SourcingSearchEntity, (search) => search.pages, { onDelete: 'CASCADE' }) search: SourcingSearchEntity
  @ManyToOne(() => User, { onDelete: 'RESTRICT' }) owner: User
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date
}
```

为两个关系分别使用 `@JoinColumn` 映射 `search_id` 和 `owner_user_id`。索引名称固定为 `idx_sourcing_search_pages_status_available`、`idx_sourcing_search_pages_search_page`、`idx_sourcing_search_pages_owner_search`、`idx_sourcing_search_pages_lease_expires`；CHECK名称固定为 `chk_sourcing_search_pages_page_number`、`chk_sourcing_search_pages_page_size`、`chk_sourcing_search_pages_attempts`。`SourcingSearchEntity` 增加 `pages: SourcingSearchPageEntity[]`，Decimal列的TypeScript属性使用 `string | null`。

- [ ] **Step 5: 运行迁移、实体和编译测试**

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/sourcing/entities/sourcing.entities.spec.ts src/database/tests/autoflow.migrations.spec.ts`

Run: `npm run build --workspace=backend`

Expected: PASS。

- [ ] **Step 6: 提交数据库分页模型**

```bash
git add backend/src/database/migrations/1784728000000-AddAlibaba1688SourcingPagination.ts backend/src/database/tests/autoflow.migrations.spec.ts backend/src/modules/sourcing/entities backend/src/modules/autoflow/entities/workflow-run.entity.ts
git commit -m "feat: add 1688 sourcing page persistence"
```

---

### Task 6: 使用Decimal实现价格、MOQ和评分精度

**Files:**
- Modify: `backend/package.json`
- Modify: `package-lock.json`
- Create: `backend/src/modules/sourcing/sourcing-decimal.ts`
- Create: `backend/src/modules/sourcing/sourcing-decimal.spec.ts`
- Modify: `backend/src/modules/sourcing/dto/start-sourcing.dto.ts`
- Modify: `backend/src/modules/sourcing/dto/start-sourcing.dto.spec.ts`
- Modify: `backend/src/modules/sourcing/sourcing-scoring.ts`
- Modify: `backend/src/modules/sourcing/sourcing-scoring.spec.ts`
- Modify: `backend/src/modules/sourcing/sourcing-response.types.ts`

**Interfaces:**
- Consumes: 1688价格字符串、DTO价格字符串和decimal数据库字段。
- Produces: `decimalOrNull()`、`decimalMinMax()`、`percentDecimalOrNull()`；金额结果保持规范化字符串。

- [ ] **Step 1: 安装Decimal.js并写精度失败测试**

Run: `npm install --workspace=backend decimal.js`

```ts
expect(decimalMinMax(['0.1', '0.2', '0.3000000000000001'])).toEqual({
  min: '0.1000',
  max: '0.3000',
})
expect(percentDecimalOrNull('12.3456%')).toBe('12.3456')
```

DTO测试必须接受 `{ priceMin: '0.1000', priceMax: '0.3000', pageSize: 20 }`，拒绝指数、负数、超过4位小数和 `pageSize: 30`。

- [ ] **Step 2: 运行精度和DTO测试确认失败**

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/sourcing/sourcing-decimal.spec.ts src/modules/sourcing/dto/start-sourcing.dto.spec.ts src/modules/sourcing/sourcing-scoring.spec.ts`

Expected: FAIL，当前金额使用 `number` 和 `Math.min/Math.max`。

- [ ] **Step 3: 实现Decimal辅助函数**

```ts
export function decimalOrNull(value: unknown, scale = 4): string | null {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
  if (!text) return null
  const decimal = new Decimal(text)
  if (!decimal.isFinite() || decimal.isNegative()) return null
  return decimal.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale)
}
```

`decimalMinMax()` 只比较Decimal实例；百分比先移除末尾 `%`，验证0到100后输出4位字符串。

- [ ] **Step 4: 修改DTO、评分和响应类型**

`priceMin/priceMax` 改为十进制字符串；`SourcingOfferResponse.repurchaseRate`、供应商评分和价格保持字符串。评分函数只在输出0–100维度分时转换成有限 `number`，金额比较始终使用Decimal。

DTO字段使用 `@Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/)`，从HTTP入口拒绝指数形式、负数和超过4位小数的金额。

- [ ] **Step 5: 运行精度、评分和适配器测试**

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/sourcing/sourcing-decimal.spec.ts src/modules/sourcing/dto/start-sourcing.dto.spec.ts src/modules/sourcing/sourcing-scoring.spec.ts src/modules/alibaba1688/alibaba1688.service.spec.ts`

Expected: PASS。

- [ ] **Step 6: 提交Decimal改造**

```bash
git add backend/package.json package-lock.json backend/src/modules/sourcing
git commit -m "fix: preserve sourcing decimal precision"
```

---

### Task 7: 实现搜索创建、分页读取和租户隔离API

**Files:**
- Create: `backend/src/modules/sourcing/dto/list-sourcing.dto.ts`
- Create: `backend/src/modules/sourcing/dto/list-sourcing.dto.spec.ts`
- Modify: `backend/src/modules/sourcing/sourcing.controller.ts`
- Modify: `backend/src/modules/sourcing/sourcing.service.ts`
- Modify: `backend/src/modules/sourcing/sourcing.service.spec.ts`
- Modify: `backend/src/modules/sourcing/sourcing-response.types.ts`
- Modify: `backend/src/modules/sourcing/sourcing.types.ts`
- Modify: `backend/src/modules/sourcing/sourcing.module.ts`

**Interfaces:**
- Consumes: `SourcingSearchPageEntity`、`StartSourcingDto` 和工作流归属。
- Produces: `startSearch()`、`requestPage()`、`getSummary(ownerUserId, workflowRunId, query)`。

```ts
export interface SourcingStartResponse {
  searchId: string
  status: 'pending'
  page: 1
  pageSize: 10 | 20 | 50
}
```

- [ ] **Step 1: 写DTO、幂等和分页读取失败测试**

```ts
await expect(service.startSearch(ownerUserId, workflowRunId, { pageSize: 20 }))
  .resolves.toEqual({ searchId: 'search-1', status: 'pending', page: 1, pageSize: 20 })
expect(pageRepository.save).toHaveBeenCalledTimes(1)

await expect(service.requestPage(otherOwnerId, workflowRunId, 'search-1', 2))
  .rejects.toBeInstanceOf(NotFoundException)
```

验证相同非强制查询复用搜索、强制查询创建新搜索、同页重复请求不重复插入、未知总页数时拒绝第2页、超过totalPages拒绝。

- [ ] **Step 2: 运行服务和DTO测试确认失败**

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/sourcing/dto/list-sourcing.dto.spec.ts src/modules/sourcing/sourcing.service.spec.ts`

Expected: FAIL，缺少分页DTO、分页仓库和新响应结构。

- [ ] **Step 3: 实现分页DTO和Controller契约**

```ts
export class ListSourcingDto {
  @IsOptional() @IsUUID() searchId?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1
  @IsOptional() @Type(() => Number) @IsIn([10, 20, 50]) pageSize = 20
}
```

Controller增加：

```ts
@Post('searches/:searchId/pages/:pageNumber')
@HttpCode(HttpStatus.ACCEPTED)
requestPage(
  @Request() request: ExpressRequest,
  @Param('workflowRunId', ParseUUIDPipe) workflowRunId: string,
  @Param('searchId', ParseUUIDPipe) searchId: string,
  @Param('pageNumber', ParseIntPipe) pageNumber: number,
) {
  return this.sourcingService.requestPage(
    request.user!.userId,
    workflowRunId,
    searchId,
    pageNumber,
  )
}
```

GET增加 `@Query() query: ListSourcingDto`。

- [ ] **Step 4: 把 `SourcingService` 收敛为任务命令和数据库查询**

`startSearch()` 先检查1688 readiness，再在事务中创建搜索和第一页；查询指纹使用SHA-256，输入包括owner、workflow、模式、规范化seed、language、pageSize和价格字符串。`requestPage()` 对最终失败页面显式重试时清空错误和租约、把attempts重置为0、availableAt设为当前时间；成功、pending和running页面保持幂等返回。`getSummary()` 只查询数据库，不调用1688。`runForWorkflow()` 调用非强制 `startSearch()` 并保留旁路失败日志，不阻断线索发现。

- [ ] **Step 5: 运行服务、Controller编译和隔离测试**

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/sourcing/dto/list-sourcing.dto.spec.ts src/modules/sourcing/sourcing.service.spec.ts`

Run: `npm run build --workspace=backend`

Expected: PASS。

- [ ] **Step 6: 提交分页API**

```bash
git add backend/src/modules/sourcing
git commit -m "feat: add asynchronous sourcing pagination API"
```

---

### Task 8: 执行单页1688查询并事务落库

**Files:**
- Create: `backend/src/modules/sourcing/sourcing-page-executor.service.ts`
- Create: `backend/src/modules/sourcing/sourcing-page-executor.service.spec.ts`
- Modify: `backend/src/modules/sourcing/sourcing.module.ts`
- Modify: `backend/src/modules/sourcing/sourcing.types.ts`
- Modify: `backend/src/modules/sourcing/entities/sourcing-offer.entity.ts`

**Interfaces:**
- Consumes: `ClaimedSourcingPage`、`Alibaba1688Service`、`SourcingImageResolverService`、Decimal辅助函数和快照清理器。
- Produces: `executePage(page: ClaimedSourcingPage): Promise<void>`；成功时同一事务保存供应商、商品、分页成功和搜索汇总。

```ts
export interface ClaimedSourcingPage {
  id: string
  searchId: string
  workflowRunId: string
  ownerUserId: string
  pageNumber: number
  pageSize: number
  attempts: number
  maxAttempts: number
  leaseOwner: string
}
```

- [ ] **Step 1: 写关键词、图片和事务回滚失败测试**

测试断言：

- 关键词第2页传 `beginPage: 2`、固定pageSize。
- 图片第一页在 `imageId` 为空时只上传一次并保存 `imageId`，图搜只传 `imageId`。
- 图片第2页复用已有 `imageId`，不再次调用上传。
- 每页仅前5条调用详情，最大同时5个Promise。
- 价格使用Decimal字符串，`rawSnapshot`不含token和Base64。
- 任一落库失败时页面不标记成功且无半页商品。
- 成功更新必须匹配 `id + running + leaseOwner`。

- [ ] **Step 2: 运行执行器测试确认文件不存在**

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/sourcing/sourcing-page-executor.service.spec.ts`

Expected: FAIL，无法解析执行器。

- [ ] **Step 3: 实现Provider调用和图片 `imageId` 复用**

```ts
if (search.searchMode === 'image' && !search.imageId) {
  const image = await this.imageResolver.resolve(workflow)
  const uploaded = await this.alibaba1688Service.uploadImage({
    imageBase64: image.bytes.toString('base64'),
  })
  await this.searchRepository.update(
    { id: search.id, ownerUserId: page.ownerUserId },
    { imageId: uploaded.normalized.imageId, imageUploadRequestId: uploaded.metadata.requestId },
  )
  search.imageId = uploaded.normalized.imageId
}
```

关键词调用 `searchByKeyword()`；图片调用 `searchByImage({ imageId, beginPage, pageSize, country: languageCode })`。

- [ ] **Step 4: 实现详情补全、评分和事务写入**

使用 `Promise.allSettled(offers.slice(0, 5).map(...))`。详情失败只把对应商品 `detailStatus` 设为 `failed`，搜索页仍可成功；关键词/图搜主调用失败则整页失败。事务开始时删除本页未完成商品，然后写供应商和商品，最后更新page及search汇总。

搜索第一页成功时更新 `totalRecords`、`totalPages`；后续页响应与第一页总数不一致时以最新非空值更新并记录结构化警告。分页成功记录 `providerRequestId`、`providerTraceId`、durationMs、attempt和resultCount，日志不包含请求体、图片内容或完整外部URL。

- [ ] **Step 5: 运行执行器、评分、快照和适配器测试**

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/sourcing/sourcing-page-executor.service.spec.ts src/modules/sourcing/sourcing-scoring.spec.ts src/modules/sourcing/sourcing-snapshot.spec.ts src/modules/alibaba1688/alibaba1688.service.spec.ts`

Expected: PASS。

- [ ] **Step 6: 提交单页执行器**

```bash
git add backend/src/modules/sourcing
git commit -m "feat: execute and persist 1688 sourcing pages"
```

---

### Task 9: 实现分页任务Worker、租约和有限重试

**Files:**
- Create: `backend/src/modules/sourcing/sourcing-worker.service.ts`
- Create: `backend/src/modules/sourcing/sourcing-worker.service.spec.ts`
- Create: `backend/src/modules/sourcing/sourcing-error-policy.ts`
- Create: `backend/src/modules/sourcing/sourcing-error-policy.spec.ts`
- Modify: `backend/src/modules/sourcing/sourcing.module.ts`
- Modify: `backend/src/modules/sourcing/sourcing.types.ts`
- Modify: `backend/src/modules/alibaba1688/alibaba1688.error.ts`

**Interfaces:**
- Consumes: `SourcingPageExecutorService.executePage()`、`Alibaba1688Exception.normalized` 和 `SourcingImageException`。
- Produces: `runNextPage(): Promise<boolean>`；应用启动轮询、续租、延迟重试和最终失败状态。

```ts
export interface SourcingExecutionFailure {
  code: 'NOT_CONFIGURED' | 'AUTHENTICATION_FAILED' | 'PERMISSION_DENIED'
    | 'RATE_LIMITED' | 'PROVIDER_TIMEOUT' | 'PROVIDER_UNAVAILABLE'
    | 'INVALID_IMAGE' | 'INVALID_REQUEST' | 'INVALID_RESPONSE'
  message: string
  retryable: boolean
  retryAfterMs: number | null
}
```

- [ ] **Step 1: 写并发领取、重试和旧Worker隔离失败测试**

```ts
expect(claimSql).toContain('FOR UPDATE SKIP LOCKED')
expect(claimSql).toContain('"lease_owner"')

await worker.runNextPage()
expect(pageRepository.update).toHaveBeenCalledWith(
  { id: 'page-1', status: 'running', leaseOwner: expect.any(String) },
  expect.objectContaining({ status: 'pending', availableAt: expect.any(Date) }),
)
```

测试认证/权限/非法图片只执行一次；超时、429、5xx最多3次；租约过期可重新领取；旧leaseOwner不能完成新Worker持有的任务。

- [ ] **Step 2: 运行Worker测试确认文件不存在**

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/sourcing/sourcing-worker.service.spec.ts src/modules/sourcing/sourcing-error-policy.spec.ts`

Expected: FAIL，无法解析Worker。

- [ ] **Step 3: 实现原子领取和心跳**

领取SQL筛选：

```sql
(status = 'pending' AND available_at <= now())
OR (status = 'running' AND lease_expires_at < now())
```

必须同时满足 `attempts < max_attempts`，按 `available_at, created_at` 排序，使用 `FOR UPDATE SKIP LOCKED LIMIT 1`，原子写入 `running`、attempts+1、leaseOwner、leaseExpiresAt和heartbeatAt。

- [ ] **Step 4: 实现错误分类和退避**

```ts
const failure = normalizeSourcingExecutionError(error)
const exhausted = !failure.retryable || page.attempts >= page.maxAttempts
const delayMs = page.attempts === 1 ? 1_000 : 3_000
```

`normalizeSourcingExecutionError()` 必须输出上表九种固定错误码，并对用户可见消息执行现有1688敏感值清理。429的 `retryAfterMs` 如果存在，取 `min(60_000, max(delayMs, retryAfterMs))`。更新必须匹配旧 `leaseOwner`。最终失败后重新计算搜索为 `failed` 或 `partial`；临时重试保持已成功页面可读取。

- [ ] **Step 5: 注册生命周期并运行Worker测试**

在 `SourcingModule.providers` 注册Worker。轮询参数：`SOURCING_JOB_POLL_INTERVAL_MS` 默认500ms，`SOURCING_JOB_LEASE_DURATION_MS` 默认30000ms；只接受正整数。

Run: `npm test --workspace=backend -- --runInBand --runTestsByPath src/modules/sourcing/sourcing-worker.service.spec.ts src/modules/sourcing/sourcing-error-policy.spec.ts src/modules/sourcing/sourcing-page-executor.service.spec.ts src/modules/sourcing/sourcing.service.spec.ts`

Expected: PASS。

- [ ] **Step 6: 提交分页Worker**

```bash
git add backend/src/modules/sourcing backend/src/modules/alibaba1688/alibaba1688.error.ts
git commit -m "feat: process sourcing pages with leased retries"
```

---

### Task 10: 实现Vue轮询、分页和局部失败交互

**Files:**
- Modify: `frontend/src/api/autoflow.ts`
- Modify: `frontend/src/utils/sourcing.ts`
- Modify: `frontend/src/views/autoflow/SourcingView.vue`
- Modify: `frontend/src/i18n/index.ts`
- Modify: `frontend/src/tests/sourcing-view.test.ts`

**Interfaces:**
- Consumes: 后端 `SourcingStartResponse`、`SourcingSummaryResponse.pagination` 和页面状态。
- Produces: `getWorkflowSourcing(id, query)`、`requestWorkflowSourcingPage(id, searchId, page)`；URL查询参数 `searchId/page/pageSize`。

- [ ] **Step 1: 写分页、轮询和卸载失败测试**

```ts
vi.useFakeTimers()
apiMock.startWorkflowSourcing.mockResolvedValue({
  searchId: 'search-2', status: 'pending', page: 1, pageSize: 20,
})

await wrapper.get('[data-test="restart-sourcing"]').trigger('click')
await vi.advanceTimersByTimeAsync(1_500)
expect(apiMock.getWorkflowSourcing).toHaveBeenCalledWith('workflow-1688', {
  searchId: 'search-2', page: 1, pageSize: 20,
})
```

增加测试：已加载页直接展示；点击未加载第2页先调用页面POST；页2失败显示 `retry-sourcing-page` 且保留页1；pageSize变化创建新搜索；unmount后不再轮询；route query恢复位置。

- [ ] **Step 2: 运行前端测试确认失败**

Run: `npm test --workspace=frontend -- --run src/tests/sourcing-view.test.ts`

Expected: FAIL，现有API没有分页参数、轮询或页面任务方法。

- [ ] **Step 3: 更新前端API和状态工具**

```ts
export interface SourcingPagination {
  page: number
  pageSize: 10 | 20 | 50
  totalRecords: number | null
  totalPages: number | null
  resultCount: number
  loaded: boolean
  status: 'pending' | 'running' | 'succeeded' | 'failed'
}

getWorkflowSourcing(id, query) {
  return api.get(`/autoflow/workflows/${id}/sourcing`, { params: query })
}
```

状态工具将 `pending/running` 视为运行中，将 `partial` 映射为警告样式，将后端 `succeeded` 显示为完成。

- [ ] **Step 4: 实现轮询生命周期和URL同步**

使用 `onBeforeUnmount(stopPolling)`；一次只保留一个定时器。终态 `succeeded/failed/partial/not_configured` 停止当前页轮询。使用 `router.replace({ query: { ...route.query, searchId, page: String(page), pageSize: String(pageSize) } })`，不覆盖其他查询参数。

- [ ] **Step 5: 实现分页UI和局部错误**

添加 `data-test="sourcing-pagination"`、`previous-sourcing-page`、`next-sourcing-page`、`sourcing-page-size`、`retry-sourcing-page`。显示当前范围：

```ts
const rangeStart = totalRecords === 0 ? 0 : (page - 1) * pageSize + 1
const rangeEnd = Math.min(page * pageSize, totalRecords ?? page * pageSize)
```

更新中英文文案，认证和权限错误继续显示真实配置提示，不生成模拟商品。

- [ ] **Step 6: 运行前端测试、lint和build**

Run: `npm test --workspace=frontend -- --run src/tests/sourcing-view.test.ts src/tests/workflow-image.test.ts`

Run: `npm run lint --workspace=frontend`

Run: `npm run build --workspace=frontend`

Expected: 全部PASS。

- [ ] **Step 7: 提交Vue分页体验**

```bash
git add frontend/src/api/autoflow.ts frontend/src/utils/sourcing.ts frontend/src/views/autoflow/SourcingView.vue frontend/src/i18n/index.ts frontend/src/tests/sourcing-view.test.ts
git commit -m "feat: add paginated 1688 sourcing UI"
```

---

### Task 11: 增加可重复执行的AutoFlow真实联调脚本

**Files:**
- Create: `scripts/alibaba1688-sourcing-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `AUTOFLOW_BASE_URL`、`AUTOFLOW_AUTH_TOKEN`、`AUTOFLOW_KEYWORD_WORKFLOW_ID`、`AUTOFLOW_IMAGE_WORKFLOW_ID`。
- Produces: `npm run test:1688:live`；只输出搜索ID、状态、分页数量和脱敏错误码。

- [ ] **Step 1: 写脚本参数校验和安全输出**

```js
const required = [
  'AUTOFLOW_AUTH_TOKEN',
  'AUTOFLOW_KEYWORD_WORKFLOW_ID',
  'AUTOFLOW_IMAGE_WORKFLOW_ID',
]
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is required`)
}
```

不得打印环境变量值、请求Authorization头、完整外部图片URL或数据库快照。

- [ ] **Step 2: 实现创建、轮询和第二页验证**

脚本对关键词和图片工作流分别：

1. POST强制新搜索。
2. 每1.5秒GET当前页，最多等待120秒。
3. 验证第一页 `succeeded` 且至少一条商品。
4. POST请求第2页并轮询成功。
5. 再次GET第1页并验证商品ID稳定。

```js
if (!summary.pagination.loaded || summary.pagination.status !== 'succeeded') {
  throw new Error(`Sourcing page failed: ${summary.latestSearch?.failureCode || 'UNKNOWN'}`)
}
```

- [ ] **Step 3: 注册npm脚本并验证缺参时安全失败**

```json
"test:1688:live": "node scripts/alibaba1688-sourcing-smoke.mjs"
```

Run: `npm run test:1688:live`

Expected: FAIL，仅提示缺少 `AUTOFLOW_AUTH_TOKEN`，不输出任何密钥。

- [ ] **Step 4: 在已配置环境执行真实联调**

先在当前PowerShell会话中通过安全的本地登录流程设置四个环境变量，然后执行：

```powershell
if (-not $env:AUTOFLOW_BASE_URL) { $env:AUTOFLOW_BASE_URL='http://127.0.0.1:3000' }
foreach ($name in @('AUTOFLOW_AUTH_TOKEN','AUTOFLOW_KEYWORD_WORKFLOW_ID','AUTOFLOW_IMAGE_WORKFLOW_ID')) {
  if (-not (Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue).Value) { throw "$name is required" }
}
npm run test:1688:live
```

Expected: 关键词、图片、第2页和第1页缓存四项均输出 `PASS`。不得把这些本地值写入文件或提交。

- [ ] **Step 5: 提交联调脚本**

```bash
git add package.json scripts/alibaba1688-sourcing-smoke.mjs
git commit -m "test: add AutoFlow 1688 live sourcing smoke"
```

---

### Task 12: 全量回归、迁移验证和启动检查

**Files:**
- Verify only unless a test reveals an in-scope defect.

**Interfaces:**
- Consumes: Tasks 1–11的全部提交。
- Produces: 可构建、可迁移、可启动且不依赖JavaDemo的AutoFlow功能。

- [ ] **Step 1: 运行后端完整测试**

Run: `npm test --workspace=backend -- --runInBand`

Expected: 所有Jest测试PASS，无开放句柄警告。

- [ ] **Step 2: 运行前端完整测试**

Run: `npm test --workspace=frontend`

Expected: 所有Vitest测试PASS。

- [ ] **Step 3: 运行lint和生产构建**

Run: `npm run lint`

Run: `npm run build`

Expected: 两条命令退出码0。

- [ ] **Step 4: 验证迁移状态和正反向迁移**

在本地测试数据库执行：

```powershell
npm run db:migration:show
npm run db:migrate
npm run db:migration:revert
npm run db:migrate
```

Expected: `1784728000000-AddAlibaba1688SourcingPagination` 可以up、down、再次up；现有寻源数据的Decimal转换成功。

- [ ] **Step 5: 启动项目并检查健康端点**

Run: `npm run dev`

检查：`http://localhost:5173` 和 `http://127.0.0.1:3000/api/health`。

Expected: 前后端启动；JavaDemo进程停止时AutoFlow健康检查和寻源页面仍正常。

- [ ] **Step 6: 检查敏感数据和工作区**

Run: `rg -n "access_token|appSecret|imageBase64|_aop_signature" backend/src/modules/sourcing scripts/alibaba1688-sourcing-smoke.mjs`

Expected: 只命中字段拦截、请求构造和测试断言，不存在日志打印或数据库字段。

Run: `git status --short`

Expected: 工作区干净；只包含计划内提交。
