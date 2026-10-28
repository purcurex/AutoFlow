# Stock procurement and inventory search implementation plan

> Use superpowers:executing-plans inline; one independent final review after implementation.

**Goal:** 新增采购备货待办、待采购订单审核时间排序，简化库存模糊查询。
**Architecture:** 复用独立备货资源，不混入履约队列。stock-orders queue=procurement强制采购岗位与paid+approved+未采购/部分采购谓词；销售all保持全部有效。库存服务直接在授权行上进行客户、SKU模糊筛选并分页，无前置选客户步骤。
**Tech stack:** Vue3 / NestJS / TypeScript / Vitest / Jest / ExcelJS。
**Spec:** 本次用户明确需求；继承agent.md权限/UTC+8/默认收款排序约定。已有直接执行偏好，本轮不另设审批流程。

## Constraints and rulings
- 页签沿用用户名称“待采购待备货清单”，放采购待采购清单后，采购默认待采购不变。新备货清单有两类备货，客户已付、备货单已审核，purchaseStatus=unpurchased/partial；完成/取消/未知不混入；不以paidAt是否存在推断已付。
- 新增备货paymentStatus/reviewStatus可信字段；旧合同缺失为unknown，不默认已支付审核。FOP业务billstatus C与hzkj_orderstatus=2分别映射。
- “待采购清单创建时间”指既有履约procurement队列，改独立reviewedAt并可升降序；默认paidAt升序仍保留。真实审核时间不回退创建/收款时间，Excel及Mock同步。
- 新增备货采购页签复用StockOrdersView，仓库/部门/类型/采购状态/搜索/50默认/两种Excel一致；调用端queue不能扩大权限，sales/all与procurement各自校验岗位。
- 库存弹窗客户名称/编码与SKU/商品名两个框，AND组合、大小写不敏感包含查询；无条件也只返回当前账号授权库存，多客户按客户+SKU+仓库分行。客户ID兼容精确过滤但不再必填。仓库下拉；分页总数先过滤后计算，不截100客户。客户列显示名字与编码。库存当前归属和独立白名单不变。
- FOP源码只读，生产日期取值、员工网关和授权发布仍需IT联调。仅编辑当前工作区，保留其他改动，本轮无Git提交要求。

## Tasks / verification
- [x] 后端先写失败测试：采购备货条件/岗位/权限、全款押金/partial与完成、库存多客户模糊/交集/分页/越权、reviewedAt排序/空值/队列限制。
- [x] 实现types/DTO/service/provider/demo/export；核对FOP审核字段来源，定义明确合同。
- [x] 前端简化弹窗并添加客户列，采购备货页签、待采购时间列排序；测试筛选/清空/旧响应/默认入口与导出参数。
- [x] 更新需求9.37、MD/HTML/OpenAPI、agent/readme/source mapping/交付人工核对清单。
- [x] 相关与全量测试、HTTP、lint/build、浏览器宽度/搜索/导出验证。
- [x] 一次独立最终审查，修复具体问题并记录证据。

完成证据见docs/analytics/VERIFICATION.md需求9.37。前端422、后端592（旧Excel断言更新后单套复验）、HTTP179；lint/build和OpenAPI437样例通过，一次独立审查无重要发现。本轮无Git提交。
