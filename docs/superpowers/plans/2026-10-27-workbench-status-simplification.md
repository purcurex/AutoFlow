# Workbench status simplification implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution and one independent final review.

**Goal:** 清单顶部同级筛选；每单最多一项有差异的协同进度。
**Architecture:** 保留全部队列、授权和 Dashboard 谓词；新增 taskStatus 派生展示/过滤枚举，服务端先授权后过滤再合计分页。前后端同一规则，Excel 同口径。
**Tech Stack:** Vue / TypeScript / NestJS / ExcelJS / OpenAPI 3.1.
**Spec:** 用户本轮要求和既有 FOP 业务事实；此文件包含具体展示设计。

## Design and constraints
- 销售待支付、待审核不再显示固定支付/审核状态；异常只保留异常原因。
- 发运、配货两清单只保留发运单状态；多单显示最早阶段，任一未知显示待确认，明细用展开详情保留。省略固定 Shopify 待同步、配货齐套/审核状态。
- 采购只显示一个采购订单状态；尚未完成采购准备时显示准备任务，已建采购单待推1688时按物流门槛显示待建发运单、待获取物流单号、物流条件待确认或待推1688。不将物流门槛提前阻断准备任务。
- 已采购待发货只显示供应商发货状态。仓库保留有区别的出库进度（待出库/部分出库），省略固定配货已审。
- taskStatus 选项按队列定义，不能根据当前页数据隐藏控件；全部状态仅取消筛选。状态与业务员、所属部门同一筛选行，部门最右。小屏自然换行。
- 缺失事实不能猜测为已完成；原 procurementStage 和 sort 字段保留兼容。选新状态清旧 procurementStage，旧链接提供明确筛选标签。
- 不改 FOP 生产库，不写业务数据，不扩大权限。不在本轮擅自提交历史未提交改动。

## Review focus
1. 未建采购单但缺物流号：仍显示采购准备，不遗漏可先做任务。
2. 发运多单混合/未知：不能只取最高进度；单据详情保留。
3. 状态筛选与部门/业务员/分页/导出同范围；无效队列值拒绝。
4. 固定状态移除后合计行列对齐，选中后切筛选清选择。
5. 不用当前页样本决定列或筛选显隐。

## Tasks
- [x] 1. 新增前后端 workbench-status helper 与测试；在 DTO、列表和导出请求加 taskStatus，HTTP 验证分页及权限。
- [x] 2. FopOrdersView 顶部筛选、单状态列；简化 ProcurementStatus/DispatchStatus，更新组件测试和 Excel 显示。
- [x] 3. 更新需求、OpenAPI、生成 MD/HTML；执行测试、lint/build、浏览器检查与独立终审。

## Completion ledger

- Executed inline in current checkout, preserving earlier uncommitted work. Initial badge tests failed on stacked facts, then passed after simplification.
- Independent review identified a hidden legacy filter when both parameters were active. Added a clearable chip and verified a failing-then-passing regression.
- Final verification: frontend329 + backend542 + HTTP145; lint/build/docs passed. Browser confirmed procurement25 to2 and allocation19 with expandable details.
- Ruling: outbound progress retains pending/partial distinction; fixed allocation approval is hidden, following the latest request to show differing states only.
- No Git commit requested this turn; all changes remain reviewable in the working tree.
