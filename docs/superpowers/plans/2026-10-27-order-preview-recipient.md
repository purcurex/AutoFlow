# Order image zoom and recipient details

> **For agentic workers:** Use superpowers:executing-plans inline; preserve the current checkout and unrelated uncommitted work. No commit requested for this change.

**Goal:** 所有待办清单支持商品图片悬停放大，Customer 国旗下显示订单收件人姓名，点击展示联系方式与收货地址。

**Architecture:** 独立图片预览组件使用 fixed Teleport 浮层与鼠标定位放大，限制在视口内且不改变表格宽度。收件人弹窗复用原生 dialog；详情来自当前权限过滤后的订单响应，按订单维护而非客户档案。切换路由、退出登录或订单不可见时关闭详情。

**Tech Stack:** Vue 3 / TypeScript / NestJS / OpenAPI 3.1。

**Spec:** 本文中的 Goal 与 Architecture 为本次小改动设计。用户已授权直接实施；FOP 仅核对，不修改。

## Global constraints
- 保持现有全部工作台、权限、字段顺序及无横向滚动布局。
- 图片缺失/失败用占位符；可键盘/点击查看、Escape 关闭，滚动时关闭悬停浮层。
- 姓名不是平台客户名称/业务员名称；详情不写入日志、URL、本地存储或默认批量导出。
- shippingRecipient 可空，兼容旧适配器；缺字段显示 —，不猜测地址。
- 后台真实网络适配器未上线，演示数据不得冒充实际 FOP 数据。

## Review focus
- 页面边缘、滚动、缩放后图片浮层不溢出视口或截断在列表内。
- 多品订单分别使用各自图片；图片错误及 URL 更新不会保留旧预览。
- 弹窗焦点、Escape、会话变化与刷新授权失效正确处理。
- 收件人仅从授权订单允许字段返回，空字段与旧适配器可用。
- 窄屏及长姓名地址换行，全部字段仍在屏幕内。

## Tasks
- [x] 1. 增加收件人响应字段、演示数据及权限/序列化回归测试。
- [x] 2. 增加图片预览、收件人弹窗及清单集成，覆盖交互/关闭/缺失数据。
- [x] 3. 同步字段映射、OpenAPI、需求与 HTML；运行测试、构建、浏览器检查并独立审查。

## Evidence
- FOP OrderController.java:3698–3714 明确标注收货人信息，包含 hzkj_customer_first_name/last_name、hzkj_phone/email、hzkj_state/city/post_code/address1/address2。
- OrderDeliveryAddressValidationService.java:243–253 使用相同订单国家与地址字段。

## Completion evidence
- Task 1: API test RED (missing response) → GREEN, 158 HTTP tests; eight-field allowlist preserves scope.
- Task 2: 40 scoped UI tests passed; single-preview RED (2 overlays) → GREEN with Symbol owner coordination. Native browser checked dark dialog, zoom and no horizontal overflow.
- Task 3: frontend347/backend555 passed; lint/build passed; OpenAPI428 examples validated and MD/HTML generated. Independent recipient_zoom_review found no remaining actionable issues; restored PackageSearch import needed by existing empty state.
- No git commit requested or created. Existing unrelated edits preserved.
