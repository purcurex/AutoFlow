# Fulfillment queues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 五张履约待办卡片及岗位清单使用一致的新业务口径。
**Architecture:** 保留队列键及权限；独立进度对象驱动后端过滤、前端响应校验及状态显示；Mock 与 OpenAPI 一致。
**Tech Stack:** Vue 3, TypeScript, NestJS, Jest, Vitest, OpenAPI 3.1.
**Spec:** docs/superpowers/specs/2026-10-23-fulfillment-queues.md

## Global Constraints
- 使用已登录账号业务范围和 FOP 授权的交集，不能扩大权限。
- 金额及回款逻辑不变；不修改 FOP 源码。前端不显示技术权限说明。
- 新生成 HTML 遵守 HyperZone 共享样式规范。

## Review Focus
- 未付款／取消／退款不得进入待办。
- Shopify 同步不能依赖配货完成，采购下单不能冒充供应商已发货。
- 未齐套、齐套未审核、已审核未出库必须正确分流。
- 同单跨队列重叠但队列内不能因 SKU/包裹重复计数。
- 缺失／未知进度不能静默猜测；角色与数据隔离保持有效。

### Task 1: 五队列完整变更
**Files:** backend/src/modules/fop-data/{fop-data.types.ts,fop-data.service.ts,fop-demo.provider.ts}; frontend/src/api/{fop-orders.ts,fop-dashboard.ts}; frontend/src/views/autoflow/{FopDashboardView.vue,FopOrdersView.vue,WorkbenchView.vue}; frontend/src/utils/workbench.ts; 对应测试、docs/analytics/、docs/openapi/。
**Interfaces:** FopOrder.fulfillmentProgress={shopifySync,supplierShipment,stockReadiness,allocationReview,outbound}；getDashboard().queues 增加 procurement；dispatch/shipping 路由保持兼容。
- [x] 编写后端边界测试：review 不包含 unpaid；同单可出现在 dispatch/procurement/allocation；ready+pending 只进入 allocation，ready+approved+pending 进入 shipping；取消退款及 unknown 排除，计数与列表相同。
- [x] 运行 targeted Jest，Expected: FAIL（旧规则与新需求不一致）。
- [x] 实现类型、筛选、序列化校验及 Mock；更新前端卡片和列表，新增实际状态呈现。
- [x] 前端校验与 UI 测试覆盖相同边界及五张卡片正确跳转；Expected: PASS。
- [x] 核对 FOP 源码，更新接口 schema、样例、字段映射与待办；生成 MD/HTML。
- [x] 完整前后端测试、lint/build、隔离数据库 E2E、OpenAPI 校验及浏览器核对；Expected: PASS。
- [x] 完整变更提交，按 executing-plans 做最终独立审查，修复实质问题，推送既有远程分支。


执行记录：前端239、后端486、E2E121通过；两端lint/build通过；OpenAPI270样例通过；实际HTTP五队列计数等于明细合计。未付款审核门槛测试已观察RED后通过GREEN。沿用既有工作区及用户的直接执行授权，未新建工作树。独立代码审查完成（6e9a3c9..43df7d7）：无Critical/Important/Minor问题。

Final: Ruling: 真实FOP多包裹、部分取消／退款、撤审归一化继续由T31/H33联调 — 真实适配器未配置且本次禁止修改FOP生产实现；本次仅验证Mock/BFF契约，生产队列准确性仍需样本对账后确认。
