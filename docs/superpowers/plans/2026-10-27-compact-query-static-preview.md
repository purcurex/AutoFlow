# Compact query controls and static image preview

> **For agentic workers:** Use superpowers:executing-plans inline. Preserve unrelated current changes; no commit requested.

**Goal:** 全局适度缩短查询框；Shopify 单号列收窄；长商品名单行省略；悬停静态完整大图；待采购统一“采购进度”，移除物流条件待确认和采购部分付款筛选。

**Architecture:** 共用搜索宽度变量限制查询框，工作台查询组不填满可用空间，右侧部门筛选保留。图片复用现有视口定位/关闭逻辑，删除局部放大、鼠标跟随与图标。采购前后端统一选项，原始 partial 付款兼容为尚待付款、未知物流条件只保留已知待推1688，不创造物流可执行条件。

**Tech Stack:** Vue/TypeScript/CSS、NestJS、OpenAPI。

**Spec:** 本文 Goal 与 Architecture，按用户本次明确要求直接执行。

## Constraints and review focus
- 无横向滚动；小屏查询框可自适应，已有短搜索框不拉长。
- 商品名仅视觉省略，保留完整 title/原始数据及导出；SKU/规格仍显示。
- 原始兼容采购事实仍可进入正确待办，移除筛选不造成数据遗漏。
- 图片完整 contain，不裁切或平移；保留 Escape/触摸点击/加载错误与退出清理。
- 需求/OpenAPI/导出表头与 UI 同步。

## Tasks
- [x] 更新交互和状态筛选回归测试，确认旧实现失败。
- [x] 落地共用样式、静态预览与前后端采购状态调整。
- [x] 同步需求/契约，完成测试、构建、视觉核验与独立审查。

## Completion evidence
- RED: previous header missing采购进度, old dynamic image transform, obsolete filter options; GREEN: frontend348/backend556/API159.
- Browser: 1920 list1587/1587, search359, Shopify88; 390 list345/345, search252; mobile leads search332×40 with auto basis. No horizontal overflow.
- Review compact_query_review: no remaining actionable findings after removing fixed flex-basis from shared search class (mobile column height regression). Build/lint/OpenAPI428 pass; no commit requested.
