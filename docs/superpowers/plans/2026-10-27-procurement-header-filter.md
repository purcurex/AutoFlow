# 采购订单状态表头筛选 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在两个采购待办表头按实际进度筛选，清单、合计和两种Excel导出一致。

**Architecture:** 前后端以相同的进度归一函数定义互斥阶段；服务端先授权、队列及条件过滤，再合计、排序、分页。复用现有下拉框、URL查询和导出合同。

**Tech Stack:** Vue 3、TypeScript、NestJS、Vitest、Jest、OpenAPI 3.1.1。

**Spec:** 用户本轮“采购订单状态需要根据不同情况支持在表头筛选”；状态语义沿用需求9.14及最新FOP补充。Shopify按9.15无部分同步。

## 规则与边界

- 表头默认全部状态；待采购提供待建申请、待建采购单、待推1688、待付采购款、部分付款、退款跟进、待确认；已采购待发货提供供应商待发货/部分发货。
- 单选状态即时查询并回第一页；搜索、部门、业务员、排序及分页保留状态，切换不同队列清空状态，避免隐蔽空清单。
- 新参数procurementStage仅采购两队列接受，非法/重复/不匹配队列400。不扩权限，不影响Dashboard基数。
- FOP无采购单部分创建场景：移除该Demo和展示选项。旧partial枚举暂兼容归入待建采购单；接口文档注明迁移，不制造正常业务场景。采购申请partial旧值同样不作为新选项。
- 采购付款必须发生在1688生成之后；Demo覆盖先准备、待物流号、待推、付款与发货。业务动作仍在FOP执行。

## Review Focus

- 跨页筛选必须在服务端；导出必须复用同一过滤。
- 切换状态清空旧勾选，禁止旧数据继续导出。
- 缺失进度只进入待确认，不能猜测付款完成。
- 跨岗位/错误队列参数不得被忽略。
- 普通员工与经理的筛选结果不能包含无权订单。

## Tasks

- [x] HTTP及组件回归先观察失败：状态过滤、分页/合计、两种导出、表头交互。
- [x] 添加backend/src/modules/fop-data/procurement-stage.ts与frontend/src/utils/procurement-stage.ts；接入DTO、查询、组件及导出。
- [x] 清理不适用Demo与部分创建文案，保留旧合同兼容；表头与URL联动。
- [x] 更新需求/OpenAPI/MD/HTML，运行相关测试、lint、构建并复核。

## Ledger

- 保留当前工作区已有改动；本次不操作FOP生产库，不创建新工作树。

- 完成：前端329、后端533、HTTP144项通过，lint/build通过；OpenAPI425样例。独立review无实质问题，浏览器验证25→3及下拉样式。
- Ruling：旧partial字段保留兼容待建采购单，新Demo不生成，不提供部分创建选项；避免粗暴删除已预留合同，同时尊重FOP无此正常场景。
