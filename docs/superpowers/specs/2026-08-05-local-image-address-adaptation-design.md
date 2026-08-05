# 本机图片地址适配与回显修复设计

## 背景与根因

本地上传图片写入 `backend/uploads/workflow-seeds/<owner>/<file>`，但 Nest 开发运行时从编译目录推导静态根目录，实际查找 `backend/dist/uploads`。因此文件存在但 `/uploads/...` 返回 404。修订页又直接使用持久化的 localhost `seedValue` 做预览，最终显示破图。

本机回显与第三方图片搜索属于不同网络边界：浏览器和1688寻源后端能够读取本机资产；PipiAds/Google Lens 位于外网，无法访问 localhost 或内网地址。

## 目标

- 新上传及历史本地图片都能在创建/修订页正常回显。
- 1688 继续从受控本地资产读取图片字节，不改变 imageId 契约。
- 当配置公网资源根地址后，历史本地图片无需重新上传即可供 PipiAds/Google Lens 使用。
- 未配置公网地址时，在调用第三方提供商前返回明确的图片不可达错误。

## 非目标

- 不集成 OSS、S3、Cloudflare Tunnel 或 ngrok。
- 不新增图片表、数据库字段或迁移。
- 不改变1688分页、缓存、供应商或采购评分逻辑。
- 不把本地图片伪装成第三方搜索成功。

## 数据流设计

### 浏览器预览

上传文件继续返回 `publicUrl` 与 `assetPath`。前端预览按照 Blob URL、`seedAssetPath`、外部 `seedValue` 的顺序选择图片。Vite 开发服务器代理 `/uploads` 到后端；生产环境由 Nest 同源提供 `/uploads`。

后端静态根目录统一为 `process.cwd()/uploads`，与 `WorkflowSeedAssetService.save()` 完全一致，避免编译目录变化导致路径漂移。

### 1688寻源

保留现有安全边界：本地资产根据 `seedAssetPath` 做当前用户归属和目录校验，读取字节并规范化后调用 `product.image.upload`，再使用返回的 `imageId` 调用图搜。浏览器预览 URL 和 `PUBLIC_ASSET_BASE_URL` 均不进入1688 imageQuery。

### PipiAds与Google Lens

图片工作流存在 `seedAssetPath` 时，客户发现运行阶段动态读取 `PUBLIC_ASSET_BASE_URL`：

- 配置为公网 HTTP/HTTPS 根地址：拼接 `seedAssetPath` 后交给第三方。
- 未配置、配置无效或指向 localhost/内网：在适配器调用前抛出明确的图片不可达错误。
- 没有 `seedAssetPath` 的公开图片工作流：继续使用原始 `seedValue`。

动态解析保证配置公网域名后，历史工作流无需修改数据库或重新上传。

## 安全与错误处理

- 静态文件写入仍按用户 UUID 分目录，提交工作流时继续执行文件归属校验。
- 公网根地址仅从后端环境读取，不接受前端覆盖。
- localhost、回环地址、RFC1918 私网地址和 `.local` 不视为第三方可访问地址。
- 公网配置缺失属于确定性输入/配置错误，不进行三次付费接口重试。
- 1688状态与客户发现状态继续独立，任一方失败不伪造另一方结果。

## 测试与影响范围

- PostgreSQL E2E：上传后立即 GET `assetPath`，断言 200、图片类型和原始字节。
- 前端组件测试：带本地资产的修订记录使用 `seedAssetPath` 回显，公开图片仍使用 `seedValue`。
- 后端单测：公网根地址动态拼接；未配置时不调用 PipiAds/Google Lens 适配器。
- 全量执行前后端测试、lint、构建，并在本地运行中的端口验证 ID13 图片返回 200。

影响文件仅限后端静态资源启动、客户发现种子解析、前端图片预览与开发代理及其测试，无数据库迁移。
