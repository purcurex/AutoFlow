# Local Image Address Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复本地工作流图片 404 与修订页破图，并为 PipiAds/Google Lens 动态生成受控公网图片 URL，同时保持1688本地字节上传与 imageId 图搜边界。

**Architecture:** Nest 静态文件根目录与上传写入根目录统一为 `process.cwd()/uploads`；Vue 预览使用本地资产相对路径并由 Vite 代理 `/uploads`。客户发现只在运行时用 `PUBLIC_ASSET_BASE_URL` 将本地资产路径转换为公网 URL，1688仍直接读取本地字节。

**Tech Stack:** NestJS 11、TypeScript 5、Vue 3、Vite、Jest、Vitest、Supertest。

## Global Constraints

- 不新增依赖、数据库字段或迁移。
- 不把 localhost、内网 URL 或 `imageAddress` 传给1688图搜。
- 所有新增方法和关键分支使用 UTF-8 中文注释。
- 图片访问继续受现有文件类型、8 MB 和用户资产归属校验约束。
- PipiAds/Google Lens 不得在 `PUBLIC_ASSET_BASE_URL` 不可公开访问时发起请求。

---

### Task 1: 统一上传文件保存与静态读取根目录

**Files:**
- Modify: `backend/test/autoflow.e2e-spec.ts`
- Modify: `backend/src/main.ts`

**Interfaces:**
- Consumes: `POST /api/autoflow/workflow-images` 返回的 `assetPath`。
- Produces: `GET /uploads/workflow-seeds/<owner>/<file>` 返回原始图片字节。

- [x] **Step 1: 写入失败的E2E断言**

在现有图片上传用例中追加：

```ts
const downloaded = await request(app.getHttpServer())
  .get(uploaded.body.assetPath)
  .expect(200)
expect(downloaded.headers['content-type']).toMatch(/^image\/png/)
expect(downloaded.body).toEqual(png)
```

- [x] **Step 2: 运行E2E并确认RED**

Run: `npm.cmd run test:e2e --workspace=backend -- --runInBand`

Expected: 图片下载断言收到 404；其余上传校验保持通过。

- [x] **Step 3: 最小修复静态根目录**

将 `main.ts` 的上传静态目录改为与写入服务一致：

```ts
app.useStaticAssets(join(process.cwd(), 'uploads'), {
  prefix: '/uploads/',
})
```

生产前端目录仍使用编译目录推导，不改变 SPA 打包路径。

- [x] **Step 4: 运行E2E并确认GREEN**

Run: `npm.cmd run test:e2e --workspace=backend -- --runInBand`

Expected: 全部E2E通过，上传后的图片下载返回 200。

### Task 2: 修复创建/修订页本地图片回显

**Files:**
- Modify: `frontend/src/tests/workflow-revision-view.test.ts`
- Modify: `frontend/src/views/autoflow/WorkflowsView.vue`
- Modify: `frontend/vite.config.ts`

**Interfaces:**
- Consumes: `WorkflowRun.seedAssetPath`，格式为 `/uploads/workflow-seeds/<owner>/<file>`。
- Produces: `resolvedImagePreviewUrl` 优先返回可同源访问的本地资产路径。

- [x] **Step 1: 修改组件测试并确认旧逻辑失败**

将本地图片修订用例期望值改为：

```ts
expect(wrapper.get<HTMLImageElement>('img[alt="workflows.imagePreview"]').attributes('src'))
  .toBe(imageWorkflowFixture.seedAssetPath)
```

保留公开图片创建用例，确保没有 `seedAssetPath` 时仍使用 HTTPS `seedValue`。

- [x] **Step 2: 运行前端用例并确认RED**

Run: `npm.cmd test --workspace=frontend -- --run src/tests/workflow-revision-view.test.ts`

Expected: 本地图片实际 `src` 仍为 `seedValue`，与 `/uploads/...` 期望不一致。

- [x] **Step 3: 最小实现预览优先级与开发代理**

```ts
const resolvedImagePreviewUrl = computed(() => imagePreviewUrl.value
  || (form.seedType === 'image'
    ? form.seedAssetPath || safeExternalUrl(form.seedValue) || ''
    : ''))
```

Vite增加同源代理：

```ts
'/uploads': {
  target: 'http://localhost:3000',
  changeOrigin: true,
},
```

- [x] **Step 4: 运行前端用例并确认GREEN**

Run: `npm.cmd test --workspace=frontend -- --run src/tests/workflow-revision-view.test.ts`

Expected: 本地资产和公开图片两类回显用例全部通过。

### Task 3: 为外部客户发现动态解析公网图片地址

**Files:**
- Modify: `backend/src/modules/autoflow/workflow-seed-asset.service.ts`
- Modify: `backend/src/modules/discovery/discovery.service.ts`
- Modify: `backend/src/modules/discovery/discovery.service.spec.ts`

**Interfaces:**
- Consumes: `WorkflowRun.seedValue`、`WorkflowRun.seedAssetPath`、`PUBLIC_ASSET_BASE_URL`。
- Produces: `DiscoverySeed.value` 为公开 URL；1688服务和实体结构不变。

- [x] **Step 1: 写入动态公网地址和缺失配置测试**

新增两个真实服务行为断言：

```ts
expect(adAdapter.discover).toHaveBeenCalledWith(expect.objectContaining({
  value: 'https://assets.example.com/uploads/workflow-seeds/owner/product.jpg',
}))
```

以及本地资产无公网配置时：

```ts
await expect(service.discoverEvidence('owner-1', 'workflow-image'))
  .rejects.toThrow('PUBLIC_ASSET_BASE_URL')
expect(adAdapter.discover).not.toHaveBeenCalled()
expect(storeAdapter.discover).not.toHaveBeenCalled()
```

- [x] **Step 2: 运行后端单测并确认RED**

Run: `npm.cmd test --workspace=backend -- --runInBand --runTestsByPath src/modules/discovery/discovery.service.spec.ts`

Expected: 适配器仍收到 localhost `seedValue`，且缺少公网配置时没有提前失败。

- [x] **Step 3: 最小实现公网 URL 解析**

从 `workflow-seed-asset.service.ts` 导出公网地址判断函数并复用现有私网规则。`DiscoveryService` 注入 `ConfigService`，仅对存在 `seedAssetPath` 的图片工作流执行：

```ts
const baseUrl = this.configService.get<string>('PUBLIC_ASSET_BASE_URL')?.trim()
if (!baseUrl || !isPublicProviderUrl(baseUrl)) {
  throw new BadRequestException(
    'Workflow product image is only available locally. Configure a publicly reachable PUBLIC_ASSET_BASE_URL.',
  )
}
return new URL(workflow.seedAssetPath, `${baseUrl.replace(/\/$/, '')}/`).toString()
```

没有本地资产路径的公开图片继续使用 `seedValue`。

- [x] **Step 4: 运行后端单测并确认GREEN**

Run: `npm.cmd test --workspace=backend -- --runInBand --runTestsByPath src/modules/discovery/discovery.service.spec.ts src/modules/autoflow/workflow-seed-asset.service.spec.ts`

Expected: 公网拼接、缺少配置和现有上传地址判断全部通过。

### Task 4: 全量回归与运行时验收

**Files:**
- Verify only; no additional production files.

**Interfaces:**
- Consumes: Tasks 1-3 的合并结果。
- Produces: 可合并提交及运行时证据。

- [x] **Step 1: 执行完整验证**

Run:

```powershell
npm.cmd run lint
npm.cmd test -- --runInBand
npm.cmd run test:e2e
npm.cmd run build
```

Expected: 所有命令退出码为 0。

- [ ] **Step 2: 运行时验证本地图片**

重启/等待开发后端加载合并代码，访问 ID13 的 `seedAssetPath`：预期 HTTP 200、`Content-Type: image/png` 且响应长度大于 0。刷新修订页，预期图片正常回显。

- [ ] **Step 3: 提交并合并**

```powershell
git add backend/src/main.ts backend/test/autoflow.e2e-spec.ts `
  backend/src/modules/autoflow/workflow-seed-asset.service.ts `
  backend/src/modules/discovery/discovery.service.ts `
  backend/src/modules/discovery/discovery.service.spec.ts `
  frontend/src/views/autoflow/WorkflowsView.vue `
  frontend/src/tests/workflow-revision-view.test.ts frontend/vite.config.ts `
  docs/superpowers/specs/2026-08-05-local-image-address-adaptation-design.md `
  docs/superpowers/plans/2026-08-05-local-image-address-adaptation.md
git commit -m "fix: adapt local workflow images"
```

将提交快进合并回本地 `dev_01`，合并后再次执行完整验证。
